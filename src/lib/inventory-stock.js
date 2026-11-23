// src/lib/inventory-stock.js
// ─────────────────────────────────────────────────────────────────────────────
// Close the inventory↔sales loop: when a sale is recorded (invoices, counter
// taps, text commands, or UPI payments), decrement matching inventory items
// or recipe ingredients and log stock movements.
//
// Extended for TASK B2 (AG-2):
// 1. Recipe items: Made-on-the-spot items (is_made_on_spot = true) with a
//    recipe decrement their raw ingredients (e.g. 0.1 L milk, 5 g tea powder).
// 2. Quick counter sales with idempotency (client_sale_id) for offline sync.
// 3. 10-second undo for counter sales to revert stock.
// 4. Closing check stock adjustments with reason='adjustment' and 0-100 accuracy score.
// 5. Best-effort audit log into stock_movements.
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
 * Calculates shop accuracy score (0-100) from physical counts vs system stock.
 *
 * @param {Array<{ system_stock: number, physical_count: number }>} itemCounts
 * @returns {number} Score between 0 and 100
 */
export function calculateAccuracyScore(itemCounts) {
  if (!Array.isArray(itemCounts) || itemCounts.length === 0) return 100;

  let exactMatches = 0;
  let totalExpected = 0;
  let totalDiscrepancy = 0;

  for (const item of itemCounts) {
    const expected = Math.max(0, num(item.system_stock));
    const physical = Math.max(0, num(item.physical_count));
    const diff = Math.abs(physical - expected);

    if (diff === 0) exactMatches++;
    totalExpected += expected;
    totalDiscrepancy += diff;
  }

  const itemMatchRatio = exactMatches / itemCounts.length;
  const quantityRatio = totalExpected > 0
    ? Math.max(0, 1 - (totalDiscrepancy / totalExpected))
    : (totalDiscrepancy === 0 ? 1 : 0);

  // 50% exact item match rate + 50% overall quantity adherence
  const rawScore = (0.5 * itemMatchRatio + 0.5 * quantityRatio) * 100;
  return Math.max(0, Math.min(100, Math.round(rawScore)));
}

/**
 * Core inventory decrement logic for sales (invoices, counter taps, text commands).
 * Resolves recipe ingredients for made-on-the-spot items.
 *
 * @param db          service-role Supabase client (writes)
 * @param workspaceId workspace uuid
 * @param lineItems   array of items sold
 * @param options     { referenceId, reason, paymentMode }
 * @returns { updated, missed, movements }
 */
