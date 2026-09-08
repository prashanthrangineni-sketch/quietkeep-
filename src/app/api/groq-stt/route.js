// src/app/api/groq-stt/route.js
//
// W3 — THIS ENDPOINT NO LONGER SENDS INDIC AUDIO TO WHISPER.
// It now delegates to /api/voice/stt, which routes Indic speech to Aaria
// (Sarvam saaras:v3) and keeps Groq Whisper for English and as fallback.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS CHANGED
//
// The previous header of this file said:
//
//     "Sarvam AI was discontinued — Groq Whisper Large v3 Turbo replaces it."
//
// That is not true, and it never was. Sarvam is live: the Aaria engine calls
// api.sarvam.ai successfully today, and its /api/health reports
// `sarvam:saaras:v3` healthy. The same claim appears in VoiceService.java,
// where the real symptom was that /api/sarvam-stt timed out — a configuration
// or key problem that was diagnosed as a vendor shutdown.
//
// The consequence of that wrong diagnosis is severe for our users. On the
// benchmark NVIDIA presented at their Voice AI session (Eka Care, 6,550 real
// conversations, semantic word error rate — lower is better):
//
//     Telugu   Sarvam saaras:v3  29.8   |   Whisper Large v3  96.2
//     Hindi    Sarvam saaras:v3  21.6   |   Whisper Large v3  52.3
//     Marathi  Sarvam            40.8   |   Whisper Large v3 101.4
//
// Whisper is not marginally behind on Indian languages. It is failing. Every
// Telugu utterance spoken into the Android app has been going to the worst
// model in that table.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY DELEGATE RATHER THAN CHANGE THE APP
//
// The Android client posts to a URL. Changing which model serves that URL ships
// with the next Vercel deploy — no APK rebuild, no Play Store submission, no
// review. Given the app's release history that matters: this fix reaches users
// today instead of in weeks.
//
// The contract is unchanged. /api/voice/stt documents itself as a drop-in for
// this endpoint and accepts both shapes this route accepted:
//   1. application/json      { audio: <base64>, language?: <BCP-47> }
//   2. multipart/form-data   file=<Blob>, language_code?=<BCP-47>
// It returns the same fields plus `engine_used`, which is additive — existing
// callers that ignore unknown fields are unaffected.
//
// This file is kept (rather than deleted) precisely because callers still point
// at it: VoiceService.java, the browser STT fallback, and anything else we have
// not enumerated. Deleting it would break them; delegating fixes them all.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { POST as voiceSttPOST } from '../voice/stt/route';

export const dynamic = 'force-dynamic';

const GROQ_MODEL = 'whisper-large-v3-turbo';

/**
 * Delegates to /api/voice/stt.
 *
 * Routing there: Indic → Aaria (Sarvam), English → Groq Whisper, with fallback
 * in both directions so this is never worse than the behaviour it replaces.
 */
export async function POST(req) {
  return voiceSttPOST(req);
}

// Health probe, unchanged in shape so sttRouter.checkGroqAvailability() keeps
// working. Groq is still genuinely used - for English, and as the fallback for
// Indic when Aaria is unreachable - so this still reports on a live dependency.
export async function GET() {
  const ok = !!process.env.GROQ_API_KEY;
  return NextResponse.json(
    {
      ok,
      provider: 'groq',
      model: GROQ_MODEL,
      method: 'POST',
      delegates_to: '/api/voice/stt',
      note: 'Indic audio is routed to Aaria (Sarvam); Groq serves English and fallback.',
    },
    { status: ok ? 200 : 503 },
  );
}
