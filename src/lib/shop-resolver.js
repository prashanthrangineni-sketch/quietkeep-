// src/lib/shop-resolver.js
// ─────────────────────────────────────────────────────────────────────────────
// Resolver: given a scanned upi:// string or raw UPI ID, find the shop
// by UPI ID and return its public /s/[shop] page.
//
// Used by:
// 1. QuietKeep scanner
// 2. Cart2Save scanner app
// 3. Web counter scanners
// ─────────────────────────────────────────────────────────────────────────────

import { parseUpiUri, validateUpiId } from './upi.js';

/**
 * Resolves a shop workspace from a scanned UPI URI or raw UPI string.
 *
 * @param {string} scannedText - Scanned text from QR code (e.g. upi://pay?pa=... or merchant@bank)
 * @param {object} db - Supabase client (service role or read client)
 * @returns {Promise<{ found: boolean, url?: string, upi_id?: string, shop?: object, error?: string }>}
 */
export async function resolveShopFromUpi(scannedText, db) {
  if (!scannedText || typeof scannedText !== 'string') {
    return { found: false, error: 'Invalid or missing scanned UPI string' };
  }

  const parsed = parseUpiUri(scannedText);
  if (!parsed.valid || !parsed.pa) {
    return {
      found: false,
      error: parsed.error || 'Could not extract valid UPI ID from scanned string',
      raw: scannedText,
    };
  }

  const upiId = parsed.pa.toLowerCase();

  try {
    // Query business_workspaces by upi_id (case-insensitive)
    const { data: workspaces, error } = await db
      .from('business_workspaces')
      .select('id,name,upi_id,phone,address,business_type,slug')
      .ilike('upi_id', upiId);

    if (error) {
      console.error('[resolveShopFromUpi] DB error:', error.message);
      return { found: false, upi_id: upiId, error: 'Database lookup failed' };
    }

    if (!workspaces || workspaces.length === 0) {
      return {
        found: false,
        upi_id: upiId,
        error: `No shop registered with UPI ID: ${upiId}`,
      };
    }

    const shop = workspaces[0];
    const shopIdentifier = shop.slug || shop.id;
    const url = `/s/${shopIdentifier}`;

    return {
      found: true,
      upi_id: upiId,
      url,
      shop: {
        id: shop.id,
        name: shop.name,
        upi_id: shop.upi_id,
        slug: shop.slug || null,
        phone: shop.phone || null,
        address: shop.address || null,
        business_type: shop.business_type || null,
      },
      parsedPayload: {
        amount: parsed.am,
        note: parsed.tn,
        name: parsed.pn,
      },
    };
  } catch (err) {
    console.error('[resolveShopFromUpi] Unexpected error:', err.message);
    return { found: false, upi_id: upiId, error: err.message };
  }
}
