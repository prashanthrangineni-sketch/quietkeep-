/**
 * src/lib/tau-learning.js
 *
 * Tau Behavioural Learning Engine
 *
 * Learns from user's voice captures, keeps, and actions to predict
 * what they'll want to do next based on time, location, and patterns.
 *
 * Uses tau_intent_log, tau_behaviour_profile, and user_location_patterns
 * tables in Supabase.
 *
 * Does NOT replace existing Tau rules — adds a prediction layer on top.
 */

// ── Log every intent for learning ─────────────────────────────────
export async function logIntent({ supabase, userId, intentType, rawTranscript, language, confidence, lat, lng, locationName, executed }) {
  if (!supabase || !userId || !intentType) return;
  const now = new Date();
  try {
    await supabase.from('tau_intent_log').insert({
      user_id: userId,
      intent_type: intentType,
      raw_transcript: rawTranscript || null,
      language_detected: language || 'en-IN',
      confidence: confidence || 0,
      location_lat: lat || null,
      location_lng: lng || null,
      location_name: locationName || null,
      hour_of_day: now.getHours(),
      day_of_week: now.getDay(),
      executed: executed ?? true,
    });
  } catch {}
}

// ── Record intent correction (user changed the auto-detected type) ──
export async function logCorrection({ supabase, logId, correctedIntent }) {
  if (!supabase || !logId) return;
  try {
    await supabase.from('tau_intent_log').update({ corrected_intent: correctedIntent }).eq('id', logId);
  } catch {}
}

// ── Build/update behaviour profile from recent intent logs ────────
export async function updateBehaviourProfile({ supabase, userId }) {
  if (!supabase || !userId) return null;
  try {
    // Fetch last 200 intent logs
    const { data: logs } = await supabase
      .from('tau_intent_log')
      .select('intent_type, hour_of_day, day_of_week, location_name, executed, corrected_intent')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (!logs || logs.length < 5) return null; // Not enough data

    // Compute time-based dominant intents
    const byTime = { morning: {}, afternoon: {}, evening: {}, night: {} };
    const allIntents = {};

    for (const log of logs) {
      const type = log.corrected_intent || log.intent_type;
      const h = log.hour_of_day;
      const bucket = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night';
      byTime[bucket][type] = (byTime[bucket][type] || 0) + 1;
      allIntents[type] = (allIntents[type] || 0) + 1;
    }

    const topOf = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const topIntents = Object.entries(allIntents).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ intent: k, count: v }));

    // Find most active hour
    const hourCounts = {};
    for (const log of logs) { hourCounts[log.hour_of_day] = (hourCounts[log.hour_of_day] || 0) + 1; }
    const mostActiveHour = parseInt(topOf(hourCounts) || '9');

    const profile = {
      user_id: userId,
      morning_intent: topOf(byTime.morning),
      afternoon_intent: topOf(byTime.afternoon),
      evening_intent: topOf(byTime.evening),
      night_intent: topOf(byTime.night),
      top_intents: topIntents,
      voice_capture_daily_avg: Math.round(logs.length / Math.max(1, new Set(logs.map(l => l.day_of_week)).size)),
      most_active_hour: mostActiveHour,
      last_updated: new Date().toISOString(),
    };

    await supabase.from('tau_behaviour_profile').upsert(profile, { onConflict: 'user_id' });
    return profile;
  } catch { return null; }
}

// ── Get contextual suggestion chips for dashboard ─────────────────
export async function getSuggestionChips({ supabase, userId }) {
  if (!supabase || !userId) return [];
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  const chips = [];

  try {
    // 1. Load user's behaviour profile
    const { data: profile } = await supabase
      .from('tau_behaviour_profile')
      .select('*')
      .eq('user_id', userId)
      .single();

    // 2. Time-based suggestions (works even without profile)
    if (hour >= 6 && hour < 10) {
      chips.push({ icon: '☀️', text: 'Log breakfast', action: 'health', prefill: { type: 'health', note: 'breakfast' } });
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        chips.push({ icon: '📋', text: 'Morning tasks', action: 'navigate', prefill: { path: '/reminders' } });
      }
    } else if (hour >= 12 && hour < 14) {
      chips.push({ icon: '🍽️', text: 'Log lunch', action: 'health', prefill: { type: 'health', note: 'lunch' } });
      chips.push({ icon: '💰', text: 'Log expense', action: 'finance', prefill: {} });
    } else if (hour >= 17 && hour < 20) {
      chips.push({ icon: '🏃', text: 'Evening walk?', action: 'health', prefill: { type: 'exercise' } });
      chips.push({ icon: '💰', text: 'Today\'s spending', action: 'navigate', prefill: { path: '/finance' } });
    } else if (hour >= 20 && hour < 23) {
      chips.push({ icon: '😴', text: 'Log sleep time', action: 'health', prefill: { type: 'sleep' } });
      chips.push({ icon: '📝', text: 'Day reflection', action: 'keep', prefill: { type: 'note' } });
    }

    // 3. Profile-based predictions (if enough data)
    if (profile?.top_intents?.length) {
      const bucket = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
      const predicted = profile[`${bucket}_intent`];
      if (predicted && !chips.find(c => c.action === predicted)) {
        const intentLabels = {
          reminder: { icon: '⏰', text: 'Set reminder' },
          expense: { icon: '💸', text: 'Log expense' },
          note: { icon: '📝', text: 'Quick note' },
          health: { icon: '❤️', text: 'Health check' },
          task: { icon: '✅', text: 'Add task' },
          contact: { icon: '📞', text: 'Call someone' },
        };
        const label = intentLabels[predicted];
        if (label) {
          chips.unshift({ icon: label.icon, text: label.text, action: predicted, prefill: { type: predicted }, predicted: true });
        }
      }
    }

    // 4. Friday finance nudge
    if (dayOfWeek === 5 && hour >= 17) {
      chips.push({ icon: '📊', text: 'Weekly finance review', action: 'navigate', prefill: { path: '/finance' } });
    }

    // 5. Health streak nudge (if user has logged health before)
    const { count } = await supabase.from('health_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (count > 0 && hour >= 20) {
      const today = new Date().toISOString().split('T')[0];
      const { data: todayLog } = await supabase.from('health_logs').select('id').eq('user_id', userId).eq('log_date', today).maybeSingle();
      if (!todayLog) {
        chips.unshift({ icon: '🔥', text: 'Keep your streak!', action: 'navigate', prefill: { path: '/health' }, urgent: true });
      }
    }

    return chips.slice(0, 3); // Max 3 chips
  } catch { return []; }
}

// ── Log intent to Supabase after every voice capture ──────────────
export async function learnFromCapture({ supabase, userId, intentType, transcript, language, confidence, locationName }) {
  // Fire and forget — non-blocking
  logIntent({ supabase, userId, intentType, rawTranscript: transcript, language, confidence, locationName, executed: true });

  // Every 20 captures, update the behaviour profile
  try {
    const { count } = await supabase.from('tau_intent_log').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (count && count % 20 === 0) {
      updateBehaviourProfile({ supabase, userId });
    }
  } catch {}
}
