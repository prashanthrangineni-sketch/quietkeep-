// src/lib/intent-brain.js
// Phase 3 — Voice Brain
//
// Adds three capabilities ON TOP of the existing intent-parser + intent-executor pipeline.
// This file does NOT replace or modify those files — it imports from them.
//
// 1. scoredIntent(parsed)
//    Enriches the raw parseIntent() output with:
//    - needs_followup: boolean  (confidence < LOW_CONF_THRESHOLD)
//    - clarification:  string   (question to ask when needs_followup is true)
//    - tier:           'high' | 'medium' | 'low'
//
// 2. buildClarification(parsed)
//    Generates a targeted clarification question for low-confidence intents.
//    Supplements computeFollowUp (which handles contact/time missing-info cases).
//    This handles the orthogonal case: intent type itself is uncertain.
//
// 3. executeSubIntents(supabase, userId, subIntents, workspaceId)
//    Executes each sub-intent from parsed.sub_intents as an independent keep row.
//    Called from voice/capture/route.js ONLY when parsed.is_multi === true.
//    Returns an array of created keep IDs.

// ── Thresholds ────────────────────────────────────────────────────────────────
export const HIGH_CONF_THRESHOLD = 0.82;  // auto-exec eligible, no follow-up forced
export const LOW_CONF_THRESHOLD  = 0.68;  // below this → needs_followup = true

// ── Intent-type to human label ────────────────────────────────────────────────
const TYPE_LABELS = {
  reminder:     'reminder',
  task:         'task',
  contact:      'call or message',
  meeting:      'meeting',
  expense:      'expense',
  invoice:      'invoice',
  note:         'note',
  purchase:     'purchase',
  trip:         'trip',
  document:     'document',
  ledger_credit:'payment received',
  ledger_debit: 'amount given',
  sale:         'sale',
  compliance:   'compliance item',
  navigation:   'navigation',
};

// ── Clarification templates by intent type ────────────────────────────────────
// These trigger when confidence < LOW_CONF_THRESHOLD AND computeFollowUp
// returns null (i.e. the contact/time follow-up system didn't already fire).
const CLARIFICATION_BY_TYPE = {
  reminder: (e) => e?.dates?.length || e?.times?.length
    ? 'Should I save this as a reminder?'
    : 'Is this a reminder? If so, when should I remind you?',

  task: () => 'Should I save this as a task?',

  expense: (e) => e?.names?.length
    ? `Is this an expense paid to ${e.names[0]}?`
    : 'Is this an expense? How much did you spend?',

  invoice: (e) => e?.names?.length
    ? `Should I create an invoice for ${e.names[0]}?`
    : 'Should I create an invoice? Who is it for?',

  contact: (e) => e?.names?.length
    ? `Do you want to call or message ${e.names[0]}?`
    : 'Who do you want to contact?',

  meeting: (e) => e?.names?.length
    ? `Is this a meeting with ${e.names[0]}?`
    : 'Is this a meeting? Who is it with?',

  purchase: () => 'Should I save this as a purchase to make?',

  trip:     () => 'Is this a trip or travel plan?',

  note:     () => null,  // notes are the catch-all — never ask for clarification
};

// ── 1. scoredIntent ───────────────────────────────────────────────────────────
/**
 * Enriches a parseIntent() result with confidence tier + needs_followup flag.
 *
 * @param {object} parsed - direct output of parseIntent(text)
 * @param {object|null} existingFollowUp - output of computeFollowUp() if already computed
 * @returns {object} enriched parsed object (non-mutating)
 */
export function scoredIntent(parsed, existingFollowUp = null) {
  const { confidence, type } = parsed;

  const tier = confidence >= HIGH_CONF_THRESHOLD ? 'high'
    : confidence >= LOW_CONF_THRESHOLD           ? 'medium'
    : 'low';

  // needs_followup is true when:
  // - confidence is low AND
  // - there is no existing follow_up already (contact/time cases handled by computeFollowUp)
  const needsFollowup = tier === 'low' && !existingFollowUp;

  const clarification = needsFollowup
    ? buildClarification(parsed)
    : null;

  return {
    ...parsed,
    tier,
    needs_followup: needsFollowup,
    // clarification is a UI-facing string; null when not needed
    clarification,
    human_type: TYPE_LABELS[type] || type,
  };
}

