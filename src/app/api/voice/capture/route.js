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
import { parseIntent, stripWakePhrase }    from '@/lib/intent-parser'
import { collapseRepeats } from '@/lib/transcript-clean'
import { impossibleSequences } from '@/lib/script-sanity'
import { isFragment, measuredSpeechMs, caughtPartReply } from '@/lib/fragment-guard'
import { cleanTurnTiming } from '@/lib/fillers'
import { aariaAssist }   from '@/lib/aaria-act'
import { aariaUnderstandLLM } from '@/lib/aaria-llm' // SOT P1: Aaria action brain for utterances regex can't parse
import {
  computeReminderAt,
  scheduleReminderNudge,
  matchContactByName,
  findAllMatchingContacts,
  computeFollowUp,
  buildExecutionTTS,
  extractDestination,
} from '@/lib/intent-executor'
import { readAnswer, answerConfirmation, isPlaceAnswer, placeConfirmation, isRepeatOfOpenQuestion, isPendingQuestion, isUnmatchedAnswer, askAgain } from '@/lib/follow-up-answer'
import { contactChoices, spokenContactQuestion, narrowContacts } from '@/lib/contact-match'
import { whyBrainRun, describeUnderstanding } from '@/lib/understanding-record'
import { geocodePlace, cleanPlaceName, prettyPlaceName, isPersonalPlace } from '@/lib/geocode'
import { resolveLocation, autoSaveLocation, shouldSuggestSave, createRouteKeep, anchorPoint } from '@/lib/geo-resolver'
import { detectRouteIntent } from '@/lib/intent-parser'
import { recordVoiceGeoIntent, getTimeBucket } from '@/lib/behavior-engine'
import { recordActionPattern, recordSequence } from '@/lib/behavior-intelligence' // v14: Behavior Intel
import { resolveBusinessIntent, writeLedgerEntry, matchCustomer } from '@/lib/business-resolver' // v12: business voice pipeline
import { scoredIntent, executeSubIntents } from '@/lib/intent-brain' // v13: Voice Brain
import {
  createDecisionRecord, writeAuditRecord, AGENTS, PROTOCOL_VERSION,
} from '@/lib/decision-protocol' // v16: Phase 8 protocol adoption
import { buildMemoryContext } from '@/lib/style-engine' // v15: Memory Context
import { cleanListenEvidence } from '@/lib/listen-stream'
import { decide, DECISION } from '@/lib/action-levels' // item 2: the safety check before every action
import { recordStep, getActiveRun } from '@/lib/step-log' // AG-AARIA-37: 100-task step recorder
import {
  NO_KEEP_INTENTS, BRAIN_TYPE, DELETE_ASKED, DELETE_ANSWERED,
  planNoKeepTurn, isStrayConfirmation, matchKeepForDelete, deleteQuestion,
  pendingDelete, readDeleteAnswer, deleteDecision, archivePatch, line,
} from '@/lib/brain-turn' // confirm / delete / pay / none: reply, save nothing
import {
  BUSINESS_INTENTS, BIZ_TYPE, BIZ_PERMISSION, BIZ_ASKED, BIZ_ANSWERED,
  planAttendance, attendanceRows, planStock, stockOp, stockWrites, payrollDraft, payPeriod,
  pendingBiz, readBizAnswer, bizDecision, bizLine, doneLine,
} from '@/lib/business-voice' // attendance / stock / payroll: read back, write only on a spoken yes

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
    // Where the user was standing when they spoke. Sent by the global Aaria
    // dock (src/lib/context/aaria.jsx), which is mounted on every screen.
    // "Add 2000 for Ravi" is an invoice on the Invoices screen and an expense
    // on the Money screen; without this the model has to guess, and it guesses
    // wrong roughly half the time. Purely a hint — never a permission, never a
    // routing decision, so a forged value can only produce a worse guess.
    page_context  = null,
    // The business the global Aaria dock is on (a /b/... screen). Used ONLY
    // for attendance / stock / payroll, never as workspace_id: that would
    // switch on the older ledger path below for every money sentence.
    business_workspace_id = null,
  } = body

  // Which business attendance / stock / payroll act in. A business capture
  // (workspace_id) or the dock on a business screen. Never trusted alone:
  // check_biz_permission confirms the person's role in it before any
  // business table is read or written.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const bizWorkspaceId = [workspace_id, business_workspace_id]
    .find((w) => typeof w === 'string' && UUID.test(w)) || null

  // How this sentence was heard (Aaria's engine or the phone, how long, what
  // ended the turn) - trimmed to a few known fields, null when not sent.
  const listenEvidence = cleanListenEvidence(body.listen)

  // How long the PREVIOUS turn's reply took to reach the phone, and whether a
  // thinking sound filled the wait (plan item 10). The dock can only know
  // that after the reply arrives, so it rides on the next request. Stored as
  // its own audit row; never read by anything below, never a reason to refuse.
  const turnTiming = cleanTurnTiming(body.prev_turn)
  if (turnTiming) {
    supabase.from('audit_log').insert({
      user_id: user.id,
      action:  'voice_turn_timing',
      service: 'voice_capture',
      details: turnTiming,
    }).then(({ error }) => { if (error) console.error('[capture] audit:', error.message) })
  }

  if (!transcript || !transcript.trim()) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
  }

  // ── UNSTUTTER FIRST. EVERYTHING DOWNSTREAM INHERITS THIS STRING. ──────────
  //
  // The Android voice service does not stream. Its own header states the
  // pipeline in full:
  //
  //   mic -> 3s WAV chunk -> POST /api/groq-stt -> transcript
  //       -> POST /api/voice/capture
  //
  // Consecutive three-second chunks overlap, each is transcribed on its own,
  // and the results are concatenated. So a single sentence arrives as its own
  // growing prefixes strung together:
  //
  //   "remind remind me remind me to remind me to remind me to call remind me"
  //   "ఐదు ఐదు ఐదు ఐదు ఐదు నిమిషాల్లో ఐదు నిమిషాల్లో ఐదు నిమిషాల్లో"
  //
  // Both were saved verbatim as the user's own note on 26 September 2026, and
  // the second one is why "five minutes" could not be found: the words were
  // there, buried in four copies of themselves.
  //
  // Cleaning it HERE rather than inside the time parser (where #108 put it)
  // means the saved note is readable too, on every client at once, with no app
  // build — the app is a shell around this website.
  //
  // THIS IS NOT THE REAL FIX. The real fix is step 11 of the plan: QuietKeep
  // streams to the engine instead of posting chunks, and then there are no
  // overlapping transcripts to repair. This keeps the product usable until
  // that lands, and it is deliberately the only place it is done.
  const rawText = collapseRepeats(transcript.trim())
  const text    = stripWakePhrase(rawText) || rawText
  const turnStartTime = new Date().toISOString()
  // Only the phone turns a run on (it sends tasks100_run). Validate it; ignore anything odd.
  const rawRun = body?.tasks100_run
  const runTaskId = rawRun && typeof rawRun === 'object' && typeof rawRun.task_id === 'string'
    ? rawRun.task_id.trim().slice(0, 64)
    : ''
  const tasks100Run = runTaskId && /^[\w.-]+$/.test(runTaskId) ? { task_id: runTaskId } : null
  let lastStepRecord = null
  const logStep = (p) => {
    if (!tasks100Run) return null
    // persist:false: the server only returns the step; the phone stores it.
    const s = recordStep({ ...p, startTime: turnStartTime, run: tasks100Run, persist: false })
    if (s) lastStepRecord = s
    return s
  }

  // ── IS THIS SOMETHING A PERSON SAID? ─────────────────────────────────────
  //
  // Everything below this line assumed so. Nothing had ever asked.
  //
  // On 28 September 2026 three notes reached the founder's own account:
  //
  //     ాకంగడండు
  //     ప్ిరా నగటాయారాగిడిా.
  //     ప్ని పగానామారాిరాం ండు గ్ామారాం చిలామ్రాిండాా.
  //
  // Not words, not sentences, not even misspellings. An always-on microphone
  // heard room noise, the recogniser returned its best guess, and this route
  // filed each guess as his writing. His open keeps went from 69 to 71 while
  // he was not speaking, and the "stale, unresolved" banner on his home screen
  // counted them as work he had left undone.
  //
  // The check is orthographic, never editorial: it looks for sequences that
  // cannot occur in written Telugu or Devanagari at all. It does NOT ask
  // whether the text seems sensible. A shopping list looks like nonsense and a
  // name looks like a typo, and discarding one of someone's real notes is a far
  // worse failure than storing one line of noise.
  //
  // Placed before the idempotency key and before every write, so noise costs
  // one cheap scan and touches nothing.
  // A transcript with no letter or digit in it at all (3 October 2026: a keep
  // whose whole content was a pair of quotation marks, made from a silent
  // room) is not writing in any language.
  const noiseReasons = /[\p{L}\p{N}]/u.test(text) ? impossibleSequences(text) : ['no words at all']
  if (noiseReasons.length) {
    console.warn('[capture] refused transcription noise:', noiseReasons[0], JSON.stringify(text.slice(0, 80)))
    supabase.from('audit_log').insert({
      user_id: user.id,
      action:  'transcript_rejected_as_noise',
      service: 'voice_capture',
      details: { reason: noiseReasons[0], sample: text.slice(0, 120), source, language },
    }).then(({ error }) => { if (error) console.error('[capture] audit:', error.message) })

    // Answer, rather than going quiet. An assistant that heard nothing usable
    // should say so, in the language it was spoken to in.
    const DIDNT_CATCH = {
      en: "Sorry, I didn't catch that. Could you say it again?",
      te: 'క్షమించండి, నాకు అర్థం కాలేదు. మళ్ళీ చెప్పగలరా?',
      hi: 'माफ़ कीजिए, मैं समझ नहीं पाई। फिर से कहिए?',
    }
    const lang = String(language || 'en-IN').split('-')[0]
    return NextResponse.json({
      ok: false,
      not_saved: true,
      reason: 'transcription_noise',
      detail: noiseReasons[0],
      tts_response: DIDNT_CATCH[lang] || DIDNT_CATCH.en,
    })
  }

  // ── TOO LITTLE SPEECH TO TRUST (plan item 5, short commands) ─────────────
  // 3 Oct 2026: of 11 turns with 1.4 s of speech or less, 8 came back as an
  // invented phrase ("Surya Exactly", "I mean,") and were saved or acted on.
  // When the phone measured the speech and it was shorter than the bar, ask
  // again; write nothing, do nothing. Answer turns and unmeasured turns pass
  // (see src/lib/fragment-guard.js). Placed before the idempotency key and
  // every write, like the noise check above.
  if (isFragment({ listen: listenEvidence, answering: body.answering === true })) {
    supabase.from('audit_log').insert({
      user_id: user.id,
      action:  'transcript_rejected_as_fragment',
      service: 'voice_capture',
      details: { speech_ms: measuredSpeechMs(listenEvidence), heard_ms: listenEvidence?.heardMs ?? null, sample: text.slice(0, 120), source, language },
    }).then(({ error }) => { if (error) console.error('[capture] audit:', error.message) })
    return NextResponse.json({
      ok: false,
      not_saved: true,
      reason: 'speech_fragment',
      speech_ms: measuredSpeechMs(listenEvidence),
      tts_response: caughtPartReply(language),
    })
  }

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

  // ── "DELETE 'CALL RAVI TOMORROW'? YES OR NO?" ─────────────────────────────
  // A voice delete is read back first (below, where the brain says "delete")
  // and recorded as an audit row. This turn may be the answer. Only a spoken
  // yes (isSpokenYes) carries it out, only when the level table says do, and
  // carrying out means ARCHIVE - status closed + archived_at, what the app
  // already does - never a hard delete. "No" keeps it. Anything else is a new
  // instruction: the question lapses and the sentence is read as usual.
  const unlockedNow = ['voice', 'text'].includes(source)
  const { data: deleteRows } = await supabase
    .from('audit_log')
    .select('action,details,created_at')
    .eq('user_id', user.id)
    .in('action', [DELETE_ASKED, DELETE_ANSWERED, BIZ_ASKED, BIZ_ANSWERED])
    .order('created_at', { ascending: false })
    .limit(1)
    .then((r) => (r.error ? { data: null } : r))
  // The newest question is the only open one: a delete asked after a
  // business read-back replaces it, and the other way round.
  const askedDelete = pendingDelete(deleteRows)
  if (askedDelete) {
    const said = readDeleteAnswer(text)
    const lang = askedDelete.lang || language
    const record = (outcome, extra = {}) => supabase.from('audit_log').insert({
      user_id: user.id, action: DELETE_ANSWERED, service: 'voice_capture',
      details: { keep_id: askedDelete.keep_id, outcome, heard: text.slice(0, 120), source, ...extra },
    }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })

    if (said === 'no') {
      record('kept')
      return NextResponse.json({
        ok: true, not_saved: true, deleted: false, delete_answer: 'no',
        tts_response: line('delete_kept', lang),
      }, { status: 200 })
    }
    if (said === 'yes') {
      const { count: doneThisHour } = await supabase
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('action', 'action.spoken_yes')
        .gte('created_at', new Date(Date.now() - 3_600_000).toISOString())
        .then((r) => ({ count: r.error ? null : (r.count ?? 0) }))
      const delSafety = deleteDecision({ spokenYes: true, unlocked: unlockedNow, doneThisHour })
      logStep({
        heardText: text,
        decidedAction: 'delete_note',
        level: delSafety.level,
        decision: delSafety.decision,
        askedConfirmation: false,
        result: delSafety.decision === DECISION.DO ? 'success' : 'refused',
      })
      if (delSafety.decision !== DECISION.DO) {
        record('held', { reason: delSafety.reason })
        return NextResponse.json({
          ok: false, not_saved: true, deleted: false, safety: delSafety,
          tts_response: line('delete_held', lang),
        }, { status: 200 })
      }
      const { data: archived, error: archiveError } = await supabase
        .from('keeps')
        .update(archivePatch())
        .eq('id', askedDelete.keep_id)
        .eq('user_id', user.id)
        .is('archived_at', null)
        .select('id,content')
        .maybeSingle()
      if (archiveError || !archived) {
        record('failed', { error: archiveError?.message?.slice(0, 120) || 'not_found' })
        return NextResponse.json({
          ok: false, not_saved: true, deleted: false, safety: delSafety,
          tts_response: line('delete_failed', lang),
        }, { status: 200 })
      }
      // An archived reminder must not still ring.
      await supabase.from('reminders').update({ is_active: false })
        .eq('keep_id', archived.id).eq('user_id', user.id)
        .then(({ error }) => { if (error) console.error('[capture] reminder deactivate:', error.message) })
      record('archived')
      supabase.from('audit_log').insert({
        user_id: user.id, action: 'action.spoken_yes', service: 'voice_capture',
        details: { keep_id: archived.id, type: BRAIN_TYPE.delete, level: delSafety.level, reason: delSafety.reason, source },
      }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })
      return NextResponse.json({
        ok: true, not_saved: true, deleted: true, archived_keep_id: archived.id, safety: delSafety,
        tts_response: line('delete_done', lang, archived.content || askedDelete.content),
      }, { status: 200 })
    }
    record('lapsed')
  }

  // ── "MARK RAVI ABSENT TODAY? YES OR NO?" ──────────────────────────────────
  // Attendance and stock are read back first (below, where the brain names
  // them) and the read-back is recorded as an audit row. This turn may be the
  // answer. Only a spoken yes (isSpokenYes) writes, only in the workspace the
  // question was asked in, only when the level table says do. "No" changes
  // nothing. Anything else is a new instruction and the question lapses.
  const askedBiz = pendingBiz(deleteRows, bizWorkspaceId)
  if (askedBiz) {
    const said = readBizAnswer(text)
    const pend = askedBiz.pending
    const lang = askedBiz.lang || language
    const record = (outcome, extra = {}) => supabase.from('audit_log').insert({
      user_id: user.id, action: BIZ_ANSWERED, service: 'voice_capture',
      details: { workspace_id: bizWorkspaceId, type: pend.type, outcome, heard: text.slice(0, 120), source, ...extra },
    }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })

    if (said === 'no') {
      record('kept')
      return NextResponse.json({
        ok: true, not_saved: true, business_written: false, biz_answer: 'no',
        tts_response: bizLine('biz_kept', lang),
      }, { status: 200 })
    }
    if (said === 'yes') {
      // The person's role is checked again at the moment of writing.
      const [resource, act] = BIZ_PERMISSION[pend.type] || []
      const { data: allowed } = await supabase.rpc('check_biz_permission', {
        p_user_id: user.id, p_workspace_id: bizWorkspaceId, p_resource: resource, p_action: act,
      }).then((r) => (r.error ? { data: false } : r))
      if (allowed !== true) {
        record('refused', { reason: 'no_permission' })
        return NextResponse.json({
          ok: false, not_saved: true, business_written: false,
          tts_response: bizLine('no_permission', lang),
        }, { status: 200 })
      }
      const { count: doneThisHour } = await supabase
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('action', 'action.spoken_yes')
        .gte('created_at', new Date(Date.now() - 3_600_000).toISOString())
        .then((r) => ({ count: r.error ? null : (r.count ?? 0) }))
      const bizSafety = bizDecision(pend.type, { spokenYes: true, unlocked: unlockedNow, doneThisHour })
      logStep({
        heardText: text,
        decidedAction: pend.type,
        level: bizSafety.level,
        decision: bizSafety.decision,
        askedConfirmation: false,
        result: bizSafety.decision === DECISION.DO ? 'success' : (bizSafety.decision === DECISION.ASK_UNLOCK ? 'pending_confirmation' : 'refused'),
      })
      if (bizSafety.decision !== DECISION.DO) {
        // A locked phone: the question stays OPEN (a separate audit action,
        // not BIZ_ANSWERED), so the yes said after unlocking still answers it.
        // Anything else (hourly limit, paused): the question is closed.
        const unlockOnly = bizSafety.decision === DECISION.ASK_UNLOCK
        if (unlockOnly) {
          supabase.from('audit_log').insert({
            user_id: user.id, action: 'voice.biz_held', service: 'voice_capture',
            details: { workspace_id: bizWorkspaceId, type: pend.type, reason: bizSafety.reason, source },
          }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })
        } else {
          record('refused', { reason: bizSafety.reason })
        }
        return NextResponse.json({
          ok: false, not_saved: true, business_written: false, safety: bizSafety,
          tts_response: bizLine(unlockOnly ? 'biz_held' : 'biz_refused', lang),
        }, { status: 200 })
      }

      let writeError = null
      let written = pend
      if (pend.type === BIZ_TYPE.attendance) {
        const rows = attendanceRows(pend, { workspaceId: bizWorkspaceId, userId: user.id })
        const { error } = rows.length
          ? await supabase.from('attendance_logs').upsert(rows, { onConflict: 'workspace_id,member_id,log_date' })
          : { error: { message: 'no_rows' } }
        writeError = error
      } else if (pend.type === BIZ_TYPE.stock) {
        // Re-read the item: stock may have moved since the read-back (a sale
        // on another phone). The change said aloud is applied to what is
        // there NOW; "out of stock" is still zero.
        let p = pend
        if (pend.item_id) {
          const { data: fresh } = await supabase.from('inventory_items')
            .select('id,current_stock').eq('id', pend.item_id).eq('workspace_id', bizWorkspaceId).maybeSingle()
          if (!fresh) writeError = { message: 'item_gone' }
          else {
            const now = Number(fresh.current_stock) || 0
            const after = pend.op === 'out' ? 0 : now + pend.change
            p = { ...pend, before: now, change: after - now, after }
          }
        }
        const w = writeError ? null : stockWrites(p, { workspaceId: bizWorkspaceId })
        if (!writeError && !w) writeError = { message: 'would_go_below_zero' }
        if (w?.insertItem) {
          const { data: created, error } = await supabase.from('inventory_items').insert(w.insertItem).select('id').single()
          writeError = error
          if (created) w.movement.item_id = created.id
        } else if (w?.update) {
          const { error } = await supabase.from('inventory_items')
            .update({ current_stock: w.update.current_stock, updated_at: w.update.updated_at })
            .eq('id', w.update.id).eq('workspace_id', bizWorkspaceId)
          writeError = error
        }
        if (!writeError && w) {
          await supabase.from('stock_movements').insert(w.movement)
            .then(({ error }) => { if (error) console.error('[capture] stock movement:', error.message) })
        }
        written = p
      } else {
        writeError = { message: 'unknown_type' }
      }
      if (writeError) {
        record('failed', { error: String(writeError.message || '').slice(0, 120) })
        return NextResponse.json({
          ok: false, not_saved: true, business_written: false, safety: bizSafety,
          tts_response: bizLine('biz_failed', lang),
        }, { status: 200 })
      }
      record('written')
      supabase.from('audit_log').insert({
        user_id: user.id, action: 'action.spoken_yes', service: 'voice_capture',
        details: { workspace_id: bizWorkspaceId, type: pend.type, level: bizSafety.level, reason: bizSafety.reason, source },
      }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })
      return NextResponse.json({
        ok: true, not_saved: true, business_written: true, business_type: pend.type, safety: bizSafety,
        tts_response: doneLine(written, lang),
      }, { status: 200 })
    }
    record('lapsed')
  }

  // ── IS THIS THE ANSWER TO THE QUESTION WE JUST ASKED? ────────────────────
  //
  // Aaria asks "When should I remind you to call Surya Kiran?" and then, when
  // the user taps speak and says "five minutes", parses those two words from
  // scratch as a brand-new instruction. The question is never answered and the
  // user is left tapping into a void.
  //
  // This looks for a question opened in the last five minutes and applies the
  // answer to THAT keep.
  //
  // WHY THIS IS SAFE TO PUT AHEAD OF THE PARSER
  // readAnswer() returns null for anything at all doubtful - no recent
  // question, a long sentence, words that do not resolve to a time. On null,
  // execution falls through to exactly the code that ran before, unchanged.
  // The only way to enter this branch is a short utterance that resolves to a
  // moment while a question is genuinely open.
  //
  // The guard that matters is length: a long sentence is a new instruction
  // even when a question is outstanding. Swallowing one would lose a note the
  // user believed they had saved, and nothing would show them why.
  const { data: openQuestion } = await supabase
    .from('keeps')
    .select('id,content,voice_text,contact_name,contact_phone,follow_up,reminder_at,created_at,space_type,workspace_id,location_name,geo_trigger_enabled')
    .eq('user_id', user.id)
    .not('follow_up', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // A tap on one of the offered names arrives as answer_contact_id.
  const tappedId = typeof body.answer_contact_id === 'string' ? body.answer_contact_id : null
  const answer = openQuestion ? readAnswer(openQuestion, text, Date.now(), { contactId: tappedId }) : null

  // ── THE QUESTION IS STILL OPEN AND THIS IS NOT YET AN ANSWER ─────────────
  // Two cases that used to fall through and be filed as brand-new keeps:
  //   1. "Venu Nz" when two contacts are called exactly that - ask again about
  //      just those two (they are told apart by the end of the number).
  //   2. The same sentence said again - someone retrying, not a second
  //      reminder. Ask the same question again; save nothing.
  if (!answer && openQuestion && isPendingQuestion(openQuestion)) {
    const isContactQ = openQuestion.follow_up?.action_hint === 'disambiguate_contact'
    const short = text.split(/\s+/).filter(Boolean).length <= 8
    const narrowed = isContactQ && short ? narrowContacts(text, openQuestion.follow_up.contacts) : []
    const repeat = isRepeatOfOpenQuestion(openQuestion, text)
    if (narrowed.length >= 2 || repeat) {
      let fu = openQuestion.follow_up
      if (narrowed.length >= 2) {
        fu = { ...fu, contacts: narrowed }
        await supabase.from('keeps')
          .update({ follow_up: fu, updated_at: new Date().toISOString() })
          .eq('id', openQuestion.id).eq('user_id', user.id)
      }
      const choices = isContactQ ? contactChoices(fu.contacts) : null
      const ask = isContactQ
        ? (narrowed.length >= 2
            ? `There are ${narrowed.length} called ${narrowed[0].name}. Tap the right number, or say first or second.`
            : spokenContactQuestion(fu.suggested_name, fu.contacts))
        : fu.follow_up
      return NextResponse.json({
        keep:              openQuestion,
        intent:            openQuestion,
        answered_question: false,
        asked_again:       true,
        follow_up:         fu,
        choices,
        reminder_at:       openQuestion.reminder_at || null,
        tts_response:      ask,
      }, { status: 200 })
    }
  }

  if (answer) {
    const patch = { follow_up: null, updated_at: new Date().toISOString() }
    if (answer.kind === 'time') patch.reminder_at = answer.reminderAt.toISOString()
    if (answer.kind === 'contact') {
      patch.contact_name  = answer.contact.name
      patch.contact_phone = answer.contact.phone || null
      // The reminders row is what the native alarm reads the number from
      // (src/lib/reminder-voice.js). Without this the keep would know who to
      // call and the alarm still would not.
      await supabase
        .from('reminders')
        .update({ contact_name: answer.contact.name, contact_phone: answer.contact.phone || null })
        .eq('keep_id', openQuestion.id)
        .eq('user_id', user.id)
        .then(({ error }) => { if (error) console.error('[capture] reminder contact update:', error.message) })
    }

    const { data: resolvedKeep } = await supabase
      .from('keeps')
      .update(patch)
      .eq('id', openQuestion.id)
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle()

    let answeredReminder = null
    if (answer.kind === 'time') {
      // Written the same way and with the same fields as the main path below.
      // contact_phone especially: src/lib/reminder-voice.js reads it off THIS
      // row, not off the keep, and only attaches a call action when it is here.
      try {
        const { data: rem } = await supabase
          .from('reminders')
          .insert({
            user_id:       user.id,
            keep_id:       openQuestion.id,
            reminder_text: openQuestion.voice_text || openQuestion.content || text,
            scheduled_for: answer.reminderAt.toISOString(),
            is_active:     true,
            space_type:    openQuestion.space_type || 'personal',
            contact_name:  openQuestion.contact_name  || null,
            contact_phone: openQuestion.contact_phone || null,
          })
          .select('*')
          .maybeSingle()
        answeredReminder = rem
      } catch (remErr) {
        console.error('[capture] answered-question reminder insert failed:', remErr)
      }
    }

    supabase.from('audit_log').insert({
      user_id: user.id,
      action:  'keep.follow_up_answered',
      service: 'voice_capture',
      details: {
        keep_id: openQuestion.id,
        action_hint: openQuestion.follow_up?.action_hint || null,
        answer_kind: answer.kind,
        answer_text: text,
      },
    }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })

    // ── THE SAFETY CHECK, FOR "NOW" ────────────────────────────────────────
    // "Call Surya Kiran?" ... "now" is the person's spoken yes to a call they
    // just heard read back. Until 13 Oct 2026 the server replied "Calling Surya
    // now." and NOTHING dialled: call_now was returned and no client read it -
    // a false "done", the exact failure the plan's item 1 counts (target 0).
    // Now the level table decides (src/lib/action-levels.js): a saved contact
    // needs spoken yes + an unlocked phone; the app being in the foreground
    // ('voice' / 'text' sources) is the unlock proof we have today. When it
    // says do, the response carries auto_exec and the phone dials; when it
    // does not, the reply says why in plain words and nothing is claimed.
    let nowExec = null
    let nowSafety = null
    let nowTts = answerConfirmation(answer, openQuestion)
    if (answer.kind === 'now') {
      const { count: doneThisHour } = await supabase
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('action', 'action.spoken_yes')
        .gte('created_at', new Date(Date.now() - 3_600_000).toISOString())
        .then((r) => ({ count: r.error ? null : (r.count ?? 0) }))
      nowSafety = decide(
        { type: 'contact', contactSaved: !!openQuestion.contact_phone },
        { spokenYes: true, unlocked: ['voice', 'text'].includes(source), pin: false, ownerVoice: null },
        { doneThisHour },
      )
      nowSafety.unlock_proof = ['voice', 'text'].includes(source) ? 'app_in_foreground' : null
      logStep({
        heardText: text,
        decidedAction: 'contact',
        level: nowSafety.level,
        decision: nowSafety.decision,
        askedConfirmation: false,
        result: nowSafety.decision === DECISION.DO ? 'success' : 'refused',
      })
      if (nowSafety.decision === DECISION.DO && openQuestion.contact_phone) {
        nowExec = {
          keep_id:       openQuestion.id,
          intent_type:   'contact',
          confidence:    1,
          contact_name:  openQuestion.contact_name || null,
          contact_phone: openQuestion.contact_phone,
          content:       openQuestion.content || text,
          delay_ms:      1000,
          proof:         'spoken_yes',
        }
        supabase.from('audit_log').insert({
          user_id: user.id, action: 'action.spoken_yes', service: 'voice_capture',
          details: { keep_id: openQuestion.id, level: nowSafety.level, reason: nowSafety.reason, source },
        }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })
      } else {
        // Never "Calling now." for a call that will not be placed.
        const who = openQuestion.contact_name || 'them'
        nowTts = ({
          needs_unlocked_phone: `Unlock the phone, then say now again to call ${who}.`,
          hourly_limit_reached: `That is the limit of calls for this hour. ${who} is saved as a reminder.`,
          hourly_count_unknown: `I could not check the hourly limit just now, so I have not called ${who}.`,
          needs_pin:            `${who} is not a saved contact, so that needs your fingerprint or PIN in the app.`,
          actions_paused:       `Actions are paused from your settings, so I have not called ${who}.`,
        })[nowSafety.reason] || `I have not called ${who} just now.`
      }
    }

    return NextResponse.json({
      keep:              resolvedKeep || openQuestion,
      intent:            resolvedKeep || openQuestion,
      answered_question: true,
      answer_kind:       answer.kind,
      reminder:          answeredReminder,
      safety:            nowSafety,
      auto_exec:         nowExec,
      // A resolved contact keeps the reminder's existing time - returned so
      // the client re-arms the native alarm with the number now attached.
      reminder_at:       answer.kind === 'time' ? answer.reminderAt.toISOString()
                       : answer.kind === 'contact' ? (openQuestion.reminder_at || null)
                       : null,
      call_now:          answer.kind === 'now' && !!nowExec,
      contact_matched:   answer.kind === 'contact'
        ? { name: answer.contact.name, phone: answer.contact.phone || null }
        : openQuestion.contact_phone
          ? { name: openQuestion.contact_name, phone: openQuestion.contact_phone }
          : null,
      tts_response:      nowTts,
    }, { status: 200 })
  }

  // ── A YES OR NO THAT ANSWERS NOTHING ──────────────────────────────────────
  // Every real answer has returned above. A bare "yes" / "avunu" / "haan" /
  // "no" left over here answers no question, and was saved as a reminder
  // four times out of six when the brain read it (run 38719122967). Decided
  // before the brain runs, so it holds when the brain is down too. With a
  // question still open, that question is asked again; otherwise Aaria asks
  // what they mean. Nothing is saved.
  if (isStrayConfirmation(text)) {
    const plan = planNoKeepTurn({
      intent: 'confirm', language,
      pendingQuestionText: openQuestion && isPendingQuestion(openQuestion) ? askAgain(openQuestion) : null,
    })
    logStep({
      heardText: text,
      decidedAction: 'confirm',
      level: plan.safety?.level,
      decision: plan.safety?.decision,
      askedConfirmation: false,
      result: 'success',
    })
    supabase.from('audit_log').insert({
      user_id: user.id, action: 'voice.no_keep', service: 'voice_capture',
      details: { kind: 'stray_confirmation', heard: text.slice(0, 120), source, language },
    }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })
    return NextResponse.json({
      ok: true, not_saved: true, reason: 'stray_confirmation', safety: plan.safety,
      tts_response: plan.tts,
    }, { status: 200 })
  }

  let parsed = parseIntent(text)
  let reminderAt = computeReminderAt(parsed.entities, undefined, text)

  // ── Understanding brain (multilingual) ────────────────────────────────────
  // The regex parser is English-first: anything it cannot match becomes a
  // generic 'note' and nothing happens. Run the LLM whenever the regex result
  // is weak OR the user did not speak English, then upgrade the parse.
  // Entirely fail-safe: if the brain is unavailable we keep the regex result.
  // The decision and its reasons live in src/lib/understanding-record.js so
  // the audit row can carry WHY the brain ran (or did not). The rules are the
  // ones that used to sit inline here: regex weak, non-English, money-shaped
  // (the regex is confidently wrong about money direction - measured 13 Aug
  // 2026), romanised Hindi/Telugu arriving tagged en-IN, or a reminder the
  // regex found no time for.
  const brainDecision = whyBrainRun({ parsed, text, language, reminderAt })
  let llmAssist = null
  let brainLatencyMs = null
  let brainFailure = null

  if (brainDecision.run) {
    const t0 = Date.now()
    llmAssist = await aariaUnderstandLLM(text, {
      language,
      nowISO: new Date().toISOString(),
      timezone: 'Asia/Kolkata',
      workspaceMode: workspace_id ? 'business' : 'personal',
      // Trimmed hard: this goes into a prompt, and an unbounded client string
      // in a prompt is how injection gets in. A screen label is never long.
      pageLabel: typeof page_context?.label === 'string'
        ? page_context.label.replace(/[^\w &/-]/g, '').slice(0, 40)
        : null,
      onFailure: (reason) => { brainFailure = reason },
    }).catch((err) => { brainFailure = brainFailure || (err?.name === 'AbortError' ? 'timeout' : 'threw'); return null })
    brainLatencyMs = Date.now() - t0
  }

  // What happened in the understanding step, in a shape safe to store forever:
  // no prompt, no key, no raw model text. This is the field that was missing
  // on 30 September when "5 నిమిషాల్లో సూర్య కిరణ్‌కి కాల్ చెయ్యి" drew "when?"
  // and nothing on record could say whether the brain ran, timed out, or ran
  // and simply saw no time in a garbled transcript.
  const understanding = describeUnderstanding({
    decision: brainDecision, llmAssist, latencyMs: brainLatencyMs, failure: brainFailure, threshold: 0.55,
  })

  // ── CONFIRM / DELETE / PAY / NONE: REPLY, SAVE NOTHING ────────────────────
  // src/lib/brain-turn.js has the rules; src/lib/action-levels.js the levels.
  if (llmAssist && llmAssist.confidence >= 0.55 && NO_KEEP_INTENTS.has(llmAssist.intent)) {
    const replyLang = llmAssist.language || language
    let tts = null
    let safety = null
    let deleteTarget = null
    if (llmAssist.intent === 'delete') {
      // Open items only, this person's, in this workspace.
      let q = supabase
        .from('keeps')
        .select('id,content,voice_text,contact_name,intent_type,created_at')
        .eq('user_id', user.id)
        .is('archived_at', null)
        .in('status', ['open', 'active', 'blocked', 'deferred', 'reminded'])
        .order('created_at', { ascending: false })
        .limit(100)
      q = workspace_id ? q.eq('workspace_id', workspace_id) : q.is('workspace_id', null)
      const { data: openItems } = await q.then((r) => (r.error ? { data: [] } : r))
      const found = matchKeepForDelete(openItems || [], {
        item: llmAssist.entities?.item || null,
        person: llmAssist.entities?.person || null,
        text,
      })
      tts = deleteQuestion(found, replyLang)
      safety = deleteDecision({ spokenYes: false, unlocked: unlockedNow, doneThisHour: 0 })
      logStep({
        heardText: text,
        decidedAction: 'delete_note',
        level: safety.level,
        decision: safety.decision,
        askedConfirmation: true,
        result: 'pending_confirmation',
      })
      if (found.match) {
        deleteTarget = { id: found.match.id, content: found.match.content }
        // The read-back is the question; the next turn's yes answers it.
        await supabase.from('audit_log').insert({
          user_id: user.id, action: DELETE_ASKED, service: 'voice_capture',
          details: { keep_id: found.match.id, content: String(found.match.content || '').slice(0, 200), lang: replyLang, source },
        }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })
      }
    } else {
      const plan = planNoKeepTurn({
        intent: llmAssist.intent, brainReply: llmAssist.reply, language: replyLang,
        pendingQuestionText: openQuestion && isPendingQuestion(openQuestion) ? askAgain(openQuestion) : null,
      })
      tts = plan.tts
      safety = plan.safety
      logStep({
        heardText: text,
        decidedAction: llmAssist.intent,
        level: safety?.level,
        decision: safety?.decision,
        askedConfirmation: ['ask_yes', 'ask_unlock', 'ask_pin'].includes(safety?.decision),
        result: safety?.decision === DECISION.REFUSE ? 'refused' : 'success',
      })
    }
    supabase.from('audit_log').insert({
      user_id: user.id, action: 'voice.no_keep', service: 'voice_capture',
      details: { kind: llmAssist.intent, heard: text.slice(0, 120), source, language, understanding, delete_target: deleteTarget?.id || null },
    }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })
    return NextResponse.json({
      ok: true,
      not_saved: true,
      reason: llmAssist.intent,
      delete_target: deleteTarget,
      awaiting_yes: !!deleteTarget,
      safety,
      understanding,
      tts_response: tts,
    }, { status: 200 })
  }

  // ── ATTENDANCE / STOCK / PAYROLL: READ BACK, WRITE ONLY ON A SPOKEN YES ───
  // src/lib/business-voice.js has the rules. This turn never writes a
  // business record: attendance and stock are read back and wait for the next
  // turn's yes (above); a stock question and the payroll draft only answer.
  // No keep is saved either way. Personal mode writes nothing at all.
  if (llmAssist && llmAssist.confidence >= 0.55 && BUSINESS_INTENTS.has(llmAssist.intent)) {
    const replyLang = llmAssist.language || language
    const intent = llmAssist.intent
    const ents = llmAssist.entities || {}
    const audit = (kind, extra = {}) => supabase.from('audit_log').insert({
      user_id: user.id, action: 'voice.no_keep', service: 'voice_capture',
      details: { kind, heard: text.slice(0, 120), source, language, understanding, workspace_id: bizWorkspaceId || null, ...extra },
    }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })

    if (!bizWorkspaceId) {
      audit(`${intent}_personal_mode`)
      return NextResponse.json({
        ok: true, not_saved: true, reason: 'business_only', business_written: false, understanding,
        tts_response: bizLine('business_only', replyLang),
      }, { status: 200 })
    }

    const op = intent === 'stock' ? stockOp(ents.stockOp, text, ents.quantity) : null
    const permKey = intent === 'stock' && op === 'check' ? 'stock_check' : intent
    const [resource, act] = BIZ_PERMISSION[permKey]
    const { data: allowed } = await supabase.rpc('check_biz_permission', {
      p_user_id: user.id, p_workspace_id: bizWorkspaceId, p_resource: resource, p_action: act,
    }).then((r) => (r.error ? { data: false } : r))
    if (allowed !== true) {
      audit(`${intent}_no_permission`)
      return NextResponse.json({
        ok: true, not_saved: true, reason: 'no_permission', business_written: false, understanding,
        tts_response: bizLine('no_permission', replyLang),
      }, { status: 200 })
    }

    let plan
    let payrollOut = null
    if (intent === 'attendance') {
      const { data: members } = await supabase.from('business_members')
        .select('id,name').eq('workspace_id', bizWorkspaceId).eq('status', 'active').order('name').limit(500)
        .then((r) => (r.error ? { data: [] } : r))
      plan = planAttendance({
        members: members || [], person: ents.person, status: ents.status,
        datetimeISO: ents.datetimeISO, text, language: replyLang,
      })
    } else if (intent === 'stock') {
      const { data: items } = await supabase.from('inventory_items')
        .select('id,name,sku,unit,current_stock').eq('workspace_id', bizWorkspaceId).limit(2000)
        .then((r) => (r.error ? { data: [] } : r))
      plan = planStock({
        items: items || [], item: ents.item, quantity: ents.quantity, unit: ents.unit, op, text, language: replyLang,
      })
    } else {
      const period = payPeriod()
      const [{ data: members }, { data: logs }] = await Promise.all([
        supabase.from('business_members')
          .select('id,name,salary_type,basic_salary,daily_wage').eq('workspace_id', bizWorkspaceId).eq('status', 'active').order('name').limit(500)
          .then((r) => (r.error ? { data: [] } : r)),
        supabase.from('attendance_logs')
          .select('member_id,log_date,status').eq('workspace_id', bizWorkspaceId)
          .gte('log_date', period.start).lte('log_date', period.end).limit(20000)
          .then((r) => (r.error ? { data: [] } : r)),
      ])
      const d = payrollDraft({ members: members || [], logs: logs || [], person: ents.person, text, language: replyLang })
      plan = { tts: d.tts, pending: null }
      payrollOut = d.draft
    }

    const type = BIZ_TYPE[intent]
    if (plan.pending) {
      // The read-back is the question; the next turn's yes answers it.
      await supabase.from('audit_log').insert({
        user_id: user.id, action: BIZ_ASKED, service: 'voice_capture',
        details: { workspace_id: bizWorkspaceId, type, pending: plan.pending, lang: replyLang, source },
      }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })
    }
    audit(intent, { op, awaiting_yes: !!plan.pending })
    return NextResponse.json({
      ok: true,
      not_saved: true,
      reason: intent,
      business_type: type,
      business_written: false,
      awaiting_yes: !!plan.pending,
      business_readback: plan.pending || null,
      payroll_draft: payrollOut,
      // Asking for a read-back: needs the yes. Answering only (payroll draft,
      // "how much is left"): read-back level, nothing written. Asking who or
      // how much: no decision yet.
      safety: (() => {
        const s = plan.pending
          ? bizDecision(type, { spokenYes: false, unlocked: unlockedNow, doneThisHour: 0 })
          : intent === 'payroll' ? decide({ type: BIZ_TYPE.payroll })
          : plan.readOnly ? decide({ type: 'stock_check' })
          : null;
        if (s) {
          logStep({
            heardText: text,
            decidedAction: type,
            level: s.level,
            decision: s.decision,
            askedConfirmation: ['ask_yes', 'ask_unlock', 'ask_pin'].includes(s.decision) || !!plan.pending,
            result: plan.pending ? 'pending_confirmation' : (s.decision === DECISION.DO ? 'success' : 'refused'),
          });
        }
        return s;
      })(),
      understanding,
      tts_response: plan.tts,
    }, { status: 200 })
  }

  if (llmAssist && llmAssist.confidence >= 0.55) {
    // Map the brain's vocabulary onto the intent types this app executes.
    const INTENT_MAP = {
      // Personal keeps have never used 'ledger_credit' (checked live: keeps has
      // note/task/reminder/contact/purchase/expense/compliance/invoice/document/
      // call/meeting only), so keep money-in as the plain, readable 'income'.
      ledger_credit: 'income',   // money received — was previously mis-filed as an expense
      query: 'note',
    }
    const mappedType = INTENT_MAP[llmAssist.intent] || llmAssist.intent

    // The brain wins whenever it answered at all. Comparing its confidence to
    // the regex's is meaningless — the regex reports 0.95 on the exact sentence
    // it gets backwards. The outer gate (>= 0.55) is the real guard, and if
    // Sarvam is down llmAssist is null and the regex result stands untouched.
    const brainWins = llmAssist.confidence >= 0.55
    if (brainWins) {
      parsed = {
        ...parsed,
        type: mappedType,
        confidence: llmAssist.confidence,
        entities: {
          ...(parsed.entities || {}),
          names: llmAssist.entities.person
            ? [llmAssist.entities.person]
            : (parsed.entities?.names || []),
          amount: llmAssist.entities.amount ?? parsed.entities?.amount ?? null,
          direction: llmAssist.entities.direction ?? null,
          item: llmAssist.entities.item ?? null,
        },
      }
    }

    // Absolute time from the brain wins — it resolves "రేపు ఉదయం" / "कल सुबह"
    // that computeReminderAt() cannot see.
    if (llmAssist.entities.datetimeISO) {
      const dt = new Date(llmAssist.entities.datetimeISO)
      if (!isNaN(dt.getTime()) && dt.getTime() > Date.now() - 60000) {
        reminderAt = dt
        // Write the resolved time back into entities. computeFollowUp() and
        // the timeAmbiguous check below both read parsed.entities, not
        // reminderAt — so without this the app saved and scheduled the
        // reminder and then still asked "When should I remind you?" and
        // showed the quick-time overlay. Fixed 22 Aug 2026.
        //
        // THE WALL CLOCK HERE IS THE USER'S, NOT THE SERVER'S.
        //
        // getFullYear/getHours/getMinutes resolve in the server's timezone, and
        // on Vercel that is UTC. A reminder correctly resolved to 17:39 IST was
        // written back as "12:09 pm", and every reader downstream took those
        // strings for Indian time. Aaria read 12:09 out loud, and the re-read
        // time landed five and a half hours in the PAST, so the reminder was
        // thrown away — after she had already said it was set.
        //
        // Seen live at 17:34 IST on 26 September 2026: keep
        // 1e426c18-b726-4cec-aed8-3530fa2ec00d, reminder_at NULL.
        //
        // This is the same mistake the DEFAULT_TZ comment in
        // src/lib/intent-executor.js was written to stop, on 22 August, after
        // every English voice reminder fired 5h30m late. A Date carries an
        // instant; reading a wall clock off it without naming a zone asks the
        // server where the user lives.
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Kolkata', hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
          }).formatToParts(dt)
            .filter((x) => x.type !== 'literal')
            .map((x) => [x.type, x.value])
        )
        const hh = parts.hour === '24' ? 0 : Number(parts.hour)
        parsed.entities = parsed.entities || {}
        parsed.entities.dates = [`${parts.year}-${parts.month}-${parts.day}`]
        parsed.entities.times = [
          `${(hh % 12) || 12}:${parts.minute} ${hh < 12 ? 'am' : 'pm'}`
        ]
      }
    }
  }

  // ── A PLACE THE BRAIN HEARD ───────────────────────────────────────────────
  //
  // The geo detector below is the English regex in intent-parser. On 1 Oct
  // 2026 "remind me to pick up beer when I reach Chintal Kunta" arrived as
  // Telugu letters (speech-to-text was set to Telugu), the regex saw no
  // "when I reach", and the reminder was saved as an alarm 30-60 minutes out
  // with no location - while Aaria read the moment he spoke back as the time.
  // The brain reads any language and script; when it names a place, that is
  // the trigger.
  const brainPlace = (llmAssist && llmAssist.confidence >= 0.55) ? llmAssist.entities?.place : null
  if (brainPlace && !parsed.geo?.detected) {
    parsed.geo = { detected: true, location_name: brainPlace, type: 'place', source: 'brain' }
    if (!['reminder', 'task'].includes(parsed.type)) parsed.type = 'reminder'
    // No clock time unless the user said one.
    if (!llmAssist.entities.datetimeISO) reminderAt = null
    // "Chintal Kunta" is somewhere to be, not someone to call.
    const p = brainPlace.toLowerCase()
    parsed.entities = parsed.entities || {}
    parsed.entities.names = (parsed.entities.names || []).filter(
      (n) => n && !p.includes(String(n).toLowerCase()) && !String(n).toLowerCase().includes(p))
  }

  // ── WHO THE USER MEANT ────────────────────────────────────────────────────
  //
  // ONE SHAPE. matchContactByName() returns a WRAPPER, and its own header says
  // so: null, { single: contact }, or { multiple: [...], ambiguous: true }.
  // computeFollowUp() and buildExecutionTTS() read `.single` correctly. This
  // file did not — it read `matchedContact?.phone`, which on a wrapper is
  // undefined — so keeps.contact_phone was written as null on every capture
  // ever made, and the auto-exec gate below (`type === 'contact' &&
  // !keep.contact_phone`) could never open. The business branch had the
  // mirror-image bug: a flat object, invisible to the two functions that expect
  // a wrapper. Normalised once, here, into a wrapper plus one flat object.
  //
  // WIDER SCOPE. Matching used to run only for contact/meeting/communication.
  // "Remind me to call Aravind in five minutes" parses as type 'reminder', so
  // the name was never looked up, the reminder carried no number, and at the
  // appointed minute the phone said the sentence aloud and stopped. Looking a
  // name up is a read: it dials nothing by itself, reminder and task remain
  // excluded from auto-exec further down, and computeFollowUp() only asks
  // contact questions for contact/meeting — so this adds no new questions.
  const nameEntity = parsed.entities?.names?.[0]
  const CONTACT_AWARE_TYPES = [
    'contact', 'meeting', 'communication',   // as before
    'reminder', 'task', 'call',              // "remind me to call Aravind"
  ]

  let matchedContact = null     // wrapper shape — for computeFollowUp + TTS
  let allContacts    = []

  if (CONTACT_AWARE_TYPES.includes(parsed.type) && nameEntity) {
    if (workspace_id) {
      const bizCust = await matchCustomer(supabase, workspace_id, nameEntity);
      if (bizCust) {
        matchedContact = {
          single: { id: bizCust.id, name: bizCust.name, phone: bizCust.phone },
          is_business: true,
        };
      }
    } else {
      ;[matchedContact, allContacts] = await Promise.all([
        matchContactByName(supabase, user.id, nameEntity),
        findAllMatchingContacts(supabase, user.id, nameEntity),
      ])
    }
  }

  // The one flat contact the rest of this file reads. Null when nobody matched,
  // and null when SEVERAL people matched and we have not asked which — a number
  // guessed from two Ravis is worse than no number at all.
  const resolvedContact   = matchedContact?.ambiguous ? null : (matchedContact?.single || null)
  const isBusinessContact = matchedContact?.is_business === true

  // Did the user ask to CALL this person, as opposed to merely naming them?
  // "Remind me to buy Venu a gift" names Venu and must not ask which Venu to
  // dial. Read off the user's own words, in the scripts they actually use.
  parsed.wants_call = /\b(call|ring|dial|phone)\b|కాల్|ఫోన్|कॉल|काल|फ़ोन|फोन/i.test(text)

  const followUp = computeFollowUp(parsed, matchedContact, reminderAt)

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
  let geoFromMap = false;   // the pin is a map lookup, i.e. our guess
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
      // "chintal kunta today" is not a place; "chintal kunta" is.
      parsed.geo.location_name = cleanPlaceName(parsed.geo.location_name) || parsed.geo.location_name;
      // Try to resolve from user's saved locations (e.g. "home", "office")
      const saved = await resolveLocation(supabase, user.id, parsed.geo.location_name);
      if (!saved) {
        // NOT SAVED YET - PUT IT ON THE MAP OURSELVES.
        // 30 Sep 2026: "pick beers near chintal kunta" was stored with a name
        // and no coordinates, geo_trigger_enabled=false, and could never
        // fire. A name is enough to geocode. Null on any failure, and then
        // the old "saved for later, tap Save here" path runs unchanged.
        // WHICH "Mansurabad"? The one near this person. Their phone's position
        // if it came with the request, otherwise a place they saved (home).
        // And "home"/"office" are never looked up on a map at all - see
        // src/lib/geocode.js for the two mistakes of 2-3 October behind this.
        const here = (typeof current_lat === 'number' && typeof current_lng === 'number')
          ? { latitude: current_lat, longitude: current_lng }
          : await anchorPoint(supabase, user.id);
        const pin = isPersonalPlace(parsed.geo.location_name) ? null
          : await geocodePlace(parsed.geo.location_name, {
              nearLat: here?.latitude ?? null,
              nearLng: here?.longitude ?? null,
            });
        if (pin) {
          console.log('[GEO] geocoded:', { name: parsed.geo.location_name, lat: pin.latitude, lng: pin.longitude, km_away: pin.distance_km ?? null });
          geoFromMap = true;
          geoData = {
            latitude: pin.latitude,
            longitude: pin.longitude,
            radius_meters: 300,
            location_name: prettyPlaceName(parsed.geo.location_name),
            geo_trigger_enabled: true,
          };
        }
      }
      if (geoData) {
        // geocoded above
      } else if (saved) {
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

  // ── "WHEN?" ANSWERED WITH A PLACE ─────────────────────────────────────────
  // Aaria asked when; the person said where ("when I reach Mansoorabad").
  // The place goes onto the keep the question was about - not into a second
  // keep that would itself be asked "when?". Rules in src/lib/follow-up-answer.js.
  if (geoData?.location_name
      && isPlaceAnswer(openQuestion, text, geoData.location_name, { hasTime: !!reminderAt })) {
    const { data: placedKeep } = await supabase
      .from('keeps')
      .update({ ...geoData, follow_up: null, updated_at: new Date().toISOString() })
      .eq('id', openQuestion.id)
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle()

    supabase.from('audit_log').insert({
      user_id: user.id,
      action:  'keep.follow_up_answered',
      service: 'voice_capture',
      details: {
        keep_id: openQuestion.id,
        action_hint: openQuestion.follow_up?.action_hint || null,
        answer_kind: 'place',
        answer_text: text,
        place: geoData.location_name,
        can_alert: !!geoData.geo_trigger_enabled,
        listen: listenEvidence,
      },
    }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })

    return NextResponse.json({
      keep:              placedKeep || openQuestion,
      intent:            placedKeep || openQuestion,
      answered_question: true,
      answer_kind:       'place',
      reminder:          null,
      reminder_at:       null,
      tts_response:      placeConfirmation(prettyPlaceName(geoData.location_name), !!geoData.geo_trigger_enabled),
    }, { status: 200 })
  }

  // ── AN ANSWER TURN THAT DID NOT ANSWER ───────────────────────────────────
  // The phone says this turn was opened by Aaria to hear the answer to her
  // own question (body.answering). Every real answer has already returned
  // above: a time, a contact, a tap, a place. What is left is short and
  // matched nothing - a mis-hearing. Ask again; write nothing.
  if (isUnmatchedAnswer(openQuestion, text, { answering: body.answering === true })) {
    const isContactQ = openQuestion.follow_up?.action_hint === 'disambiguate_contact'
    supabase.from('audit_log').insert({
      user_id: user.id,
      action:  'keep.follow_up_unmatched',
      service: 'voice_capture',
      details: {
        keep_id: openQuestion.id,
        action_hint: openQuestion.follow_up?.action_hint || null,
        heard: text.slice(0, 120),
        listen: listenEvidence,
      },
    }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })

    return NextResponse.json({
      keep:              openQuestion,
      intent:            openQuestion,
      answered_question: false,
      asked_again:       true,
      follow_up:         openQuestion.follow_up,
      choices:           isContactQ ? contactChoices(openQuestion.follow_up.contacts) : null,
      reminder_at:       openQuestion.reminder_at || null,
      tts_response:      askAgain(openQuestion),
    }, { status: 200 })
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
      // What the person MEANT, written readably: the brain's clean_text when it
      // gave one ("Remind me to pick up beer when I reach Chintal Kunta"),
      // otherwise exactly what was heard. voice_text always keeps the raw
      // recognition, so nothing the person said is ever lost to a rewrite.
      content:        (llmAssist && llmAssist.confidence >= 0.55 && llmAssist.modelCleanText) || text,
      voice_text:     text,
      // NOTE: keeps has NO ai_provider column — inserting it made PostgREST
      // reject the whole insert, so EVERY voice capture returned 500 in
      // production (found by QA acting as a real user, 30 Jul 2026).
      intent_type:    parsed.type !== 'unknown' ? parsed.type : 'note',
      confidence:     parsed.confidence,
      // Was hard-coded 'rule', so every keep the Sarvam brain understood was
      // labelled as the regex's work - which sent the 1 Oct investigation
      // down the wrong path first. (The column has no constraint.)
      parsing_method: (llmAssist && llmAssist.confidence >= 0.55) ? 'llm' : 'rule',
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
      contact_name:   resolvedContact?.name  || nameEntity || null,
      contact_phone:  resolvedContact?.phone || null,
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

  // Auto-save named location to user_locations if we had real coords + a name.
  // NOT when the pin came from a map lookup: that is our guess, and saving a
  // guess as one of the user's own places is how a wrong "Mansurabad" and a
  // wrong "home" became permanent on 2-3 October 2026.
  if (!geoFromMap && geoData?.geo_trigger_enabled && geoData.latitude && geoData.location_name) {
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
  let reminderRow     = null
  if (reminderAt && keep.id) {
    reminderNudgeId = await scheduleReminderNudge(supabase, {
      userId:     user.id,
      keepId:     keep.id,
      reminderAt,
      content:    text,
      domainType: workspace_id ? 'business' : 'personal',
    })

    try {
      const { data: rem } = await supabase
        .from('reminders')
        .insert({
          user_id:       user.id,
          keep_id:       keep.id,
          reminder_text: text,
          scheduled_for: reminderAt.toISOString(),
          is_active:     true,
          space_type:    workspace_id ? 'business' : 'personal',
          // Without these the alarm can speak the reminder and nothing else.
          // src/lib/reminder-voice.js reads contact_phone off THIS row, not off
          // the keep, and only attaches a call action when it finds one.
          contact_name:  keep.contact_name  || null,
          contact_phone: keep.contact_phone || null,
        })
        .select('*')
        .maybeSingle()
      reminderRow = rem
    } catch (remErr) {
      console.error('[capture] reminders table insert failed:', remErr)
    }
  }

  // audit_log columns are (action, service, details, intent_id) — NOT
  // entity_type/entity_id/metadata. The old shape was rejected on EVERY voice
  // capture and the .then(() => {}) hid it, so no voice capture was ever audited.
  supabase.from('audit_log').insert({
    user_id: user.id,
    action:  'keep.captured_via_voice',
    service: 'voice_capture',
    details: {
      keep_id: keep.id, source, language, confidence: parsed.confidence,
      intent_type: parsed.type, contact_matched: !!resolvedContact,
      reminder_set: !!reminderAt, follow_up_needed: !!followUp, workspace_id,
      // Why "when?" was asked, answerable from the row itself from now on.
      understanding,
      // How the sentence was HEARD: by the engine or by the phone, for how
      // long, and what ended the turn. A cut-off report is checkable from here.
      listen: listenEvidence,
    },
  }).then(({ error }) => { if (error) console.error('[capture] audit_log failed:', error.message) })

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
        contact_matched: !!resolvedContact, is_multi: !!(parsed.is_multi),
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
    resolvedContact?.name || nameEntity || null
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
  // The brain replies in the language the user actually spoke — reading English
  // back to a Telugu or Hindi speaker is the same as not answering at all.
  if (llmAssist?.reply) tts_response = llmAssist.reply
  // ...except when we have to ask WHO. The brain wrote "I'll call Venu Yadav
  // in two minutes" before the contact lookup ran; saying it while no number
  // is attached is the false promise the brain's own prompt forbids.
  if (followUp?.action_hint === 'disambiguate_contact' || followUp?.action_hint === 'add_contact') {
    tts_response = followUp.follow_up
  }
  // "Which Venu?" is SAID short and SHOWN in full: three names aloud, every
  // match as a button. Six names in one breath cannot be answered by ear.
  if (followUp?.action_hint === 'disambiguate_contact' && Array.isArray(followUp.contacts)) {
    tts_response = spokenContactQuestion(followUp.suggested_name, followUp.contacts)
  }
  // v12: business TTS overrides generic TTS when resolver produced a confirmation
  if (bizPayload?.tts_response) tts_response = bizPayload.tts_response;
  // Feature 7: Contextual TalkBack — mentions both location and keep content
  const keepSnippet = text.length > 40 ? text.slice(0, 40) + '…' : text;
  if (parsed.route?.detected && routeData?.destLoc) {
    tts_response = `Got it. When you're near ${routeData.destLoc.name}, I'll remind you: ${keepSnippet}`;
  } else if (geoData?.geo_trigger_enabled && brainPlace && llmAssist?.reply) {
    // The brain already said "I'll remind you when you reach Chintal Kunta"
    // in the language the user spoke; the English template below would
    // answer a Telugu speaker in English.
    tts_response = llmAssist.reply
  } else if (geoData?.geo_trigger_enabled) {
    // (was `geoData?.detected && ...` - geoData has no `detected` field, so
    // this branch never ran and a geo reminder was confirmed as a plain note)
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

  let isAutoEligible = (
    parsed.confidence >= 0.82
    && AUTO_EXEC_TYPES.has(parsed.type)
    && !BLOCKED_FROM_AUTO.has(parsed.type)
    && !followUp
    && !(parsed.type === 'contact' && !keep.contact_phone)
    && !isSourcePrediction
    && !(reminderAt && new Date(reminderAt).getTime() > Date.now() + 60_000)
    // A trip the brain named ("plan a trip to Ooty next weekend") is saved
    // and read back; it never opens Maps by itself.
    && !(parsed.type === 'trip' && llmAssist?.intent === 'trip')
  )

  if (isAutoEligible && workspace_id) {
    // Check RBAC permissions for business version
    let resource = 'ledger';
    let action = 'view';
    if (parsed.type === 'contact') {
      resource = 'billing';
      action = 'view';
    } else if (['invoice', 'expense', 'ledger_credit', 'ledger_debit', 'sale'].includes(parsed.type)) {
      resource = 'ledger';
      action = 'create';
    }

    const { data: allowed } = await supabase.rpc('check_biz_permission', {
      p_user_id: user.id,
      p_workspace_id: workspace_id,
      p_resource: resource,
      p_action: action
    }).catch(() => ({ data: false }));

    if (!allowed) {
      console.warn(`[RBAC] Voice auto-exec DENIED for user=${user.id} on ${resource}.${action}`);
      isAutoEligible = false;
    }

    // Business version specific auto-exec rules
    if (isAutoEligible) {
      if (parsed.type === 'navigation') {
        // Allowed
      } else if (parsed.type === 'contact') {
        // Only allow resolved customer (fuzzy matched in business_customers table)
        if (!resolvedContact || !isBusinessContact) {
          console.warn(`[BIZ-POLICY] Blocked auto-exec: contact is not a resolved customer`);
          isAutoEligible = false;
        }
      } else {
        // Block other auto exec types in business mode
        isAutoEligible = false;
      }
    }
  } else if (isAutoEligible && !workspace_id) {
    // Personal version specific rules: cannot call a business customer
    if (resolvedContact && isBusinessContact) {
      isAutoEligible = false;
    }
  }

  // ── THE SAFETY CHECK, BEFORE AN AUTOMATIC ACTION ───────────────────────────
  // The 2.5-second countdown card is a read-back with a cancel, not a spoken
  // yes. The level table (src/lib/action-levels.js) lets it carry read-back
  // actions only: navigation and trips. A call, a message or a purchase on the
  // first turn is held until the person has said yes - today that is the
  // "now or a reminder?" question above. Nothing is sent to a contact from
  // here without that yes. (Previously a WhatsApp message to the contact was
  // queued here with a 2.6-second cancel window; the queue had processed one
  // row ever, which failed. That path is gone.)
  const safety = isAutoEligible
    ? decide(
        { type: parsed.type, contactSaved: parsed.type === 'contact' ? !!keep.contact_phone : null },
        { spokenYes: false, unlocked: ['voice', 'text'].includes(source), pin: false, ownerVoice: null },
        { doneThisHour: 0 },   // read-back is uncapped; anything capped is refused here anyway (no yes yet)
      )
    : null
  if (safety && safety.decision !== DECISION.DO) {
    console.log('[safety] held auto-exec:', parsed.type, safety.level, safety.reason)
    isAutoEligible = false
  }
  // Step log only (100-task run): the same decision computed separately, so
  // the `safety` the app receives is exactly what it was before (null when
  // nothing was automatic).
  if (tasks100Run) {
    const logSafety = safety || decide(
      { type: parsed.type, contactSaved: parsed.type === 'contact' ? !!keep.contact_phone : null },
      { spokenYes: false, unlocked: ['voice', 'text'].includes(source), pin: false, ownerVoice: null },
      { doneThisHour: 0 },
    )
    const isAskingConfirm = ['ask_yes', 'ask_unlock', 'ask_pin'].includes(logSafety.decision)
    logStep({
      heardText: text,
      decidedAction: parsed.type,
      level: logSafety.level,
      decision: logSafety.decision,
      askedConfirmation: isAskingConfirm,
      result: logSafety.decision === DECISION.DO ? 'success' : (isAskingConfirm ? 'pending_confirmation' : 'refused'),
    })
  }

  if (isAutoEligible) {
    // v10: Extract navigation destination for Maps Intent in VoiceService
    const navQuery = (['navigation', 'trip'].includes(keep.intent_type))
      ? ((llmAssist?.intent === 'navigation' && llmAssist?.entities?.item)
          || extractDestination(keep.content || '')).slice(0, 120)
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
      // For navigation, carry just the place so the countdown card shows it and
      // Maps receives a clean destination even when the user spoke Telugu/Hindi.
      content:          navQuery || keep.content,
      delay_ms:         2500,
    }

  }

  const responseKeep = {
    ...keep,
    subject:  keep.content,
    raw_text: keep.voice_text,
  }

  // ── SOT P1: Aaria action brain ────────────────────────────────────────────
  // The regex parser files anything it can't understand as a generic 'note' and
  // then does nothing. For those utterances only, ask Aaria to understand and
  // act. Scope stays 'read' because this runs automatically — it must never
  // silently mutate data. Fail-safe and time-boxed: a slow or down Aaria can
  // never block or break a capture.
  let aaria = null
  if (parsed.type === 'unknown' || parsed.confidence < 0.5) {
    aaria = await aariaAssist(text, {
      userId: user.id,
      lang: (language || 'en').split('-')[0],
      scope: 'read',
    }).catch(() => null)
  }

  const hasSpecificTime = parsed.entities?.times?.length > 0;
  // A time the brain resolved to an absolute instant is not ambiguous, even
  // when the regex found no time token — otherwise every Indic-language
  // reminder came back with the quick-time overlay on a correct reminder.
  const brainResolvedTime = Boolean(llmAssist?.entities?.datetimeISO);
  const timeAmbiguous   = parsed.type === 'reminder' && reminderAt && !hasSpecificTime && !brainResolvedTime;
  const needsReminderPrompt = (parsed.type === 'note' || parsed.type === 'task') && !reminderAt && /remind|remember|later/i.test(text);

  return NextResponse.json({
    keep:              responseKeep,
    intent:            responseKeep,
    tts_response,
      // What the brain understood — the UI uses `missing` to ask the next
      // question out loud instead of silently saving a half-understood keep.
      assistant: llmAssist
        ? {
            engine: 'sarvam',
            intent: llmAssist.intent ?? null,
            confidence: llmAssist.confidence ?? null,
            language: llmAssist.language || llmAssist.language_detected || language || null,
            clean_text: llmAssist.cleanText || llmAssist.clean_text || null,
            title: llmAssist.title || null,
            missing: Array.isArray(llmAssist.missing) ? llmAssist.missing : [],
            entities: llmAssist.entities || {},
            reply: llmAssist.reply || null,
          }
        : {
            engine: 'regex',
            intent: parsed?.type ?? null,
            confidence: parsed?.confidence ?? null,
            language: language || null,
            clean_text: null,
            title: null,
            missing: [],
            entities: parsed?.entities || {},
            reply: null,
          },
    understanding,     // same record as the audit row: engine, reasons, outcome, latency
    time_ambiguous:    timeAmbiguous,
    quick_time_options: timeAmbiguous ? ['9:00 AM', '12:00 PM', '5:00 PM', '8:00 PM'] : null,
    needs_reminder_prompt: needsReminderPrompt,
    reminder_at:       keep.reminder_at,
    reminder_nudge_id: reminderNudgeId,
    reminder:          reminderRow,
    contact_matched:   resolvedContact
      ? { name: resolvedContact.name, phone: resolvedContact.phone }
      : null,
    follow_up:         followUp,
    // The offered contacts as buttons (name, plus the end of the number when
    // two share a name). Null unless Aaria is asking which person.
    choices:           followUp?.action_hint === 'disambiguate_contact' ? contactChoices(followUp.contacts) : null,
    // Voice Brain fields (Phase 3 Step 1)
    needs_followup:    needsFollowup,      // true when confidence < 0.68 and intent unclear
    clarification:     clarification,      // question string to show the user
    confidence_tier:   brain.tier,         // 'high' | 'medium' | 'low'
    human_type:        brain.human_type,   // readable intent label
    sub_keeps:         subKeeps,           // array of {id, text, intent_type} for multi-step intents
    entities:          parsed.entities,
    aaria,             // SOT P1: Aaria's read of utterances the regex missed (null otherwise)
    auto_exec,
    safety,            // item 2: what the level table decided for this turn (null when nothing was automatic)
    ...(lastStepRecord ? { step_record: lastStepRecord } : {}),
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
