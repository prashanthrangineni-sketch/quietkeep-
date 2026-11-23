// src/app/api/aaria/learned/route.js
// T29 (22 Nov 2026): "What Aaria learned" — the person sees, approves, declines
// or forgets each habit, picks their learning mode, and can teach Aaria directly.
//
// Uses the person's OWN session (RLS policy tau_profile_own), never the service
// role: nobody can read or change another person's profile through this route.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  LEARNING_MODES, normaliseMode, answerHabit, teachFact, habitSentence, decideHabitUse,
} from '@/lib/tau-profile';
import { createHabitReminder, stopHabitReminder, planForHabit } from '@/lib/habit-offers';

function clientFor(req) {
  const a = (req.headers.get('Authorization') || '').trim();
  const t = a.startsWith('Bearer ') ? a.slice(7).trim() : '';
  if (!t) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${t}` } } });
}

async function load(sb, userId) {
  const { data } = await sb.from('tau_behaviour_profile').select('*').eq('user_id', userId).maybeSingle();
  return data || null;
}

function view(profile) {
  const mode = normaliseMode(profile?.learning_mode);
  const habits = (profile?.habits || [])
    .filter((h) => h && h.status !== 'forgotten')
    .map((h) => ({
      id: h.id, kind: h.kind, status: h.status, confidence: h.confidence ?? null,
      sentence: habitSentence(h), use: decideHabitUse(h, mode),
    }));
  return { mode, modes: LEARNING_MODES, habits, last_updated: profile?.last_updated || null };
}

export async function GET(req) {
  const sb = clientFor(req);
  if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } = {} } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(view(await load(sb, user.id)));
}

export async function POST(req) {
  const sb = clientFor(req);
  if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } = {} } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const profile = await load(sb, user.id);
  let habits = profile?.habits || [];
  const patch = { user_id: user.id };

  if (body.mode !== undefined) {
    if (!LEARNING_MODES.includes(body.mode)) return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
    patch.learning_mode = body.mode;
  }
  if (['confirm', 'decline', 'forget'].includes(body.action)) {
    const target = habits.find((h) => h.id === body.id);
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    habits = answerHabit(habits, body.id, body.action);
    // T31: "Yes, help me with this" now DOES something: the habit becomes a
    // repeating reminder. "No" / "Forget" switch that reminder off again.
    if (body.action === 'confirm' && !target.reminder_id && planForHabit(target)) {
      const reminderId = await createHabitReminder(sb, user.id, target);
      if (reminderId) habits = habits.map((h) => (h.id === target.id ? { ...h, reminder_id: reminderId } : h));
    } else if (body.action !== 'confirm' && target.reminder_id) {
      await stopHabitReminder(sb, target);
      habits = habits.map((h) => (h.id === target.id ? { ...h, reminder_id: null } : h));
    }
    patch.habits = habits;
  } else if (body.action === 'teach') {
    const next = teachFact(habits, body.text);
    if (next === habits) return NextResponse.json({ error: 'Nothing to remember' }, { status: 400 });
    habits = next;
    patch.habits = habits;
  } else if (body.action !== undefined) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  const { error } = await sb.from('tau_behaviour_profile').upsert(patch, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 });
  return NextResponse.json(view({ ...(profile || {}), ...patch }));
}
