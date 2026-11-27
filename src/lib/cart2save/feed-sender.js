// src/lib/cart2save/feed-sender.js
// ─────────────────────────────────────────────────────────────────────────────
// Cart2Save Feed Sender & Outbox Batch Processor (AG-1 / AG-3)
// ─────────────────────────────────────────────────────────────────────────────
// Sends batches to Cart2Save POST /api/integrations/quietkeep-business
// with HMAC header (secret name QK_BUSINESS_FEED_SECRET, do not create it).
// Retries with exponential backoff and marks sent.
// On by default (27 Nov 2026). Set CART2SAVE_FEED_ENABLED=false to switch the whole feed off.
// Only shops that chose "Show on Cart2Save", and only items they marked public, are ever queued.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { assertNoPrivateFields } from './payload.js';

export const DEFAULT_CART2SAVE_ENDPOINT = 'https://cart2save.com/api/integrations/quietkeep-business';
export const MAX_RETRY_ATTEMPTS = 5;
export const BASE_BACKOFF_MS = 60 * 1000; // 1 minute base backoff

/**
 * Computes HMAC-SHA256 signature for the given body and secret.
 *
 * @param {string} bodyString
 * @param {string} secret
 * @returns {string}
 */
export function computeHmacSignature(bodyString, secret) {
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
}

/**
 * Calculates exponential backoff delay in milliseconds based on attempt count.
 * Formula: min(24h, BASE_BACKOFF_MS * 2^(attempts - 1))
 *
 * @param {number} attempts
 * @param {number} [baseMs]
 * @returns {number}
 */
export function calculateBackoffMs(attempts, baseMs = BASE_BACKOFF_MS) {
  const maxDelay = 24 * 60 * 60 * 1000; // 24 hours max
  const exponent = Math.max(0, attempts - 1);
  const delay = Math.min(maxDelay, baseMs * Math.pow(2, exponent));
  return delay;
}

/**
 * Processes a batch of pending/retryable outbox records and dispatches them to Cart2Save.
 *
 * @param {object} params
 * @param {object} params.db - Supabase client with write access
 * @param {function} [params.fetchImpl] - Fetch implementation (for testing and DI)
 * @param {number} [params.batchSize] - Maximum items to dispatch in this batch
 * @param {Date} [params.now] - Current timestamp
 * @param {string} [params.endpoint] - Target URL
 * @returns {Promise<object>} Execution summary
 */
/** True unless the feed has been switched off with CART2SAVE_FEED_ENABLED=false. */
export function isFeedEnabled(env = process.env) {
  return String(env.CART2SAVE_FEED_ENABLED ?? '').trim().toLowerCase() !== 'false';
}

/**
 * Groups outbox rows by shop and keeps only the newest row for each shop or item.
 * Cart2Save's door reads ONE shop per call, so a call must never mix shops.
 * Rows that are older duplicates of the same thing are returned as `superseded`
 * so they can be closed together with the row that replaced them.
 */
export function groupRowsByShop(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const key = String(r.workspace_id || 'no-shop');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const [workspaceId, list] of groups) {
    const latest = new Map();
    for (const r of list) latest.set(`${r.entity_type}:${r.entity_id}`, r); // rows arrive oldest first
    const keep = [...latest.values()];
    const keepIds = new Set(keep.map((r) => r.id));
    // the shop first, then its items
    keep.sort((a, b) => (a.entity_type === 'shop' ? 0 : 1) - (b.entity_type === 'shop' ? 0 : 1));
    out.push({ workspaceId, send: keep, all: list, superseded: list.filter((r) => !keepIds.has(r.id)) });
  }
  return out;
}

/**
 * Processes pending/retryable outbox rows and sends them to Cart2Save, one call per shop.
 *
 * @param {object} params
 * @param {object} params.db - Supabase client with write access
 * @param {function} [params.fetchImpl] - Fetch implementation (for testing and DI)
 * @param {number} [params.batchSize] - Maximum rows to read in this run
 * @param {Date} [params.now] - Current timestamp
 * @param {string} [params.endpoint] - Target URL
 * @returns {Promise<object>} Execution summary
 */