// ── 2. buildClarification ─────────────────────────────────────────────────────
/**
 * Generates a targeted clarification question for uncertain intents.
 * Returns null for notes (catch-all) and high-confidence intents.
 *
 * @param {object} parsed - parseIntent() result
 * @returns {string|null}
 */
export function buildClarification(parsed) {
  const { type, entities, confidence } = parsed;

  if (confidence >= LOW_CONF_THRESHOLD) return null;
  if (type === 'note' && confidence > 0.60) return null;

  const templateFn = CLARIFICATION_BY_TYPE[type];
  if (!templateFn) {
    // Unknown type — generic question
    return `I wasn't sure what to do with that. Did you mean to save a ${TYPE_LABELS[type] || 'note'}?`;
  }

  const question = templateFn(entities);
  return question || null;
}

// ── 3. executeSubIntents ──────────────────────────────────────────────────────
/**
 * For multi-step voice commands ("Send invoice and remind me at 5pm"),
 * creates a keep row for each sub-intent beyond the first.
 * The first intent is handled by the main voice/capture flow.
 * This handles sub_intents[1..n].
 *
 * @param {object}   supabase     - Supabase service-role client
 * @param {string}   userId       - authenticated user ID
 * @param {string}   primaryKeepId - ID of the keep already created for sub_intents[0]
 * @param {Array}    subIntents   - parsed.sub_intents array from parseIntent()
 * @param {string|null} workspaceId
 * @param {object}   parentEntities - entities from the primary intent (for date/name inheritance)
 * @returns {Promise<Array<{id:string, text:string, intent_type:string}>>}
 */
export async function executeSubIntents(
  supabase,
  userId,
  primaryKeepId,
  subIntents,
  workspaceId = null,
  parentEntities = {}
) {
  if (!subIntents?.length || subIntents.length < 2) return [];

  // sub_intents[0] is the primary intent (already saved) — skip it
  const secondary = subIntents.slice(1);
  const created = [];

  for (const sub of secondary) {
    const subText = sub.text?.trim();
    if (!subText || subText.length < 3) continue;

    // Inherit parent entities if sub-intent is missing them
    // e.g. "and remind me at 5pm" inherits contact name from "call Ravi"
    const entities = {
      names: sub.entities?.names?.length ? sub.entities.names : (parentEntities.names || []),
      dates: sub.entities?.dates?.length ? sub.entities.dates : (parentEntities.dates || []),
      times: sub.entities?.times?.length ? sub.entities.times : (parentEntities.times || []),
    };

    // Compute reminder time for this sub-intent
    const { computeReminderAt } = await import('@/lib/intent-executor');
    const reminderAt = computeReminderAt({ dates: entities.dates, times: entities.times });

    try {
      const { data: subKeep, error } = await supabase
        .from('keeps')
        .insert({
          user_id:        userId,
          content:        subText,
          voice_text:     subText,
          intent_type:    sub.type !== 'unknown' ? sub.type : 'note',
          confidence:     sub.conf || 0.70,
          parsing_method: 'rule',
          status:         'open',
          loop_state:     'open',
          space_type:     workspaceId ? 'business' : 'personal',
          domain_type:    workspaceId ? 'business' : 'personal',
          workspace_id:   workspaceId || null,
          tags:           [],
          show_on_brief:  true,
          reviewed_at:    new Date().toISOString(),
          reminder_at:    reminderAt ? reminderAt.toISOString() : null,
          contact_name:   entities.names[0] || null,
          // link to the primary keep so the UI can group them
          metadata: {
            parent_keep_id: primaryKeepId,
            multi_step_index: secondary.indexOf(sub) + 1,
            multi_step_total: secondary.length + 1,
          },
        })
        .select('id,intent_type,content')
        .single();

      if (!error && subKeep) {
        created.push({ id: subKeep.id, text: subText, intent_type: subKeep.intent_type });
      }
    } catch {
      // Non-blocking — if one sub-intent fails, continue with the rest
    }
  }

  return created;
}
