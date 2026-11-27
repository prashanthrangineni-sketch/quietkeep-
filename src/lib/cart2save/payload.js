// src/lib/cart2save/payload.js
// ─────────────────────────────────────────────────────────────────────────────
// Cart2Save Payload Formatter & Security Boundary (AG-1 / AG-3)
// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL PRIVACY RULE:
// Never send cost price, supplier, profit, batch or customer data.
// Only:
//   Shop: shop name, category, lat/lng, address, phone, hours, upi_id, updated time.
//   Item: item name, barcode, unit, selling price, availability label, updated time.
// ─────────────────────────────────────────────────────────────────────────────

import { calculateAvailabilityLabel } from './availability.js';

/**
 * Forbidden keys that must NEVER leave QuietKeep in Cart2Save feeds.
 */
export const FORBIDDEN_FIELD_PATTERNS = [
  'purchase_price',
  'cost_price',
  'cost',
  'buy_price',
  'supplier',
  'supplier_name',
  'supplier_phone',
  'supplier_id',
  'profit',
  'margin',
  'batch',
  'batch_number',
  'batch_no',
  'batch_id',
  'lot_number',
  'customer',
  'customer_name',
  'customer_phone',
  'customer_id',
  'customer_email',
  'gstin',
  'gst_rate',
  'min_stock_alert',
  'current_stock',
  'owner_user_id',
  'user_id',
  'member_id',
  'created_by',
];

function isForbiddenKey(key) {
  const lower = key.toLowerCase();
  // Safe network/envelope metadata exceptions
  if (lower === 'batch_size' || lower === 'batch_count') return false;

  for (const pattern of FORBIDDEN_FIELD_PATTERNS) {
    if (lower === pattern || lower.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Allowed shop field names.
 */
export const ALLOWED_SHOP_FIELDS = new Set([
  'shop_name',
  'category',
  'lat',
  'lng',
  'address',
  'phone',
  'hours',
  'upi_id',
  'updated_time',
]);

/**
 * Allowed item field names.
 */
export const ALLOWED_ITEM_FIELDS = new Set([
  'item_id',
  'item_name',
  'barcode',
  'unit',
  'selling_price',
  'availability_label',
  'unpublish',
  'updated_time',
]);

/**
 * Builds the public shop payload strictly containing only allowed fields.
 *
 * @param {object} shop
 * @returns {object|null}
 */
export function buildShopPayload(shop) {
  if (!shop) return null;

  const lat = shop.lat !== undefined && shop.lat !== null && shop.lat !== ''
    ? Number(shop.lat)
    : null;
  const lng = shop.lng !== undefined && shop.lng !== null && shop.lng !== ''
    ? Number(shop.lng)
    : null;

  const payload = {
    shop_name: shop.name || shop.shop_name || '',
    category: shop.category || shop.business_type || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    address: shop.address || null,
    phone: shop.phone || null,
    hours: shop.hours || shop.opening_hours || null,
    upi_id: shop.upi_id || null,
    updated_time: shop.updated_at || shop.location_set_at || new Date().toISOString(),
  };

  assertNoPrivateFields(payload);
  return payload;
}

/**
 * Builds the public item payload strictly containing only allowed fields.
 *
 * @param {object} item
 * @param {object} [shop]
 * @param {Date} [now]
 * @returns {object|null}
 */
export function buildItemPayload(item, shop = {}, now = new Date()) {
  if (!item) return null;

  const sellingPrice = item.selling_price !== undefined && item.selling_price !== null && item.selling_price !== ''
    ? Number(item.selling_price)
    : null;

  const hasPrice = Number.isFinite(sellingPrice) && sellingPrice > 0;
  const nowDate = now instanceof Date ? now : new Date(now);

  const payload = {
    item_name: item.name || item.item_name || '',
    barcode: item.barcode || null,
    unit: item.unit || 'pcs',
    selling_price: hasPrice ? sellingPrice : null,
    // An item with no selling price is never shown to shoppers (it would appear as Rs 0).
    availability_label: hasPrice ? calculateAvailabilityLabel({ item, shop, now: nowDate }) : 'hidden',
    // 27 Nov 2026: this is the moment the availability word above was worked out, not the
    // last time the owner edited the item. Cart2Save hides anything older than 24 hours and
    // shows shoppers "updated X min ago", so an item nobody edited for a day used to vanish
    // even though its stock was re-checked on every re-send.
    updated_time: nowDate.toISOString(),
  };

  assertNoPrivateFields(payload);
  return payload;
}

/**
 * Builds the unpublish item payload containing required identifying fields
 * (item_id, item_name, barcode, unit, selling_price, unpublish: true, updated_time)
 * matching Cart2Save receiver expectations (pranix-witness-ui PR #189 feedHandler.ts).
 *
 * @param {object} item
 * @returns {object}
 */
export function buildUnpublishItemPayload(item) {
  if (!item) return null;

  const sellingPrice = item.selling_price !== undefined && item.selling_price !== null && item.selling_price !== ''
    ? Number(item.selling_price)
    : 0;

  const payload = {
    item_id: String(item.id || item.item_id || '').trim(),
    item_name: String(item.name || item.item_name || '').trim(),
    barcode: item.barcode || null,
    unit: item.unit || 'pcs',
    selling_price: Number.isFinite(sellingPrice) ? sellingPrice : 0,
    unpublish: true,
    updated_time: item.updated_at || new Date().toISOString(),
  };

  assertNoPrivateFields(payload);
  return payload;
}

/**
 * Validates that an object contains NO private, internal, or confidential fields.
 * Throws an Error if any forbidden field is detected.
 *
 * @param {any} obj
 * @throws {Error}
 */
export function assertNoPrivateFields(obj) {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      assertNoPrivateFields(item);
    }
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (isForbiddenKey(key)) {
      throw new Error(`SECURITY VIOLATION: Private field "${key}" detected in Cart2Save payload!`);
    }

    if (value && typeof value === 'object') {
      assertNoPrivateFields(value);
    }
  }
}

/**
 * Strips any forbidden private fields from a payload (defense-in-depth).
 *
 * @param {object} obj
 * @returns {object}
 */
export function sanitizePayload(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizePayload);
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!isForbiddenKey(key)) {
      clean[key] = value && typeof value === 'object' ? sanitizePayload(value) : value;
    }
  }
  return clean;
}
