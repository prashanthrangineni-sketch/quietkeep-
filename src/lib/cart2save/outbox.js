// src/lib/cart2save/outbox.js
// ─────────────────────────────────────────────────────────────────────────────
// Cart2Save Outbox Queue & Event Handlers (AG-1 / AG-3)
// ─────────────────────────────────────────────────────────────────────────────
// Every change to a public item or shop writes an outbox row.
// Switching off Cart2Save sends an unpublish payload.
// Nightly full re-send re-enqueues all active shops and their public items.
// ─────────────────────────────────────────────────────────────────────────────

import { buildShopPayload, buildItemPayload, assertNoPrivateFields, sanitizePayload } from './payload.js';

/**
 * Inserts an outbox row into `cart2save_outbox`.
 * Ensures payload is sanitized and strictly contains no private fields.
 *
 * @param {object} db - Supabase client (service role recommended for outbox writes)
 * @param {object} params
 * @param {string} params.workspace_id
 * @param {'shop'|'item'} params.entity_type
 * @param {string} params.entity_id
 * @param {'upsert'|'unpublish'|'delete'} params.action
 * @param {object} params.payload
 * @returns {Promise<{ data: any, error: any }>}
 */
export async function writeOutboxRow(db, { workspace_id, entity_type, entity_id, action, payload }) {
  if (!db) throw new Error('Database client required');

  const cleanPayload = sanitizePayload(payload);
  assertNoPrivateFields(cleanPayload);

  const row = {
    workspace_id,
    entity_type,
    entity_id: String(entity_id),
    action,
    payload: cleanPayload,
    status: 'pending',
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
  };

  const { data, error } = await db.from('cart2save_outbox').insert(row).select().single();
  if (error) {
    console.error('[CART2SAVE OUTBOX] Insert failed:', error.message);
  }
  return { data, error };
}

/**
 * Handles changes to a business_workspace.
 * - If show_on_cart2save is switched OFF: enqueues an 'unpublish' action.
 * - If show_on_cart2save is ON: enqueues an 'upsert' action with sanitized shop payload.
 *
 * @param {object} db
 * @param {string} workspaceId
 * @param {object|null} previousWs
 * @param {object} currentWs
 */
export async function handleWorkspaceChange(db, workspaceId, previousWs, currentWs) {
  if (!db || !workspaceId || !currentWs) return;

  const wasEnabled = Boolean(previousWs?.show_on_cart2save);
  const isEnabled = Boolean(currentWs?.show_on_cart2save);

  if (wasEnabled && !isEnabled) {
    // Switch off sends unpublish!
    const unpublishPayload = {
      shop_id: workspaceId,
      unpublish: true,
      updated_time: new Date().toISOString(),
    };
    return writeOutboxRow(db, {
      workspace_id: workspaceId,
      entity_type: 'shop',
      entity_id: workspaceId,
      action: 'unpublish',
      payload: unpublishPayload,
    });
  }

  if (isEnabled) {
    const shopPayload = buildShopPayload(currentWs);
    await writeOutboxRow(db, {
      workspace_id: workspaceId,
      entity_type: 'shop',
      entity_id: workspaceId,
      action: 'upsert',
      payload: shopPayload,
    });

    // If shop was newly enabled, also enqueue all public inventory items
    if (!wasEnabled) {
      await enqueueAllPublicItems(db, workspaceId, currentWs);
    }
  }
}

/**
 * Handles changes to an inventory item.
 * - If deleted or transitioned from public to private: enqueues 'unpublish'.
 * - If item is public: enqueues 'upsert' with sanitized item payload.
 *
 * @param {object} db
 * @param {object} item
 * @param {object|null} previousItem
 * @param {object} [shop]
 */
export async function handleItemChange(db, item, previousItem, shop = {}) {
  if (!db || !item) return;

  const wasPublic = Boolean(previousItem?.is_public);
  const isPublic = Boolean(item?.is_public);
  const isDeleted = Boolean(item?.deleted);

  if (isDeleted || (wasPublic && !isPublic)) {
    // Unpublish item
    const unpublishPayload = {
      item_id: item.id,
      unpublish: true,
      updated_time: new Date().toISOString(),
    };
    return writeOutboxRow(db, {
      workspace_id: item.workspace_id,
      entity_type: 'item',
      entity_id: item.id,
      action: 'unpublish',
      payload: unpublishPayload,
    });
  }

  if (isPublic) {
    const itemPayload = buildItemPayload(item, shop);
    return writeOutboxRow(db, {
      workspace_id: item.workspace_id,
      entity_type: 'item',
      entity_id: item.id,
      action: 'upsert',
      payload: itemPayload,
    });
  }
}

/**
 * Enqueues outbox records for all public items of a workspace.
 *
 * @param {object} db
 * @param {string} workspaceId
 * @param {object} [shop]
 */
export async function enqueueAllPublicItems(db, workspaceId, shop = {}) {
  if (!db || !workspaceId) return { count: 0 };

  const { data: items, error } = await db
    .from('inventory_items')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_public', true);

  if (error || !items) return { count: 0, error };

  for (const item of items) {
    await writeOutboxRow(db, {
      workspace_id: workspaceId,
      entity_type: 'item',
      entity_id: item.id,
      action: 'upsert',
      payload: buildItemPayload(item, shop),
    });
  }

  return { count: items.length };
}

/**
 * Nightly full re-send:
 * Finds all workspaces with show_on_cart2save = true and re-enqueues shop + public items.
 *
 * @param {object} db
 * @returns {Promise<{ workspacesCount: number, itemsCount: number }>}
 */
export async function enqueueNightlyFullResend(db) {
  if (!db) throw new Error('Database client required');

  const { data: workspaces, error: wsError } = await db
    .from('business_workspaces')
    .select('*')
    .eq('show_on_cart2save', true);

  if (wsError || !workspaces) {
    return { workspacesCount: 0, itemsCount: 0, error: wsError?.message };
  }

  let totalItems = 0;
  for (const ws of workspaces) {
    // 1. Enqueue shop upsert
    await writeOutboxRow(db, {
      workspace_id: ws.id,
      entity_type: 'shop',
      entity_id: ws.id,
      action: 'upsert',
      payload: buildShopPayload(ws),
    });

    // 2. Enqueue all public items
    const { count } = await enqueueAllPublicItems(db, ws.id, ws);
    totalItems += (count || 0);
  }

  return { workspacesCount: workspaces.length, itemsCount: totalItems };
}
