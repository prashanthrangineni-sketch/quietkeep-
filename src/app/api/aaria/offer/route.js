// src/app/api/aaria/offer/route.js
// T31 (23 Nov 2026): the one habit Aaria offers right now, asked ONCE (hybrid).
//
// GET  ?lang=te-IN  -> { offer: { id, question } } or { offer: null }
//                      Marks the habit as asked, so it is not asked again for a week.
// POST { id, answer: 'yes' | 'no', lang } -> { ok, line }
//                      yes = the habit becomes a repeating reminder; no = never offered again.
//
// The person's own session only (row-level rules). Only reminders are ever
// created here - nothing that needs a fingerprint.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normaliseMode, answerHabit } from '@/lib/tau-profile';
import { pickOffer, offerQuestion, answerLine, createHabitReminder, stopHabitReminder } from '@/lib/habit-offers';

function clientFor(req) {
  const a = (req.headers.get('Authorization') || '').trim();
  const t = a.startsWith('Bearer ') ? a.slice(7).trim() : '';
  if (!t) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${t}` } } });
}

async function who(req) {
  const sb = clientFor(req);
  if (!sb) return {};
  const { data: { user } = {} } = await sb.auth.getUser();
  return { sb, user };
}

export async function GET(req) {
  const { sb, user } = await who(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const lang = new URL(req.url).searchParams.get('lang') || 'en';
  const { data: profile } = await sb.from('tau_behaviour_profile').select('habits,learning_mode').eq('user_id', user.id).maybeSingle();
  const habits = profile?.habits || [];
  const pick = pickOffer(habits, normaliseMode(profile?.learning_mode));
  if (!pick) return NextResponse.json({ offer: null });
  const question = offerQuestion(pick, lang);
  if (!question) return NextResponse.json({ offer: null });
  const askedAt = new Date().toISOString();
  await sb.from('tau_behaviour_profile')
    .upsert({ user_id: user.id, habits: habits.map((h) => (h.id === pick.id ? { ...h, asked_at: askedAt } : h)) }, { onConflict: 'user_id' });
  return NextResponse.json({ offer: { id: pick.id, question } });
}

export async function POST(req) {
  const { sb, user } = await who(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!['yes', 'no'].includes(body.answer)) return NextResponse.json({ error: 'Say yes or no' }, { status: 400 });
  const { data: profile } = await sb.from('tau_behaviour_profile').select('habits').eq('user_id', user.id).maybeSingle();
  let habits = profile?.habits || [];
  const target = habits.find((h) => h.id === body.id);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  habits = answerHabit(habits, target.id, body.answer === 'yes' ? 'confirm' : 'decline');
  if (body.answer === 'yes' && !target.reminder_id) {
    const reminderId = await createHabitReminder(sb, user.id, target);
    if (!reminderId) return NextResponse.json({ error: 'Could not set the reminder' }, { status: 500 });
    habits = habits.map((h) => (h.id === target.id ? { ...h, reminder_id: reminderId } : h));
  } else if (body.answer === 'no' && target.reminder_id) {
    await stopHabitReminder(sb, target);
    habits = habits.map((h) => (h.id === target.id ? { ...h, reminder_id: null } : h));
  }
  const { error } = await sb.from('tau_behaviour_profile').upsert({ user_id: user.id, habits }, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 });
  return NextResponse.json({ ok: true, line: answerLine(body.answer, body.lang || 'en') });
}
