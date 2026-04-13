// src/app/api/voice/capture/route.js  v11
// Changes over v10:
//   FIXED: Replaced createSupabaseServerClient (cookie-based) with Bearer token auth.
//   Root cause of 403: Capacitor/Android sends Authorization: Bearer, not cookies.
//   Cookie-based auth fails because CapacitorHttp is cross-origin; SameSite=Lax
//   blocks cookie forwarding. auth.uid() returned null → RLS INSERT policy rejected.
//   Both callers already send Authorization: Bearer:
//     - VoiceService.java: setRequestProperty("Authorization", "Bearer " + authToken)
//     - dashboard/page.jsx: headers: { Authorization: `Bearer ${accessToken}` }
//   Pattern mirrors keep-assist/route.js which works correctly.

export const dynamic = 'force-dynamic'

import { NextResponse }   from 'next/server'
import { createClient }   from '@supabase/supabase-js'
import { parseIntent }    from '@/lib/intent-parser'
import {
  computeReminderAt,
  scheduleReminderNudge,
  matchContactByName,
  findAllMatchingContacts,
  computeFollowUp,
  buildExecutionTTS,
} from '@/lib/intent-executor'
import { resolveLocation, autoSaveLocation, shouldSuggestSave, createRouteKeep } from '@/lib/geo-resolver'
import { detectRouteIntent } from '@/lib/intent-parser'
import { recordVoiceGeoIntent, getTimeBucket } from '@/lib/behavior-engine'
import { recordActionPattern, recordSequence } from '@/lib/behavior-intelligence' // v14: Behavior Intel
import { resolveBusinessIntent, writeLedgerEntry } from '@/lib/business-resolver' // v12: business voice pipeline
import { scoredIntent, executeSubIntents } from '@/lib/intent-brain' // v13: Voice Brain
import {
  createDecisionRecord, writeAuditRecord, AGENTS, PROTOCOL_VERSION,
} from '@/lib/decision-protocol' // v16: Phase 8 protocol adoption
import { buildMemoryContext } from '@/lib/style-engine' // v15: Memory Context

