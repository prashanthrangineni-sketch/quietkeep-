// src/app/api/perception/signal/route.js
// Passive signal ingestion from device perception layer (Capacitor plugin)
// Accepts signals from: foreground app detection, device context, clipboard changes
// Calls ingest_passive_signal() + behaviour_signals INSERT → triggers realtime-relay
// Auth: Bearer token (from Capacitor native context where no cookie session exists)
//
// FIX (BUG-03): Now uses user's learned active_hour_start/end from user_behavior_model
// instead of the static userStateMap which always passed 'WORKING_HOURS'.
// This means evaluations triggered by app-open now fire with the user's personal
// active hours (e.g. 18–21 IST) rather than assuming 9–18 IST business hours.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const VALID_SIGNALS = [
  'app_foreground','app_background','app_active','device_context',
  'clipboard_changed','screen_on','screen_off','idle_detected','charging_started',
];

// Compute user state from IST clock as fallback when no model exists
function getClockBasedState(signal_type) {
  // Passive signals that clearly indicate inactive state
  if (['app_background','screen_off','idle_detected'].includes(signal_type)) return 'OFF_HOURS';

  const now = new Date();
  const totalMin = now.getUTCHours() * 60 + now.getUTCMinutes() + 330; // UTC+5:30
  const istHour  = Math.floor(totalMin / 60) % 24;
  if (istHour >= 6  && istHour < 9)  return 'START_OF_DAY';
  if (istHour >= 9  && istHour < 18) return 'WORKING_HOURS';
  if (istHour >= 18 && istHour < 21) return 'EVENING';
  return 'OFF_HOURS';
}

// Compute user state using learned model + current time
// Falls back to clock-only when no model found
function getLearnedUserState(signal_type, model) {
  // Passive signals that clearly indicate inactive — always OFF_HOURS regardless of model
  if (['app_background','screen_off','idle_detected'].includes(signal_type)) return 'OFF_HOURS';

  const now = new Date();
  const totalMin = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
  const istHour  = Math.floor(totalMin / 60) % 24;

  // Morning always wins — same for everyone
  if (istHour >= 6 && istHour < 9) return 'START_OF_DAY';

  // Use learned active window if available
  if (model?.active_hour_start != null && model?.active_hour_end != null) {
    if (istHour >= model.active_hour_start && istHour <= model.active_hour_end) {
      return 'WORKING_HOURS'; // user's personal active window
    }
    // Outside learned window
    return 'OFF_HOURS';
  }

  // No model — fall back to clock
  return getClockBasedState(signal_type);
}

export async function POST(request) {
  // Support both cookie-auth (web) and Bearer token (native Capacitor)
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    token ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let user;
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    user = data?.user;
  }
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { signal_type, payload = {} } = body;

  if (!signal_type || !VALID_SIGNALS.includes(signal_type)) {
    return NextResponse.json({
      error: `Invalid signal_type. Valid: ${VALID_SIGNALS.join(', ')}`,
    }, { status: 400 });
  }

  // Write passive signal (weight=0.5, non-blocking)
  const { error: signalErr } = await supabase.rpc('ingest_passive_signal', {
    p_user_id: user.id,
    p_signal_type: signal_type,
    p_metadata: {
      ...payload,
      source: 'perception_layer',
      received_at: new Date().toISOString(),
    },
  });

  if (signalErr) {
    console.error('[perception/signal]', signalErr.message);
    return NextResponse.json({ error: signalErr.message }, { status: 500 });
  }

  // If signal implies user is active, trigger evaluation queue
  if (['app_active','app_foreground','screen_on','charging_started'].includes(signal_type)) {
    // FIX BUG-03: fetch user's learned active hours to derive correct state
    // Non-blocking: if this fetch fails, we fall back to clock-based state
    supabase
      .from('user_behavior_model')
      .select('active_hour_start,active_hour_end')
      .eq('user_id', user.id)
      .single()
      .then(({ data: model }) => {
        const learnedState = getLearnedUserState(signal_type, model);
        supabase.rpc('process_evaluation_queue', {
          p_limit: 10,
          p_user_state: learnedState,
        }).catch(() => {});
      })
      .catch(() => {
        // Model fetch failed — use clock fallback, still trigger evaluation
        const fallbackState = getClockBasedState(signal_type);
        supabase.rpc('process_evaluation_queue', {
          p_limit: 10,
          p_user_state: fallbackState,
        }).catch(() => {});
      });
  }

  return NextResponse.json({ ok: true, signal_type, user_id: user.id });
}
