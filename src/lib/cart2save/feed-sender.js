// src/lib/cart2save/feed-sender.js
// ─────────────────────────────────────────────────────────────────────────────
// Cart2Save Feed Sender & Outbox Batch Processor (AG-1 / AG-3)
// ─────────────────────────────────────────────────────────────────────────────
// Sends batches to Cart2Save POST /api/integrations/quietkeep-business
// with HMAC header (secret name QK_BUSINESS_FEED_SECRET, do not create it).
// Retries with exponential backoff and marks sent.
// Off by default behind CART2SAVE_FEED_ENABLED.
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
export async function processFeedOutboxBatch({
  db,
  fetchImpl = globalThis.fetch,
  batchSize = 50,
  now = new Date(),
  endpoint = process.env.CART2SAVE_FEED_URL || DEFAULT_CART2SAVE_ENDPOINT,
}) {
  // 1. Guard: Off by default behind CART2SAVE_FEED_ENABLED
  if (process.env.CART2SAVE_FEED_ENABLED !== 'true') {
    return {
      enabled: false,
      skipped: true,
      reason: 'CART2SAVE_FEED_ENABLED is not enabled (default: false)',
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

  const currentTimeIso = (now instanceof Date ? now : new Date(now)).toISOString();

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

  // 4. Construct feed payload
  const batchItems = rows.map(r => ({
    outbox_id: r.id,
    workspace_id: r.workspace_id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    action: r.action,
    data: r.payload,
  }));

  const payload = {
    source: 'quietkeep_business',
    sent_at: currentTimeIso,
    batch_size: batchItems.length,
    items: batchItems,
  };

  // 5. DEFENSE-IN-DEPTH: Assert no private fields across the entire batch
  assertNoPrivateFields(payload);

  const bodyString = JSON.stringify(payload);
  const signature = computeHmacSignature(bodyString, secret);

  const headers = {
    'Content-Type': 'application/json',
    'X-QK-Signature': signature,
    'X-Hub-Signature-256': `sha256=${signature}`,
    'X-QK-Timestamp': currentTimeIso,
  };

  const rowIds = rows.map(r => r.id);

  // 6. Send batch via HTTP POST
  let sendError = null;
  let responseOk = false;
  let responseStatus = 0;
  let responseText = '';

  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: bodyString,
    });
    responseStatus = res.status;
    responseOk = res.ok;
    responseText = await res.text();
    if (!res.ok) {
      sendError = `HTTP ${res.status}: ${responseText.slice(0, 200)}`;
    }
  } catch (err) {
    sendError = err.message || 'Network error';
  }

  // 7. Update outbox rows based on result
  if (responseOk) {
    // Succeeded: mark status = 'sent'
    await db
      .from('cart2save_outbox')
      .update({
        status: 'sent',
        processed_at: currentTimeIso,
        last_attempt_at: currentTimeIso,
        error: null,
      })
      .in('id', rowIds);

    return {
      success: true,
      processed: rows.length,
      sent: rows.length,
      status: responseStatus,
    };
  } else {
    // Failed: retry with backoff for each row
    for (const row of rows) {
      const nextAttempts = (row.attempts || 0) + 1;
      const backoffMs = calculateBackoffMs(nextAttempts);
      const nextAttemptAt = new Date((now instanceof Date ? now.getTime() : new Date(now).getTime()) + backoffMs).toISOString();
      const finalFailed = nextAttempts >= MAX_RETRY_ATTEMPTS;

      await db
        .from('cart2save_outbox')
        .update({
          attempts: nextAttempts,
          status: finalFailed ? 'failed' : 'pending',
          last_attempt_at: currentTimeIso,
          next_attempt_at: nextAttemptAt,
          error: sendError,
        })
        .eq('id', row.id);
    }

    return {
      success: false,
      processed: rows.length,
      sent: 0,
      error: sendError,
      status: responseStatus,
    };
  }
}