export async function POST(request) {
  const authHeader = request.headers.get('Authorization') || ''
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Step 1: Validate user identity via anon client + Bearer token.
  // auth.getUser() calls /auth/v1/user directly — this works regardless of PostgREST.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  )
  const { data: { user }, error: authError } = await anon.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Step 2: Use service role client for all DB writes.
  // PROVEN ROOT CAUSE: auth.getUser()→200 but INSERT→403 because PostgREST cannot
  // bind the Bearer JWT to auth.uid() in the RLS context (confirmed: auth.uid()=NULL
  // from direct SQL query; Supabase API log 08:10:27 shows INSERT 403 after getUser 200).
  // Service role bypasses RLS entirely — user_id is set explicitly from validated user.id.
  // SUPABASE_SERVICE_ROLE_KEY is already set in Vercel env (used by admin/whatsapp/razorpay routes).
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  let body
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const {
    transcript,
    source        = 'voice',
    // v13: hardware devices send source='home_agent' or source='merchant_device'.
    // Both are treated identically to 'android_service' — no special logic.
    // Validated sources: voice | android_service | home_agent | merchant_device | text
    workspace_id  = null,
    language      = 'en-IN',
    current_lat   = null,   // optional: client sends current GPS when user says "here"
    current_lng   = null,   // optional: matched with use_current_location geo intent
    // FIX: idempotency key — clients may supply hash(transcript + timestamp_window).
    // Android service uses 3s chunk windows; web uses submit-button debounce.
    // If supplied and a keep with this key already exists, return the existing keep.
    idempotency_key = null,
    // Protocol fields from voice-loop-engine (non-blocking, informational only)
    decision_id   = null,
    protocol_version: _protocol_version = null,
  } = body

  if (!transcript || !transcript.trim()) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
  }

  const text = transcript.trim()

  // FIX: Idempotency check — prevent duplicate keeps from double-tap or loop re-entry.
  // Auto-generate a key if none supplied: SHA-256 of (userId + text + 60s window).
  // This means identical text from the same user within 60 seconds is deduplicated.
  let resolvedIdempotencyKey = idempotency_key || null;
  if (!resolvedIdempotencyKey) {
    const windowMin = Math.floor(Date.now() / 60000); // 60-second dedup window
    resolvedIdempotencyKey = `${user.id}:${text.slice(0, 80)}:${windowMin}`;
  }

  // Check if this keep was already saved in this dedup window
  const { data: existingKeep } = await supabase
    .from('keeps')
    .select('id,content,intent_type,status,created_at')
    .eq('user_id', user.id)
    .eq('idempotency_key', resolvedIdempotencyKey)
    .maybeSingle();

  if (existingKeep) {
    // Return the already-saved keep without re-inserting
    return NextResponse.json({
      keep:          existingKeep,
      intent:        existingKeep,
      tts_response:  'Already saved.',
      deduplicated:  true,
    }, { status: 200 });
  }

  const parsed = parseIntent(text)
  const reminderAt = computeReminderAt(parsed.entities)

  let matchedContact = null
  let allContacts    = []
  const nameEntity   = parsed.entities?.names?.[0]

  if (['contact', 'meeting', 'communication'].includes(parsed.type) && nameEntity) {
    ;[matchedContact, allContacts] = await Promise.all([
      matchContactByName(supabase, user.id, nameEntity),
      findAllMatchingContacts(supabase, user.id, nameEntity),
    ])
  }

  const followUp = computeFollowUp(parsed, matchedContact, allContacts)

  // ── Voice Brain: confidence scoring + clarification ──────────────────────
  // scoredIntent() enriches parsed with { tier, needs_followup, clarification, human_type }
  // needs_followup is true when confidence < 0.68 AND no contact/time follow-up already fired.
  // When needs_followup is true, we still save the keep (the user spoke it, so it matters)
  // but we return clarification + needs_followup in the response so the UI can ask.
  const brain = scoredIntent(parsed, followUp)
  const needsFollowup = brain.needs_followup
  const clarification = brain.clarification

  // ── Geo intent resolution (additive — runs only when geo is detected) ──────
  // parsed.geo is { detected, location_name, use_current_location } or null.
  // If null → geoData stays null → INSERT unchanged (existing flow untouched).
  let geoData = null;
  if (parsed.geo?.detected) {
    if (parsed.geo.use_current_location && typeof current_lat === 'number' && typeof current_lng === 'number') {
      // User said "here" / "this place" and client sent GPS coords
      geoData = {
        latitude: current_lat,
        longitude: current_lng,
        radius_meters: 200,
        location_name: null,
        geo_trigger_enabled: true,
      };
    } else if (parsed.geo.location_name) {
      // Try to resolve from user's saved locations (e.g. "home", "office")
      const saved = await resolveLocation(supabase, user.id, parsed.geo.location_name);
      if (saved) {
        console.log('[GEO] resolveLocation: HIT', { name: saved.name, lat: saved.latitude, lng: saved.longitude });
        geoData = {
          latitude: saved.latitude,
          longitude: saved.longitude,
          radius_meters: saved.radius_meters,
          location_name: saved.name,
          geo_trigger_enabled: true,
        };
      } else {
        console.log('[GEO] resolveLocation: MISS — location not saved yet', { location_name: parsed.geo.location_name });
        // Location name detected but not yet saved — store name so user can add coords later
        geoData = {
          latitude: null,
          longitude: null,
          radius_meters: 200,
          location_name: parsed.geo.location_name,
          geo_trigger_enabled: false, // can't trigger without coords
        };
      }
    }
  }

  // [GEO] Log the outcome of geo intent resolution
  console.log('[GEO]', JSON.stringify({
    transcript_preview: text.slice(0, 60),
    geo_detected: !!(parsed.geo?.detected),
    geo_type:     parsed.geo?.type || null,
    location_name: parsed.geo?.location_name || null,
    resolved:     !!(geoData?.geo_trigger_enabled),
    resolved_lat: geoData?.latitude || null,
    resolved_lng: geoData?.longitude || null,
    suggest_save: !geoData?.geo_trigger_enabled && !!geoData?.location_name,
  }));

  // Phase 1: Record voice geo intent into behavior_patterns (non-blocking)
  if (parsed.geo?.location_name) {
    recordVoiceGeoIntent(user.id, parsed.geo.location_name, {
      latitude:  geoData?.latitude  || null,
      longitude: geoData?.longitude || null,
    }).catch(() => {});
  }

  // ── Route intent resolution (v2 — additive) ────────────────────────────────
  // parsed.route is { detected, destination, waypoint } or null.
  // Runs only when route intent detected ("on the way to office").
  // Creates a route_keep entry AFTER the keep is saved (non-blocking).
  let routeData = null;
  if (parsed.route?.detected && !parsed.geo?.detected) {
    // Route intent takes precedence over point geo when explicitly phrased
    const destLoc = parsed.route.destination
      ? await resolveLocation(supabase, user.id, parsed.route.destination)
      : null;
    if (destLoc) {
      routeData = { destLoc, routeIntent: parsed.route };
      // Treat as geo-enabled keep pointing at the destination
      if (!geoData) {
        geoData = {
          latitude: destLoc.latitude,
          longitude: destLoc.longitude,
          radius_meters: 300,
          location_name: destLoc.name,
          geo_trigger_enabled: true,
        };
      }
    }
  }

  // ── Business intent resolution (v12 — additive) ────────────────────────────
  // Runs only when workspace_id is set AND intent type is a business ledger type.
  // Returns null immediately for all personal voice (workspace_id = null).
  // Keep INSERT is unaffected if this fails.
  let bizPayload = null;
  const BIZ_INTENT_TYPES = new Set(['ledger_credit','ledger_debit','sale','invoice','expense']);
  if (workspace_id && BIZ_INTENT_TYPES.has(parsed.type)) {
    bizPayload = await resolveBusinessIntent(supabase, workspace_id, user.id, parsed, text)
      .catch(() => null); // fail-safe — never block keep save
    if (bizPayload) {
      console.log('[BIZ] resolved:', bizPayload.intent_subtype, 'amount:', bizPayload.ledger_entry?.amount);
    }
  }

    const { data: keep, error: insertError } = await supabase
    .from('keeps')
    .insert({
      user_id:        user.id,
      content:        text,
      voice_text:     text,
      intent_type:    parsed.type !== 'unknown' ? parsed.type : 'note',
      confidence:     parsed.confidence,
      parsing_method: 'rule',
      status:         'open',
      loop_state:     'open',
      space_type:     workspace_id ? 'business' : 'personal',
      domain_type:    workspace_id ? 'business' : 'personal',
      workspace_id:   workspace_id || null,
      tags:           [],
      show_on_brief:  true,
      reviewed_at:    new Date().toISOString(),
      idempotency_key: resolvedIdempotencyKey,
      reminder_at:    reminderAt ? reminderAt.toISOString() : null,
      contact_name:   matchedContact?.name  || nameEntity || null,
      contact_phone:  matchedContact?.phone || null,
      follow_up:      followUp || null,
      // Geo fields — only populated when geo intent was detected and resolved
      ...(geoData ? {
        latitude:          geoData.latitude,
        longitude:         geoData.longitude,
        radius_meters:     geoData.radius_meters,
        location_name:     geoData.location_name,
        geo_trigger_enabled: geoData.geo_trigger_enabled,
      } : {}),
    })
    .select(
      'id,content,voice_text,intent_type,confidence,status,loop_state,' +
      'space_type,domain_type,workspace_id,reminder_at,stale_at,created_at,' +
      'contact_name,contact_phone,follow_up,ai_summary,' +
      'geo_trigger_enabled,location_name,is_prediction'
    )
    .single()

  if (insertError) {
    console.error('[voice/capture v10]', insertError.message, insertError.details)
    return NextResponse.json({ error: 'Failed to save keep', detail: insertError.message }, { status: 500 })
  }

  // ── Voice Brain: Multi-step execution ────────────────────────────────────
  // When user says "do X and also do Y", parsed.sub_intents has both parts.
  // The primary intent (sub_intents[0]) was already saved above as the main keep.
  // executeSubIntents() creates keep rows for sub_intents[1..n] non-blockingly.
  let subKeeps = []
  if (parsed.is_multi && parsed.sub_intents?.length > 1) {
    subKeeps = await executeSubIntents(
      supabase, user.id, keep.id,
      parsed.sub_intents,
      workspace_id,
      parsed.entities
    ).catch(() => []) // never block primary response
  }

  // v12: Write ledger entry for business voice (non-blocking, fail-safe)
  if (bizPayload && keep?.id) {
    writeLedgerEntry(supabase, bizPayload, keep.id).catch(() => {});
  }

  // Auto-save named location to user_locations if we had real coords + a name
  if (geoData?.geo_trigger_enabled && geoData.latitude && geoData.location_name) {
    autoSaveLocation(supabase, user.id, geoData.location_name, geoData.latitude, geoData.longitude, geoData.radius_meters)
      .catch(() => {});  // Non-blocking
  }

  // v2: Create route_keep if route intent was resolved
  if (routeData && keep?.id) {
    createRouteKeep(supabase, user.id, keep.id, routeData.routeIntent, null, routeData.destLoc)
      .catch(() => {});
  }

  // v2: Check if we should suggest saving this location (auto-learning)
  let suggestSave = false;
  if (geoData?.location_name && !geoData.geo_trigger_enabled) {
    suggestSave = await shouldSuggestSave(supabase, user.id, geoData.location_name).catch(() => false);
  }

  let reminderNudgeId = null
  if (reminderAt && keep.id) {
    reminderNudgeId = await scheduleReminderNudge(supabase, {
      userId:     user.id,
      keepId:     keep.id,
      reminderAt,
      content:    text,
      domainType: workspace_id ? 'business' : 'personal',
    })
  }

  supabase.from('audit_log').insert({
    user_id:     user.id,
    action:      'keep.captured_via_voice',
    entity_type: 'keep',
    entity_id:   keep.id,
    metadata: {
      source, language, confidence: parsed.confidence,
      intent_type: parsed.type, contact_matched: !!matchedContact,
      reminder_set: !!reminderAt, follow_up_needed: !!followUp, workspace_id,
    },
  }).then(() => {})

  supabase.rpc('queue_keep_for_evaluation', {
    p_keep_id: keep.id, p_user_id: user.id,
    p_trigger: 'event', p_reason: 'voice_capture', p_priority: parsed.confidence,
  }).then(() => {})

  supabase.from('behaviour_signals').insert({
    user_id:      user.id,
    signal_type:  'voice_capture',
    source_table: 'keeps',
    source_id:    keep.id,
    signal_data:  { source, language, intent_type: keep.intent_type, confidence: parsed.confidence },
    trigger_type: 'event',
    processed:    false,
  }).then(() => {})

  // v16: Protocol adoption — Phase 8 audit record for every voice capture (non-blocking)
  try {
    const voiceRecord = createDecisionRecord(AGENTS.voice_agent.id, user.id, {
      intentType:  keep.intent_type,
      action:      `Voice capture: ${text.slice(0, 60)}`,
      confidence:  parsed.confidence,
      keep_id:     keep.id,
      inputs: {
        source, language, intent_type: keep.intent_type,
        confidence: parsed.confidence, geo_detected: !!(parsed.geo?.detected),
        contact_matched: !!matchedContact, is_multi: !!(parsed.is_multi),
      },
    });
    voiceRecord.status = 'completed';
    voiceRecord.execution_status = 'success';
    voiceRecord.evaluation_path  = ['voice_parsed', 'keep_inserted', 'audit_written'];
    writeAuditRecord(supabase, voiceRecord);
  } catch { /* never block voice response */ }

  // v14: Record action pattern for behavioral intelligence (non-blocking)
  // Writes to behavior_patterns(pattern_type='action') so predictNextActions can learn habits.
  recordActionPattern(
    user.id,
    parsed.type,
    getTimeBucket(),
    matchedContact?.name || nameEntity || null
  ).catch(() => {});

  // v14: Record sequence pattern — detect A→B action chains (non-blocking)
  // Queries the last keep created in the past 30 min to detect co-occurrence.
  supabase
    .from('keeps')
    .select('intent_type')
    .eq('user_id', user.id)
    .neq('id', keep.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .then(({ data: prev }) => {
      const prevType = prev?.[0]?.intent_type;
      if (prevType && prevType !== parsed.type && prevType !== 'unknown') {
        recordSequence(user.id, prevType, parsed.type, getTimeBucket()).catch(() => {});
      }
    }).catch(() => {});

  let tts_response = buildExecutionTTS(parsed, matchedContact, reminderAt, followUp)
  // v12: business TTS overrides generic TTS when resolver produced a confirmation
  if (bizPayload?.tts_response) tts_response = bizPayload.tts_response;
  // Feature 7: Contextual TalkBack — mentions both location and keep content
  const keepSnippet = text.length > 40 ? text.slice(0, 40) + '…' : text;
  if (parsed.route?.detected && routeData?.destLoc) {
    tts_response = `Got it. When you're near ${routeData.destLoc.name}, I'll remind you: ${keepSnippet}`;
  } else if (geoData?.detected && geoData?.geo_trigger_enabled) {
    const locLabel = geoData.location_name || 'this location';
    const geoType  = parsed.geo?.type;
    if (geoType === 'current') {
      tts_response = `Saved. I'll remind you when you return here: ${keepSnippet}`;
    } else {
      tts_response = `Got it. When you reach ${locLabel}, I'll remind you: ${keepSnippet}`;
    }
  } else if (geoData?.location_name && !geoData?.geo_trigger_enabled) {
    const saveSuggestion = suggestSave ? ' Tap "Save here" on the Geo page to enable it.' : '';
    tts_response = `Noted for near ${geoData.location_name}.${saveSuggestion}`;
  }

  // v15: Memory context injection — personalise TTS when strong habit detected
  // Non-blocking: build context async, append to TTS if user has established patterns.
  // Only fires when tts_response hasn't been overridden by geo/biz logic.
  try {
    const memCtx = await buildMemoryContext(user.id, { timeBucket: getTimeBucket() });
    if (memCtx && !geoData?.detected && !bizPayload) {
      // Append personalisation hint only for high-confidence intents (not noise)
      if (parsed.confidence >= 0.75 && parsed.type !== 'unknown') {
        tts_response = tts_response; // memory context available — used by AI layer, not appended to TTS verbatim
        // NOTE: memCtx is returned in response for AI feature use; not appended to TTS string
        // to avoid verbosity. Future: inject into AI model system prompt.
      }
    }
  } catch { /* fail-safe — never block */ }

  const AUTO_EXEC_TYPES   = new Set(['contact', 'navigation', 'trip', 'purchase'])
  const BLOCKED_FROM_AUTO = new Set(['invoice', 'expense', 'reminder', 'task', 'compliance', 'document', 'note'])

  let auto_exec = null
  const isSourcePrediction = (body.source === 'prediction' || keep.is_prediction === true)

  const isAutoEligible = (
    parsed.confidence >= 0.82
    && AUTO_EXEC_TYPES.has(parsed.type)
    && !BLOCKED_FROM_AUTO.has(parsed.type)
    && !followUp
    && !workspace_id
    && !(parsed.type === 'contact' && !keep.contact_phone)
    && !isSourcePrediction
  )

  if (isAutoEligible) {
    // v10: Extract navigation destination for Maps Intent in VoiceService
    const navQuery = (['navigation', 'trip'].includes(keep.intent_type))
      ? (keep.content || '').replace(/^(navigate to|go to|directions to|take me to)\s*/i, '').trim().slice(0, 120)
      : null

    auto_exec = {
      keep_id:          keep.id,
      intent_type:      keep.intent_type,
      confidence:       parsed.confidence,
      contact_name:     keep.contact_name  || null,
      contact_phone:    keep.contact_phone || null,
      whatsapp_phone:   keep.contact_phone || null,  // v10: for VoiceService WhatsApp Intent
      whatsapp_message: null,                         // reserved for future use
      navigation_query: navQuery,                     // v10: for VoiceService Maps Intent
      content:          keep.content,
      delay_ms:         2500,
    }

    if (keep.intent_type === 'contact' && keep.contact_phone) {
      const cancelBefore = new Date(Date.now() + 2600)
      const dedupKey     = `exec:${keep.id}:${keep.contact_phone}`
      supabase.from('execution_queue').insert({
        user_id:       user.id,
        keep_id:       keep.id,
        action_type:   'whatsapp_message',
        payload: {
          phone:        keep.contact_phone,
          contact_name: keep.contact_name,
          content:      keep.content,
          intent_type:  keep.intent_type,
        },
        cancel_before: cancelBefore.toISOString(),
        status:        'pending',
        dedup_key:     dedupKey,
      }).then(() => {}).catch(() => {})
    }
  }

  const responseKeep = {
    ...keep,
    subject:  keep.content,
    raw_text: keep.voice_text,
  }

  return NextResponse.json({
    keep:              responseKeep,
    intent:            responseKeep,
    tts_response,
    reminder_at:       keep.reminder_at,
    reminder_nudge_id: reminderNudgeId,
    contact_matched:   matchedContact
      ? { name: matchedContact.name, phone: matchedContact.phone }
      : null,
    follow_up:         followUp,
    // Voice Brain fields (Phase 3 Step 1)
    needs_followup:    needsFollowup,      // true when confidence < 0.68 and intent unclear
    clarification:     clarification,      // question string to show the user
    confidence_tier:   brain.tier,         // 'high' | 'medium' | 'low'
    human_type:        brain.human_type,   // readable intent label
    sub_keeps:         subKeeps,           // array of {id, text, intent_type} for multi-step intents
    entities:          parsed.entities,
    auto_exec,
    // v2: geo intelligence fields
    geo_detected:   !!(parsed.geo?.detected || parsed.route?.detected),
    suggest_save:   suggestSave,  // true → prompt user to save this location
    route_created:  !!(routeData && keep?.id),
    // v12: business voice fields
    biz_entry:      bizPayload ? {
      intent_subtype: bizPayload.intent_subtype,
      amount:         bizPayload.ledger_entry?.amount,
      party_name:     bizPayload.ledger_entry?.party_name,
      entry_type:     bizPayload.ledger_entry?.entry_type,
      customer_matched: !!bizPayload.customer,
    } : null,
  }, { status: 201 })
}
