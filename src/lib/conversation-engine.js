// src/lib/conversation-engine.js
// Phase 12 — Conversation Session Engine
//
// Maintains short-term session context across voice turns.
// Uses conversation_sessions table (created in Phase 11 migration).
//
// SESSION STATE:
//   active  — listening for input
//   paused  — mid-clarification
//   ended   — closed
//
// SHORT-TERM MEMORY (last 5 intents):
//   [ { intent_type, entities, transcript, created_at }, ... ]
//
// Exports:
//   createSession(userId)
//   getActiveSession(userId)
//   updateSession(sessionId, updates)
//   resolveFollowUp(session, newTranscript)
//   endSession(sessionId)

import { createClient } from '@supabase/supabase-js';
import { parseIntent }  from '@/lib/intent-parser';

const MEMORY_WINDOW = 5; // keep last 5 turns

function svcClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── createSession ─────────────────────────────────────────────────────────────
export async function createSession(userId) {
  if (!userId) return null;
  try {
    // Close any existing active sessions first
    const db = svcClient();
    await db.from('conversation_sessions')
      .update({ session_state: 'ended', ended_at: new Date().toISOString() })
      .eq('user_id', userId).eq('session_state', 'active');

    const { data, error } = await db.from('conversation_sessions')
      .insert({ user_id: userId, session_state: 'active', turn_count: 0 })
      .select('id, session_state, turn_count, created_at')
      .single();

    if (error) throw error;
    return data;
  } catch(e) {
    console.error('[CONV-ENGINE] createSession error:', e.message);
    return null;
  }
}

// ── getActiveSession ──────────────────────────────────────────────────────────
export async function getActiveSession(userId) {
  if (!userId) return null;
  try {
    const { data } = await svcClient()
      .from('conversation_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('session_state', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  } catch { return null; }
}

// ── updateSession ─────────────────────────────────────────────────────────────
/**
 * Update session after each voice turn.
 * Appends to short_term_memory (capped at MEMORY_WINDOW).
 */
export async function updateSession(sessionId, {
  intentType, entities = {}, transcript = '',
  pendingClarification = null, sessionState = 'active',
}) {
  if (!sessionId) return;
  try {
    const db = svcClient();

    // Fetch current memory
    const { data: current } = await db.from('conversation_sessions')
      .select('short_term_memory, turn_count').eq('id', sessionId).single();

    const prevMemory  = current?.short_term_memory || [];
    const newEntry    = { intent_type: intentType, entities, transcript, created_at: new Date().toISOString() };
    const newMemory   = [...prevMemory, newEntry].slice(-MEMORY_WINDOW);

    await db.from('conversation_sessions').update({
      last_intent:           intentType,
      last_entities:         entities,
      pending_clarification: pendingClarification,
      short_term_memory:     newMemory,
      session_state:         sessionState,
      turn_count:            (current?.turn_count || 0) + 1,
      updated_at:            new Date().toISOString(),
    }).eq('id', sessionId);
  } catch(e) {
    console.error('[CONV-ENGINE] updateSession error:', e.message);
  }
}

// ── resolveFollowUp ───────────────────────────────────────────────────────────
/**
 * When a clarification was pending, try to resolve it with the new input.
 * Returns: { resolved: boolean, mergedEntities, intent }
 */
export function resolveFollowUp(session, newTranscript) {
  if (!session?.pending_clarification || !newTranscript) {
    return { resolved: false, mergedEntities: {}, intent: null };
  }
  try {
    const parsed  = parseIntent(newTranscript);
    const prev    = session.last_entities || {};
    const merged  = { ...prev, ...parsed.entities };
    return { resolved: true, mergedEntities: merged, intent: session.last_intent || parsed.type };
  } catch {
    return { resolved: false, mergedEntities: {}, intent: null };
  }
}

// ── endSession ────────────────────────────────────────────────────────────────
export async function endSession(sessionId) {
  if (!sessionId) return;
  try {
    await svcClient().from('conversation_sessions')
      .update({ session_state: 'ended', ended_at: new Date().toISOString() })
      .eq('id', sessionId);
  } catch { /* fail-safe */ }
}