export async function processFeedOutboxBatch({
  db,
  fetchImpl = globalThis.fetch,
  batchSize = 200,
  now = new Date(),
  endpoint = process.env.CART2SAVE_FEED_URL || DEFAULT_CART2SAVE_ENDPOINT,
}) {
  // 1. Guard: on unless switched off
  if (!isFeedEnabled()) {
    return {
      enabled: false,
      skipped: true,
      reason: 'CART2SAVE_FEED_ENABLED is set to false (the feed is switched off)',
    };
  }

  // 2. Secret check: QK_BUSINESS_FEED_SECRET
  const secret = process.env.QK_BUSINESS_FEED_SECRET;
  if (!secret) {
    return {
      enabled: true,
      success: false,
      error: 'QK_BUSINESS_FEED_SECRET is not configured',
    };
  }

  if (!db) {
    throw new Error('Database client required');
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  const currentTimeIso = nowDate.toISOString();

  // 3. Fetch candidate rows
  const { data: rows, error: selectErr } = await db
    .from('cart2save_outbox')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', currentTimeIso)
    .lt('attempts', MAX_RETRY_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (selectErr) {
    console.error('[CART2SAVE SENDER] DB Select error:', selectErr.message);
    return { success: false, error: selectErr.message };
  }

  if (!rows || rows.length === 0) {
    return { success: true, processed: 0, sent: 0, message: 'No pending items' };
  }

  // 4. One call per shop
  const groups = groupRowsByShop(rows);
  let sent = 0;
  let failed = 0;
  let lastStatus = 0;
  let lastError = null;
  const shops = [];

  for (const group of groups) {
    const payload = {
      source: 'quietkeep_business',
      sent_at: currentTimeIso,
      batch_size: group.send.length,
      items: group.send.map((r) => ({
        outbox_id: r.id,
        workspace_id: r.workspace_id,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        action: r.action,
        data: r.payload,
      })),
    };

    let sendError = null;
    let responseOk = false;
    let responseStatus = 0;

    try {
      // DEFENSE-IN-DEPTH: no private field may leave, whatever is in the outbox
      assertNoPrivateFields(payload);

      const bodyString = JSON.stringify(payload);
      const signature = computeHmacSignature(bodyString, secret);
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QK-Signature': signature,
          'X-Hub-Signature-256': `sha256=${signature}`,
          'X-QK-Timestamp': currentTimeIso,
        },
        body: bodyString,
      });
      responseStatus = res.status;
      responseOk = res.ok;
      const responseText = await res.text();
      if (!res.ok) sendError = `HTTP ${res.status}: ${String(responseText).slice(0, 200)}`;
    } catch (err) {
      sendError = err.message || 'Network error';
    }
    lastStatus = responseStatus;

    if (responseOk) {
      await db
        .from('cart2save_outbox')
        .update({
          status: 'sent',
          processed_at: currentTimeIso,
          last_attempt_at: currentTimeIso,
          error: null,
        })
        .in('id', group.all.map((r) => r.id));
      sent += group.all.length;
      shops.push({ workspace_id: group.workspaceId, ok: true, rows: group.all.length });
    } else {
      lastError = sendError;
      for (const row of group.all) {
        const nextAttempts = (row.attempts || 0) + 1;
        const nextAttemptAt = new Date(nowDate.getTime() + calculateBackoffMs(nextAttempts)).toISOString();
        await db
          .from('cart2save_outbox')
          .update({
            attempts: nextAttempts,
            status: nextAttempts >= MAX_RETRY_ATTEMPTS ? 'failed' : 'pending',
            last_attempt_at: currentTimeIso,
            next_attempt_at: nextAttemptAt,
            error: sendError,
          })
          .eq('id', row.id);
      }
      failed += group.all.length;
      shops.push({ workspace_id: group.workspaceId, ok: false, rows: group.all.length, error: sendError });
    }
  }

  return {
    success: failed === 0,
    processed: rows.length,
    sent,
    failed,
    shops,
    status: lastStatus,
    ...(lastError ? { error: lastError } : {}),
  };
}
