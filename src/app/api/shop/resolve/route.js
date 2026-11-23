// src/app/api/shop/resolve/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Resolver endpoint: Given a scanned upi:// string or raw UPI ID,
// finds the shop by UPI ID and returns its /s/[shop] page.
//
// Used by QuietKeep and Cart2Save scanners.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
import { createWriteClient } from '@/lib/supabase-bearer';
import { resolveShopFromUpi } from '@/lib/shop-resolver';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const upi = searchParams.get('upi') || searchParams.get('pa') || searchParams.get('q');

    if (!upi) {
      return Response.json(
        { found: false, error: 'Missing upi query parameter (e.g. ?upi=upi://pay?pa=... or ?upi=shop@bank)' },
        { status: 400 }
      );
    }

    const db = createWriteClient();
    const result = await resolveShopFromUpi(upi, db);

    if (!result.found) {
      return Response.json(result, { status: 404 });
    }

    return Response.json(result);
  } catch (err) {
    console.error('[API /api/shop/resolve GET]', err.message);
    return Response.json({ found: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const upi = body.upi || body.upi_id || body.scanned;

    if (!upi) {
      return Response.json(
        { found: false, error: 'Missing upi or upi_id in JSON body' },
        { status: 400 }
      );
    }

    const db = createWriteClient();
    const result = await resolveShopFromUpi(upi, db);

    if (!result.found) {
      return Response.json(result, { status: 404 });
    }

    return Response.json(result);
  } catch (err) {
    console.error('[API /api/shop/resolve POST]', err.message);
    return Response.json({ found: false, error: 'Internal server error' }, { status: 500 });
  }
}