export async function decrementStockForSale(db, workspaceId, lineItems, options = {}) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return { updated: 0, missed: 0, movements: [] };
  }

  const { referenceId = null, reason = 'sale', paymentMode = 'cash' } = options;

  // Fetch all inventory items for this workspace
  const { data: items } = await db
    .from('inventory_items')
    .select('id,name,sku,barcode,current_stock,is_made_on_spot,recipe')
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

    // Always update last_sale_at on the sold item
    try {
      await db.from('inventory_items')
        .update({ last_sale_at: nowIso, updated_at: nowIso })
        .eq('id', match.id);
    } catch (_) {}

    // Recipe Handling: Is this item made on the spot with a recipe?
    const hasRecipe = match.recipe && (
      Array.isArray(match.recipe)
        ? match.recipe.length > 0
        : (typeof match.recipe === 'object' && Array.isArray(match.recipe.ingredients) && match.recipe.ingredients.length > 0)
    );

    if (hasRecipe) {
      const rawRecipe = Array.isArray(match.recipe) ? match.recipe : match.recipe.ingredients;
      let recipeUpdated = 0;

      for (const ingredient of rawRecipe) {
        const ingredientQtyPerUnit = num(ingredient.quantity ?? ingredient.qty ?? 0);
        if (ingredientQtyPerUnit <= 0) continue;

        const totalIngredientQty = num(qty * ingredientQtyPerUnit);
        const ingId = ingredient.ingredient_id ?? ingredient.item_id ?? ingredient.id;
        const ingName = lc(ingredient.name ?? ingredient.item);

        const ingMatch = (ingId && byId.get(ingId)) || (ingName && byName.get(ingName));
        if (!ingMatch) continue;

        const newStock = num(num(ingMatch.current_stock) - totalIngredientQty);
        await db.from('inventory_items')
          .update({ current_stock: newStock, updated_at: nowIso })
          .eq('id', ingMatch.id);
        ingMatch.current_stock = newStock; // keep local cache updated

        const mvt = {
          workspace_id: workspaceId,
          item_id: ingMatch.id,
          change: -totalIngredientQty,
          balance_after: newStock,
          reason: 'recipe_sale',
          reference_id: referenceId,
          created_at: nowIso,
        };

        try {
          await db.from('stock_movements').insert(mvt);
        } catch (_) {}

        movements.push(mvt);
        recipeUpdated++;
      }

      if (recipeUpdated > 0) {
        updated++;
      } else {
        missed++;
      }
    } else {
      // Standard packaged item (no recipe): decrement its own stock directly
      const newStock = num(match.current_stock) - qty;
      await db.from('inventory_items')
        .update({ current_stock: newStock, updated_at: nowIso, last_sale_at: nowIso })
        .eq('id', match.id);
      match.current_stock = newStock;

      const mvt = {
        workspace_id: workspaceId,
        item_id: match.id,
        change: -qty,
        balance_after: newStock,
        reason: reason || 'sale',
        reference_id: referenceId,
        created_at: nowIso,
      };

      try {
        await db.from('stock_movements').insert(mvt);
      } catch (_) {}

      movements.push(mvt);
      updated++;
    }
  }

  return { updated, missed, movements };
}

/**
 * Backward compatibility for existing invoices route.
 */
export async function decrementStockForInvoice(db, workspaceId, lineItems, invoiceId) {
  const res = await decrementStockForSale(db, workspaceId, lineItems, {
    referenceId: invoiceId,
    reason: 'invoice_sale',
  });
  return { updated: res.updated, missed: res.missed };
}

/**
 * Record a quick counter sale (or text command sale) with idempotency protection.
 * Prevents double-counting during offline-to-online sync.
 *
 * @param db          service-role Supabase client
 * @param workspaceId uuid
 * @param params      { clientSaleId, items, paymentMode, totalAmount, source, createdBy, metadata }
 */
export async function recordCounterSale(db, workspaceId, params = {}) {
  const {
    clientSaleId = null,
    items = [],
    paymentMode = 'cash',
    totalAmount = 0,
    source = 'counter',
    createdBy = null,
    metadata = {},
  } = params;

  // 1. Idempotency Check for offline sync
  if (clientSaleId) {
    const { data: existing } = await db
      .from('business_sales')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('client_sale_id', clientSaleId)
      .maybeSingle();

    if (existing) {
      return {
        ok: true,
        already_processed: true,
        sale: existing,
        stock: { updated: 0, missed: 0, movements: [] },
      };
    }
  }

  // 2. Insert into business_sales
  const salePayload = {
    workspace_id: workspaceId,
    client_sale_id: clientSaleId,
    items,
    total_amount: num(totalAmount),
    payment_mode: paymentMode.toLowerCase() === 'upi' ? 'upi' : 'cash',
    status: 'completed',
    source,
    created_by: createdBy,
    metadata,
    created_at: new Date().toISOString(),
  };

  let saleRow = null;
  const { data: insertedSale, error: saleErr } = await db
    .from('business_sales')
    .insert(salePayload)
    .select()
    .single();

  if (saleErr) {
    // If unique constraint violated on concurrent insert, treat as already processed
    if (saleErr.code === '23505' && clientSaleId) {
      const { data: existing } = await db
        .from('business_sales')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('client_sale_id', clientSaleId)
        .maybeSingle();
      return {
        ok: true,
        already_processed: true,
        sale: existing,
        stock: { updated: 0, missed: 0, movements: [] },
      };
    }
    // If table doesn't exist yet, proceed with synthetic sale ID for stock decrement
    saleRow = { id: clientSaleId || 'temp_sale_' + Date.now(), ...salePayload };
  } else {
    saleRow = insertedSale;
  }

  // 3. Decrement stock through shared stock-movement path
  const reason = source === 'text_command' ? 'text_command_sale' : 'counter_sale';
  const stockResult = await decrementStockForSale(db, workspaceId, items, {
    referenceId: saleRow.id,
    reason,
    paymentMode,
  });

  // 4. Optionally record ledger entry
  try {
    if (num(totalAmount) > 0) {
      await db.from('business_ledger').insert({
        workspace_id: workspaceId,
        entry_type: 'credit',
        category: 'sales',
        amount: num(totalAmount),
        party_name: paymentMode.toUpperCase() + ' Counter Sale',
        description: `Counter sale (${items.map(i => `${i.quantity || 1}x ${i.name}`).join(', ')})`,
        payment_method: paymentMode,
        payment_status: 'paid',
        amount_pending: 0,
        transaction_date: new Date().toISOString().split('T')[0],
        source: 'counter',
        created_by: createdBy,
      });
    }
  } catch (_) {}

  return {
    ok: true,
    already_processed: false,
    sale: saleRow,
    stock: stockResult,
  };
}

