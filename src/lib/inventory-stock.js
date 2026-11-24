// src/lib/inventory-stock.js
// ─────────────────────────────────────────────────────────────────────────────
// Close the inventory↔sales loop: when a sale is recorded (invoices, counter
// sales, or confirmed UPI shop orders), decrement the matching inventory item's
// current_stock and log a stock movement.
//
// Matching is by itemId → SKU → barcode → name (case-insensitive), scoped to workspace.
// Best-effort by design: a match miss or movement-log failure never throws into
// the sale path. Caller wraps this in try/catch and never blocks the sale on it.
// ─────────────────────────────────────────────────────────────────────────────

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 10000) / 10000 : 0;
}

export function lc(v) {
  return (v == null ? '' : String(v)).trim().toLowerCase();
}

// Pull a quantity out of a line item regardless of the field name the UI used.
export function lineQty(li) {
  return num(li.quantity ?? li.qty ?? li.units ?? li.count ?? li.nos ?? 0);
}

// Pull the best identifier from a line item.
export function lineKeys(li) {
  return {
    sku: lc(li.sku ?? li.SKU ?? li.item_code),
    barcode: lc(li.barcode ?? li.ean),
    name: lc(li.name ?? li.item ?? li.description ?? li.product),
    itemId: li.item_id ?? li.inventory_id ?? li.id ?? null,
  };
}

/**
 * Decrement stock for a completed or confirmed sale (counter, UPI shop order, etc.)
 *
 * @param {object} db - service-role Supabase client (writes)
 * @param {string} workspaceId - workspace uuid
 * @param {Array} lineItems - array of sold line items
 * @param {object} options - { referenceId, reason, paymentMode }
 * @returns {Promise<{ updated: number, missed: number, movements: Array }>}
 */
export async function decrementStockForSale(db, workspaceId, lineItems, options = {}) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return { updated: 0, missed: 0, movements: [] };
  }

  const { referenceId = null, reason = 'sale', paymentMode = 'upi' } = options;

  const { data: items } = await db
    .from('inventory_items')
    .select('id,name,sku,barcode,current_stock')
    .eq('workspace_id', workspaceId);

  if (!items || items.length === 0) {
    return { updated: 0, missed: lineItems.length, movements: [] };
  }

  const byId = new Map(), bySku = new Map(), byBarcode = new Map(), byName = new Map();
  for (const it of items) {
    byId.set(it.id, it);
    if (it.sku) bySku.set(lc(it.sku), it);
    if (it.barcode) byBarcode.set(lc(it.barcode), it);
    if (it.name) byName.set(lc(it.name), it);
  }

  let updated = 0, missed = 0;
  const movements = [];
  const nowIso = new Date().toISOString();

  for (const li of lineItems) {
    const qty = lineQty(li);
    if (qty <= 0) continue;

    const k = lineKeys(li);
    const match =
      (k.itemId && byId.get(k.itemId)) ||
      (k.sku && bySku.get(k.sku)) ||
      (k.barcode && byBarcode.get(k.barcode)) ||
      (k.name && byName.get(k.name));

    if (!match) {
      missed++;
      continue;
    }

    const newStock = num(num(match.current_stock) - qty);
    await db.from('inventory_items')
      .update({ current_stock: newStock, updated_at: nowIso })
      .eq('id', match.id);

    match.current_stock = newStock; // keep local copy consistent if item repeats in bill
    updated++;

    const mvt = {
      workspace_id: workspaceId,
      item_id: match.id,
      change: -qty,
      balance_after: newStock,
      reason,
      reference_id: referenceId || null,
      created_at: nowIso,
    };
    movements.push(mvt);

    // Best-effort audit log into stock_movements
    try {
      await db.from('stock_movements').insert(mvt);
    } catch (_) {}
  }

  return { updated, missed, movements };
}

/**
 * @param db          service-role Supabase client (writes)
 * @param workspaceId workspace uuid
 * @param lineItems   array of invoice line items (jsonb)
 * @param invoiceId   uuid, stored as the movement reference
 * @returns { updated, missed } counts
 */
export async function decrementStockForInvoice(db, workspaceId, lineItems, invoiceId) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return { updated: 0, missed: 0 };

  const { data: items } = await db
    .from('inventory_items')
    .select('id,name,sku,barcode,current_stock')
    .eq('workspace_id', workspaceId);
  if (!items || items.length === 0) return { updated: 0, missed: lineItems.length };

  const byId = new Map(), bySku = new Map(), byBarcode = new Map(), byName = new Map();
  for (const it of items) {
    byId.set(it.id, it);
    if (it.sku) bySku.set(lc(it.sku), it);
    if (it.barcode) byBarcode.set(lc(it.barcode), it);
    if (it.name) byName.set(lc(it.name), it);
  }

  let updated = 0, missed = 0;
  const nowIso = new Date().toISOString();

  for (const li of lineItems) {
    const qty = lineQty(li);
    if (qty <= 0) continue;
    const k = lineKeys(li);
    const match =
      (k.itemId && byId.get(k.itemId)) ||
      (k.sku && bySku.get(k.sku)) ||
      (k.barcode && byBarcode.get(k.barcode)) ||
      (k.name && byName.get(k.name));

    if (!match) { missed++; continue; }

    const newStock = num(match.current_stock) - qty;
    await db.from('inventory_items')
      .update({ current_stock: newStock, updated_at: nowIso })
      .eq('id', match.id);
    match.current_stock = newStock; // keep local copy consistent if item repeats
    updated++;

    // Best-effort audit log (table may not exist until the migration is applied).
    try {
      await db.from('stock_movements').insert({
        workspace_id: workspaceId,
        item_id: match.id,
        change: -qty,
        balance_after: newStock,
        reason: 'invoice_sale',
        reference_id: invoiceId || null,
        created_at: nowIso,
      });
    } catch (_) { /* stock_movements not present yet — decrement still stands */ }
  }

  return { updated, missed };
}
