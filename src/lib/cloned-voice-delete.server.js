// src/lib/cloned-voice-delete.server.js
// Server-only helper for one-tap deletion of custom/cloned voice preferences across
// Aaria engine, ElevenLabs, and Supabase database.
import { askEngineToForget } from "./aaria-forget.js";

/**
 * Safely executes custom voice preferences deletion across engine, ElevenLabs, and Supabase.
 */
export async function executeVoicePreferencesDelete({
  supabase,
  userId,
  elevenlabsApiKey = process.env.ELEVENLABS_API_KEY,
  aariaCallerKey = process.env.AARIA_CALLER_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!userId) {
    return { ok: false, status: 400, error: "User ID required" };
  }

  // 1. Engine forget: fail if key missing or engine forget fails
  if (!aariaCallerKey) {
    return {
      ok: false,
      status: 500,
      error: "Engine key not configured (AARIA_CALLER_KEY missing). Cannot perform safe deletion.",
    };
  }

  const engineRes = await askEngineToForget(userId, {
    fetchImpl,
    passOpts: { key: aariaCallerKey },
  });
  if (!engineRes.ok) {
    return {
      ok: false,
      status: 502,
      error: "Engine forget refused or failed. Cannot report success.",
      reason: engineRes.reason,
    };
  }

  // 2. Fetch user voice ID to delete from ElevenLabs
  const { data: userSet, error: userSetErr } = await supabase.from("user_settings")
    .select("elevenlabs_voice_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (userSetErr) {
    return { ok: false, status: 500, error: userSetErr.message };
  }

  const voicesToDelete = new Set();
  if (userSet?.elevenlabs_voice_id) {
    voicesToDelete.add(userSet.elevenlabs_voice_id);
  }
  if (Array.isArray(engineRes.providerVoicesToRemove)) {
    engineRes.providerVoicesToRemove.forEach((v) => { if (v) voicesToDelete.add(v); });
  }

  // If there are voices to delete and ELEVENLABS_API_KEY is missing, return 500 {ok:false} — never deleted:true.
  if (voicesToDelete.size > 0 && !elevenlabsApiKey) {
    return {
      ok: false,
      status: 500,
      error: "ELEVENLABS_API_KEY missing; cannot delete remote voice",
    };
  }

  for (const vid of voicesToDelete) {
    if (vid && elevenlabsApiKey) {
      try {
        const elRes = await fetchImpl(`https://api.elevenlabs.io/v1/voices/${vid}`, {
          method: "DELETE",
          headers: { "xi-api-key": elevenlabsApiKey },
        });
        if (!elRes.ok && elRes.status !== 404) {
          const detail = typeof elRes.text === "function" ? await elRes.text().catch(() => "") : "";
          return {
            ok: false,
            status: 502,
            error: `ElevenLabs voice deletion failed (${elRes.status}): ${String(detail).slice(0, 200)}`,
          };
        }
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: `Failed to contact ElevenLabs to delete voice: ${err.message}`,
        };
      }
    }
  }

  // 3. Remove consent record from voice_profile_consents
  const { error: consentDelErr } = await supabase.from("voice_profile_consents").delete().eq("user_id", userId);
  if (consentDelErr) {
    return { ok: false, status: 500, error: consentDelErr.message };
  }

  // 4. Clear locally in user_settings
  const { error: clearErr } = await supabase.from("user_settings").upsert({
    user_id: userId,
    elevenlabs_voice_id: null,
    voice_clone_consent: false,
    consent_own_or_permitted: false,
    consent_no_deception: false,
    consent_in_app_labeled: false,
    voice_clone_consent_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (clearErr) {
    return { ok: false, status: 500, error: clearErr.message };
  }

  try {
    await supabase.from("audit_log").insert({
      user_id: userId,
      action: "voice_clone_deleted",
      service: "voice_clone",
      details: { purged_consents: true, erased: engineRes.erased },
    });
  } catch (_) {}

  return { ok: true, status: 200, deleted: true };
}
