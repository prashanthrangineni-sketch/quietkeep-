// src/app/api/documents/classify/route.js
// Look at an uploaded document once and propose how to file it.
//
// CONTRACT
//   POST { image_base64, mime }  ->  200 { fields }  |  200 { fields: null, reason }
//
// It NEVER returns an error status for a failed reading. The caller is an upload
// flow: if this cannot read the document, the user must still be able to save it
// by hand. A 500 here would block a save that has nothing wrong with it.
//
// PRIVACY
// The image is forwarded to the model and not stored by this route. The prompt
// (src/lib/document-classify.js) explicitly forbids transcribing full Aadhaar or
// PAN numbers — only the last four characters come back. That is a real
// constraint for an Indian app: a full Aadhaar number sitting in a `doc_number`
// column is a liability, and the user gains nothing from it being there.
//
// MODEL
// OPENAI_API_KEY is already provisioned in this project's Vercel environment;
// ANTHROPIC_API_KEY is NOT, which is why /api/ai/summary answers 503 in
// production. Using what is actually configured, rather than adding a key the
// founder would have to provision before this works.

export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { CLASSIFY_PROMPT, toDocumentFields } from '@/lib/document-classify';

const MODEL      = process.env.DOC_VISION_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = Number(process.env.DOC_VISION_TIMEOUT_MS || 20000);
const MAX_BYTES  = 6 * 1024 * 1024;   // ~8MB once base64-encoded

function bearerClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

/** Everything here degrades to "user fills it in themselves". */
function cannotRead(reason) {
  return NextResponse.json({ fields: null, reason }, { status: 200 });
}

export async function POST(request) {
  const supabase = bearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return cannotRead('not_configured');

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const b64  = String(body?.image_base64 || '');
  const mime = String(body?.mime || 'image/jpeg');

  if (!b64) return cannotRead('no_image');
  // base64 is ~4/3 of the raw bytes.
  if (b64.length * 0.75 > MAX_BYTES) return cannotRead('too_large');
  if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(mime)) {
    // PDFs and Office files are perfectly valid documents to store; this route
    // just cannot look at them. Saving still works, unassisted.
    return cannotRead('unsupported_type');
  }

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        temperature: 0,          // filing is not a creative task
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: CLASSIFY_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'low' } },
          ],
        }],
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('[doc-classify] HTTP', res.status, t.slice(0, 200));
      return cannotRead('model_error');
    }

    const json    = await res.json().catch(() => null);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return cannotRead('empty_response');

    let parsed;
    try { parsed = JSON.parse(content); }
    catch {
      const m = String(content).match(/\{[\s\S]*\}/);
      if (!m) return cannotRead('unparseable');
      try { parsed = JSON.parse(m[0]); } catch { return cannotRead('unparseable'); }
    }

    // All the correctness — day-first dates, category mapping, plausibility —
    // lives in the pure helper, which is covered by 61 assertions.
    return NextResponse.json({ fields: toDocumentFields(parsed) }, { status: 200 });

  } catch (err) {
    if (err?.name === 'AbortError') return cannotRead('timeout');
    console.error('[doc-classify]', err?.message || String(err));
    return cannotRead('exception');
  } finally {
    clearTimeout(timer);
  }
}
