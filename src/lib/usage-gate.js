/**
 * src/lib/usage-gate.js
 *
 * Free tier usage tracking + gate enforcement.
 * Limits: 10 voice captures/day, 1 geo trigger, Daily Brief 3x/week.
 * Beta users (is_beta=true) and paid users bypass all gates.
 */

const FREE_VOICE_CAP = 10;
const FREE_GEO_TRIGGERS = 1;
const FREE_BRIEF_DAYS = [1, 3, 5]; // Mon, Wed, Fri

export async function checkVoiceCapLimit({ supabase, userId, tier, isBeta }) {
  if (isBeta || (tier && tier !== 'free')) return { allowed: true, used: 0, limit: Infinity };
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data } = await supabase
      .from('daily_usage')
      .select('voice_captures')
      .eq('user_id', userId)
      .eq('usage_date', today)
      .maybeSingle();
    const used = data?.voice_captures || 0;
    return { allowed: used < FREE_VOICE_CAP, used, limit: FREE_VOICE_CAP };
  } catch { return { allowed: true, used: 0, limit: FREE_VOICE_CAP }; }
}

export async function incrementVoiceCapture({ supabase, userId }) {
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data } = await supabase
      .from('daily_usage')
      .select('id, voice_captures')
      .eq('user_id', userId)
      .eq('usage_date', today)
      .maybeSingle();
    if (data) {
      await supabase.from('daily_usage').update({ voice_captures: (data.voice_captures || 0) + 1 }).eq('id', data.id);
    } else {
      await supabase.from('daily_usage').insert({ user_id: userId, usage_date: today, voice_captures: 1 });
    }
  } catch {}
}

export function checkDailyBriefAccess({ tier, isBeta }) {
  if (isBeta || (tier && tier !== 'free')) return { allowed: true };
  const dayOfWeek = new Date().getDay();
  return { allowed: FREE_BRIEF_DAYS.includes(dayOfWeek), nextDay: FREE_BRIEF_DAYS.find(d => d > dayOfWeek) || FREE_BRIEF_DAYS[0] };
}

export async function checkGeoTriggerLimit({ supabase, userId, tier, isBeta }) {
  if (isBeta || (tier && tier !== 'free')) return { allowed: true, active: 0, limit: Infinity };
  try {
    const { count } = await supabase
      .from('keeps')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('geo_trigger_enabled', true);
    return { allowed: (count || 0) < FREE_GEO_TRIGGERS, active: count || 0, limit: FREE_GEO_TRIGGERS };
  } catch { return { allowed: true, active: 0, limit: FREE_GEO_TRIGGERS }; }
}
