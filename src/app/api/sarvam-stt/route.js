// src/app/api/sarvam-stt/route.js - RETIRED (21 Oct 2026).
//
// This was the old direct-to-Sarvam path. It pinned Sarvam's oldest model
// (saarika:v2) and no screen uses it any more: the only caller,
// src/components/VoiceCapture.jsx, is not imported anywhere, and the phone
// stopped calling it in VoiceService v9. All QuietKeep speech-to-text now goes
// through /api/voice/stt -> the Aaria engine, which uses saaras:v4 (Sarvam's
// current model, same price, fewer errors).
//
// Kept as a route that answers 410 Gone instead of being deleted, so that
// anything still pointing here fails clearly and can never spend Sarvam
// credit on the old model. VoiceCapture's trySarvamSTT already treats a
// non-OK answer as 'no transcript' and falls back.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GONE = { error: 'retired', use: '/api/voice/stt', fallback: true };

export async function POST() {
  return NextResponse.json(GONE, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  return NextResponse.json(GONE, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