/**
 * 10-second Undo for counter sales.
 * Reverts inventory decrements and marks sale cancelled.
 *
 * @param db          service-role Supabase client
 * @param workspaceId uuid
 * @param saleId      uuid of sale to undo
 */
export async function undoCounterSale(db, workspaceId, saleId) {
  if (!saleId) return { ok: false, error: 'saleId required' };

  // Fetch sale
  const { data: sale } = await db
    .from('business_sales')
    .select('*')
    .eq('id', saleId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!sale) {
    return { ok: false, error: 'Sale not found' };
  }

  if (sale.status === 'cancelled') {
    return { ok: true, already_cancelled: true };
  }

  const nowIso = new Date().toISOString();

  // Mark sale cancelled
  await db
    .from('business_sales')
    .update({ status: 'cancelled', cancelled_at: nowIso })
    .eq('id', saleId);

  // Fetch items to reverse stock
  const { data: items } = await db
    .from('inventory_items')
    .select('id,name,sku,barcode,current_stock,is_made_on_spot,recipe')
    .eq('workspace_id', workspaceId);

  if (!items || items.length === 0) return { ok: true, undone: true };

  const byId = new Map(), byName = new Map();
  for (const it of items) {
    byId.set(it.id, it);
    if (it.name) byName.set(lc(it.name), it);
  }

  const lineItems = Array.isArray(sale.items) ? sale.items : [];
  for (const li of lineItems) {
    const qty = lineQty(li);
    if (qty <= 0) continue;

    const k = lineKeys(li);
    const match = (k.itemId && byId.get(k.itemId)) || (k.name && byName.get(k.name));
    if (!match) continue;

    const hasRecipe = match.recipe && (
      Array.isArray(match.recipe)
        ? match.recipe.length > 0
        : (typeof match.recipe === 'object' && Array.isArray(match.recipe.ingredients) && match.recipe.ingredients.length > 0)
    );

    if (hasRecipe) {
      const rawRecipe = Array.isArray(match.recipe) ? match.recipe : match.recipe.ingredients;
      for (const ingredient of rawRecipe) {
        const ingredientQtyPerUnit = num(ingredient.quantity ?? ingredient.qty ?? 0);
        if (ingredientQtyPerUnit <= 0) continue;

        const totalIngredientQty = num(qty * ingredientQtyPerUnit);
        const ingId = ingredient.ingredient_id ?? ingredient.item_id ?? ingredient.id;
        const ingName = lc(ingredient.name ?? ingredient.item);

        const ingMatch = (ingId && byId.get(ingId)) || (ingName && byName.get(ingName));
        if (!ingMatch) continue;

        const restoredStock = num(num(ingMatch.current_stock) + totalIngredientQty);
        await db.from('inventory_items')
          .update({ current_stock: restoredStock, updated_at: nowIso })
          .eq('id', ingMatch.id);
        ingMatch.current_stock = restoredStock;

        try {
          await db.from('stock_movements').insert({
            workspace_id: workspaceId,
            item_id: ingMatch.id,
            change: totalIngredientQty, // positive = stock returned
            balance_after: restoredStock,
            reason: 'counter_undo',
            reference_id: saleId,
            created_at: nowIso,
          });
        } catch (_) {}
      }
    } else {
      const restoredStock = num(match.current_stock) + qty;
      await db.from('inventory_items')
        .update({ current_stock: restoredStock, updated_at: nowIso })
        .eq('id', match.id);
      match.current_stock = restoredStock;

      try {
        await db.from('stock_movements').insert({
          workspace_id: workspaceId,
          item_id: match.id,
          change: qty, // positive = stock returned
          balance_after: restoredStock,
          reason: 'counter_undo',
          reference_id: saleId,
          created_at: nowIso,
        });
      } catch (_) {}
    }
  }

  return { ok: true, undone: true };
}

