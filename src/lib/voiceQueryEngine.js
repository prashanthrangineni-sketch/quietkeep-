'use client';
// src/lib/voiceQueryEngine.js
// TASK 5 + TASK 10 — Rule-based voice query engine + dashboard router
//
// Handles two categories:
// A. QUERIES  — "what are my pending bills" → fetch from DB → speak answer
// B. NAVIGATION — "open reminders" → router.replace('/reminders') + TTS confirm
//
// No LLM. All pattern matching is lowercase substring/startsWith.
// Designed to be called from dashboard handleSave AFTER wake word is stripped.
//
// Usage in dashboard handleSave (after commandText is set):
//   import { resolveVoiceCommand } from '@/lib/voiceQueryEngine';
//   const resolved = await resolveVoiceCommand(commandText, { supabase, user, accessToken, router, speak });
//   if (resolved.handled) return; // stop — don't send to /api/voice/capture

import { safeFetch } from '@/lib/safeFetch';

// ── Navigation routes ──────────────────────────────────────────────────────
const NAV_ROUTES = [
  { patterns: ['open reminders', 'go to reminders', 'show reminders', 'my reminders'],  path: '/reminders',   label: 'Reminders' },
  { patterns: ['open calendar', 'go to calendar', 'show calendar'],                      path: '/calendar',    label: 'Calendar' },
  { patterns: ['open camera', 'go to camera', 'take photo', 'scan document'],            path: '/camera',      label: 'Camera' },
  { patterns: ['open bills', 'go to bills', 'show bills', 'my bills'],                   path: '/bills',       label: 'Bills' },
  { patterns: ['open finance', 'go to finance', 'show finance', 'my expenses'],          path: '/finance',     label: 'Finance' },
  { patterns: ['open settings', 'go to settings'],                                       path: '/settings',    label: 'Settings' },
  { patterns: ['drive mode', 'start driving', 'open drive'],                             path: '/drive',       label: 'Drive Mode' },
  { patterns: ['open geo', 'location reminders', 'geo fencing'],                         path: '/geo',         label: 'Geo Reminders' },
  { patterns: ['open daily brief', 'read my brief', 'what is my brief'],                 path: '/daily-brief', label: 'Daily Brief' },
  { patterns: ['open documents', 'my documents', 'go to documents'],                     path: '/documents',   label: 'Documents' },
  { patterns: ['open voice log', 'voice history', 'my voice sessions'],                  path: '/voice',       label: 'Voice Log' },
  { patterns: ['dashboard', 'go home', 'open home'],                                     path: '/dashboard',   label: 'Home' },
];

// ── Query handlers ─────────────────────────────────────────────────────────
async function handleQuery(cmd, { supabase, user, accessToken, speak }) {
  const c = cmd.toLowerCase();

  // PENDING BILLS
  if (c.includes('pending bill') || c.includes('bills due') || c.includes('upcoming bill')) {
    try {
      const { data } = await supabase
        .from('bill_reminders')
        .select('name, amount, due_date, paid')
        .eq('user_id', user.id)
        .eq('paid', false)
        .order('due_date', { ascending: true })
        .limit(5);
      if (!data || data.length === 0) {
        speak('You have no pending bills. All caught up!');
      } else {
        const list = data.map(b => `${b.name}${b.amount ? ' for ₹' + b.amount : ''}${b.due_date ? ' due ' + new Date(b.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}`).join('. ');
        speak(`You have ${data.length} pending bill${data.length > 1 ? 's' : ''}. ${list}`);
      }
      return true;
    } catch { speak('Could not fetch bills right now.'); return true; }
  }

  // SUBSCRIPTIONS
  if (c.includes('subscription') || c.includes('renewing')) {
    try {
      const { data } = await supabase
        .from('subscriptions')
        .select('name, amount, renewal_date, status')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('renewal_date', { ascending: true })
        .limit(5);
      if (!data || data.length === 0) {
        speak('No active subscriptions found.');
      } else {
        const list = data.map(s => `${s.name}${s.amount ? ' ₹' + s.amount : ''}${s.renewal_date ? ' renews ' + new Date(s.renewal_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}`).join('. ');
        speak(`You have ${data.length} active subscription${data.length > 1 ? 's' : ''}. ${list}`);
      }
      return true;
    } catch { speak('Could not fetch subscriptions.'); return true; }
  }

  // TODAY'S REMINDERS
  if (c.includes('remind') || c.includes('today') && c.includes('keep')) {
    try {
      const today = new Date();
      const start = new Date(today); start.setHours(0, 0, 0, 0);
      const end   = new Date(today); end.setHours(23, 59, 59, 999);
      const { data } = await supabase
        .from('keeps')
        .select('content, reminder_at, intent_type')
        .eq('user_id', user.id)
        .eq('intent_type', 'reminder')
        .neq('status', 'closed')
        .gte('reminder_at', start.toISOString())
        .lte('reminder_at', end.toISOString())
        .order('reminder_at', { ascending: true })
        .limit(5);
      if (!data || data.length === 0) {
        speak('No reminders for today. You are all clear!');
      } else {
        const list = data.map(r => r.content?.slice(0, 60) || 'untitled').join('. ');
        speak(`You have ${data.length} reminder${data.length > 1 ? 's' : ''} today. ${list}`);
      }
      return true;
    } catch { speak('Could not fetch reminders.'); return true; }
  }

  // EXPENSES / SPENDING
  if (c.includes('expense') || c.includes('spent') || c.includes('spending')) {
    try {
      const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
      const { data } = await supabase
        .from('expenses')
        .select('amount, category')
        .eq('user_id', user.id)
        .gte('created_at', startOfMonth.toISOString());
      if (!data || data.length === 0) {
        speak('No expenses recorded this month.');
      } else {
        const total = data.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
        speak(`This month you have spent ₹${Math.round(total)} across ${data.length} expense${data.length > 1 ? 's' : ''}.`);
      }
      return true;
    } catch { speak('Could not fetch expenses.'); return true; }
  }

  // OPEN KEEPS COUNT
  if ((c.includes('how many') || c.includes('count')) && c.includes('keep')) {
    try {
      const { count } = await supabase
        .from('keeps').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).neq('status', 'closed');
      speak(`You have ${count || 0} open keep${count !== 1 ? 's' : ''}.`);
      return true;
    } catch { speak('Could not count keeps.'); return true; }
  }

  return false; // not handled
}

// ── Main resolver ──────────────────────────────────────────────────────────
/**
 * resolveVoiceCommand(command, ctx)
 *
 * Returns { handled: boolean }
 * If handled === true, the caller should NOT send to /api/voice/capture.
 */
export async function resolveVoiceCommand(command, { supabase, user, accessToken, router, speak }) {
  if (!command || !user) return { handled: false };
  const c = command.toLowerCase().trim();

  // 1. Navigation commands
  for (const route of NAV_ROUTES) {
    if (route.patterns.some(p => c.includes(p))) {
      speak(`Opening ${route.label}.`);
      setTimeout(() => router.push(route.path), 600); // small delay so TTS starts first
      return { handled: true, type: 'navigation', path: route.path };
    }
  }

  // 2. Query commands
  const queryHandled = await handleQuery(c, { supabase, user, accessToken, speak });
  if (queryHandled) return { handled: true, type: 'query' };

  // 3. Not handled — pass to /api/voice/capture as normal
  return { handled: false };
}