/**
 * Closing check: corrects stock with 'adjustment' movements,
 * calculates accuracy score (0-100), and updates the workspace.
 *
 * @param db          service-role Supabase client
 * @param workspaceId uuid
 * @param params      { cashInDrawer, itemCounts, notes, checkedBy }
 */
export async function adjustStockForClosing(db, workspaceId, params = {}) {
  const {
    cashInDrawer = 0,
    expectedCash = 0,
    itemCounts = [],
    notes = '',
    checkedBy = null,
  } = params;

  const nowIso = new Date().toISOString();
  const closingDate = nowIso.split('T')[0];
  const cashGap = num(cashInDrawer) - num(expectedCash);

  // 1. Calculate Accuracy Score (0-100)
  const accuracyScore = calculateAccuracyScore(itemCounts);

  // 2. Adjust Stock for Top Packaged Items
  const adjustments = [];
  for (const item of itemCounts) {
    const itemId = item.item_id ?? item.id;
    if (!itemId) continue;

    const physicalCount = num(item.physical_count);
    const systemStock = num(item.system_stock);
    const gap = physicalCount - systemStock;

    // Update item stock in inventory
    await db.from('inventory_items')
      .update({ current_stock: physicalCount, updated_at: nowIso })
      .eq('id', itemId);

    // If gap exists, record 'adjustment' movement
    if (gap !== 0) {
      const mvt = {
        workspace_id: workspaceId,
        item_id: itemId,
        change: gap, // + or -
        balance_after: physicalCount,
        reason: 'adjustment',
        reference_id: null,
        created_at: nowIso,
      };

      try {
        await db.from('stock_movements').insert(mvt);
      } catch (_) {}
      adjustments.push(mvt);
    }
  }

  // 3. Update business_workspaces accuracy_score and closing fields
  await db.from('business_workspaces')
    .update({
      accuracy_score: accuracyScore,
      last_closing_at: nowIso,
      closing_cash_in_drawer: num(cashInDrawer),
      updated_at: nowIso,
    })
    .eq('id', workspaceId);

  // 4. Record audit log in business_closing_checks
  let closingCheckId = null;
  try {
    const { data: closingRecord } = await db
      .from('business_closing_checks')
      .insert({
        workspace_id: workspaceId,
        closing_date: closingDate,
        cash_in_drawer: num(cashInDrawer),
        expected_cash: num(expectedCash),
        cash_gap: cashGap,
        item_counts: itemCounts,
        accuracy_score: accuracyScore,
        notes,
        checked_by: checkedBy,
        created_at: nowIso,
      })
      .select()
      .single();
    closingCheckId = closingRecord?.id || null;
  } catch (_) {}

  return {
    ok: true,
    accuracy_score: accuracyScore,
    cash_gap: cashGap,
    adjustments_count: adjustments.length,
    closing_check_id: closingCheckId,
  };
}
