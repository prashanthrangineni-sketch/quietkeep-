// src/lib/business-resolver.js
// Business intent resolver — mirrors geo-resolver.js pattern exactly.
// detect → resolve → return payload (caller writes to DB)
//
// Called from voice/capture when workspace_id is set AND intent type is
// one of: ledger_credit | ledger_debit | sale
//
// SAFE: all functions wrapped in try/catch. Returns null on any failure.
// The keep INSERT in voice/capture is unaffected if this module fails.
//
// Exports:
//   resolveBusinessIntent(supabase, workspaceId, userId, parsed, text)
//     → BusinessPayload | null

// ── Amount extraction ─────────────────────────────────────────────────────────
// Handles: "500", "₹500", "Rs 500", "5,000", "5000"
// Priority: price after 'for/at/@' > explicit ₹/Rs prefix > last number in text
// Fixes: "sold 2 items for 120" → 120 (not 2)
function extractAmount(text) {
  // 1. Price keyword: "for 120", "at 60", "@ 500"
  const priceM = text.match(/(?:for|at|@)\s*₹?\s*Rs?\.?\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
  if (priceM) return parseFloat(priceM[1].replace(/,/g, ''));
  // 2. Explicit currency prefix: "₹500", "Rs 200"
  const currM = text.match(/(?:₹|rs\.?\s*|rupees?\s*)(\d[\d,]*(?:\.\d{1,2})?)/i);
  if (currM) return parseFloat(currM[1].replace(/,/g, ''));
  // 3. Last standalone number (avoids quantities like "2 items")
  const all = [...text.matchAll(/\b(\d[\d,]*(?:\.\d{1,2})?)\b/g)];
  if (!all.length) return null;
  return parseFloat(all[all.length - 1][1].replace(/,/g, ''));
}

// ── Party name extraction ─────────────────────────────────────────────────────
// Handles: "from Ramesh", "to Suresh", "by Priya", "for Naveen"
function extractPartyName(text) {
  const m = text.match(/(?:from|to|by|for|with)\s+([A-Za-z][A-Za-z\s]{1,30}?)(?:\s+(?:for|rs|₹|\d|and|the|a\b)|$)/i);
  if (m) return m[1].trim();
  // Fallback: last proper noun not matching common words
  const words = text.split(/\s+/);
  const stopWords = new Set(['received','paid','sold','gave','credit','debit','sale','ledger',
    'rupees','from','to','by','for','with','and','the','a','an','on','in','of','at']);
  const candidates = words.filter(w =>
    w.length > 2 && /^[A-Z]/.test(w) && !stopWords.has(w.toLowerCase())
  );
  return candidates[0] || null;
}

// ── Entry type classification ─────────────────────────────────────────────────
// Returns 'credit' | 'debit' | null
function classifyEntryType(text) {
  const lower = text.toLowerCase();
  // Credit signals
  if (/received|paid me|collected|sale\b|sold|credit from|income/.test(lower)) return 'credit';
  // Debit signals
  if (/gave|give credit|advance to|paid to|expense|debit|lent|spent on/.test(lower)) return 'debit';
  return null;
}

// ── Category heuristic ────────────────────────────────────────────────────────
function classifyCategory(text, entryType) {
  const lower = text.toLowerCase();
  if (/sale\b|sold/.test(lower))               return 'sales';
  if (/purchase|bought|stock|supply/.test(lower)) return 'purchase';
  if (/salary|wages|staff|employee/.test(lower)) return 'salary';
  if (/rent|lease/.test(lower))                return 'rent';
  if (/utility|electricity|water|internet/.test(lower)) return 'utilities';
  return entryType === 'credit' ? 'sales' : 'expense';
}

// ── Customer matching ─────────────────────────────────────────────────────────
// Fuzzy match against business_customers for this workspace.
// Returns { id, name, phone } or null.
async function matchCustomer(supabase, workspaceId, partyName) {
  if (!partyName) return null;
  try {
    const { data } = await supabase
      .from('business_customers')
      .select('id, name, phone, outstanding_balance')
      .eq('workspace_id', workspaceId)
      .ilike('name', `%${partyName.trim()}%`)
      .limit(5);

    if (!data?.length) return null;

    // Exact match first
    const exact = data.find(c =>
      c.name.toLowerCase() === partyName.toLowerCase()
    );
    if (exact) return exact;

    // Single partial match
    if (data.length === 1) return data[0];

    // Multiple — return closest length match
    return data.sort((a, b) =>
      Math.abs(a.name.length - partyName.length) -
      Math.abs(b.name.length - partyName.length)
    )[0];
  } catch {
    return null;
  }
}

// ── Non-blocking: update customer totals after ledger entry ───────────────────
async function updateCustomerTotals(supabase, customerId, amount, entryType) {
  try {
    const { data: customer } = await supabase
      .from('business_customers')
      .select('outstanding_balance, total_business')
      .eq('id', customerId)
      .single();

    if (!customer) return;

    const delta = entryType === 'credit' ? amount : -amount;
    await supabase.from('business_customers').update({
      outstanding_balance:  Math.max(0, (customer.outstanding_balance || 0) - (entryType === 'credit' ? amount : 0)),
      total_business:       (customer.total_business || 0) + amount,
      last_transaction_date: new Date().toISOString().split('T')[0],
    }).eq('id', customerId);
  } catch {
    // Non-fatal — ledger entry already written
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * resolveBusinessIntent
 *
 * @param {object} supabase   — service-role client
 * @param {string} workspaceId
 * @param {string} userId
 * @param {object} parsed     — result of parseIntent()
 * @param {string} text       — raw transcript
 *
 * @returns {Promise<BusinessPayload|null>}
 *
 * BusinessPayload:
 * {
 *   ledger_entry: {              — ready to INSERT into business_ledger
 *     workspace_id, entry_type, category, party_name, party_phone?,
 *     amount, description, payment_method, payment_status,
 *     source, voice_transcript, created_by
 *   },
 *   customer: { id, name, phone } | null,   — matched business_customer
 *   tts_response: string,                   — spoken confirmation
 *   intent_subtype: 'ledger_credit' | 'ledger_debit' | 'sale',
 * }
 */
export async function resolveBusinessIntent(supabase, workspaceId, userId, parsed, text) {
  try {
    // Determine which subtype this is
    let intentSubtype = null;
    const lower = text.toLowerCase();

    if (/sale\b|sold/.test(lower)) {
      intentSubtype = 'sale';
    } else {
      const et = classifyEntryType(text);
      if (et === 'credit') intentSubtype = 'ledger_credit';
      else if (et === 'debit') intentSubtype = 'ledger_debit';
    }

    if (!intentSubtype) return null;   // not a business ledger intent

    const amount    = extractAmount(text);
    const partyName = extractPartyName(text) || parsed.entities?.names?.[0] || null;
    const entryType = intentSubtype === 'ledger_debit' ? 'debit' : 'credit';
    const category  = classifyCategory(text, entryType);

    if (!amount) {
      // No amount found — still valid, amount will be 0 for manual update
      console.log('[BIZ-RESOLVER] no amount found in:', text.slice(0, 60));
    }

    // Customer match (non-blocking — null is fine)
    const customer = await matchCustomer(supabase, workspaceId, partyName);

    const ledgerEntry = {
      workspace_id:     workspaceId,
      entry_type:       entryType,
      category,
      party_name:       customer?.name || partyName || null,
      party_phone:      customer?.phone || null,
      amount:           amount || 0,
      description:      text.slice(0, 200),
      payment_method:   'cash',       // default; user can edit
      payment_status:   'paid',       // default; will be 'pending' for credit-given
      source:           'voice',
      voice_transcript: text.slice(0, 500),
      created_by:       userId,
    };

    // Credit given (debit) to customer = pending payment
    if (intentSubtype === 'ledger_debit' && /gave|give credit|advance|credit to/.test(lower)) {
      ledgerEntry.payment_status  = 'pending';
      ledgerEntry.amount_pending  = amount || 0;
    }

    // TTS confirmation
    let tts_response;
    const amountStr = amount ? `₹${amount.toLocaleString('en-IN')}` : '';
    const partyStr  = customer?.name || partyName || '';

    if (intentSubtype === 'sale') {
      tts_response = `Sale recorded${partyStr ? ` for ${partyStr}` : ''}${amountStr ? `: ${amountStr}` : ''}.`;
    } else if (intentSubtype === 'ledger_credit') {
      tts_response = `Received ${amountStr}${partyStr ? ` from ${partyStr}` : ''}. Entry saved.`;
    } else {
      const isPending = ledgerEntry.payment_status === 'pending';
      tts_response = isPending
        ? `Credit of ${amountStr} given to ${partyStr || 'customer'}. Marked as pending.`
        : `Payment of ${amountStr}${partyStr ? ` to ${partyStr}` : ''} recorded.`;
    }

    console.log(`[BIZ-RESOLVER] subtype=${intentSubtype} amount=${amount} party=${partyStr} customer_matched=${!!customer}`);

    return {
      ledger_entry:   ledgerEntry,
      customer,
      tts_response,
      intent_subtype: intentSubtype,
    };
  } catch (e) {
    console.error('[BIZ-RESOLVER] resolveBusinessIntent error (fail-safe):', e.message);
    return null;
  }
}

// ── writeLedgerEntry ──────────────────────────────────────────────────────────
// Writes the resolved payload to business_ledger.
// Called AFTER the keep INSERT succeeds — non-blocking from caller's perspective.
//
export async function writeLedgerEntry(supabase, bizPayload, keepId) {
  try {
    const { data, error } = await supabase
      .from('business_ledger')
      .insert({ ...bizPayload.ledger_entry, keep_id: keepId })
      .select('id')
      .single();

    if (error) {
      console.error('[BIZ-RESOLVER] writeLedgerEntry failed:', error.message);
      return null;
    }

    // Non-blocking: update customer totals
    if (bizPayload.customer?.id && bizPayload.ledger_entry.amount > 0) {
      updateCustomerTotals(
        supabase,
        bizPayload.customer.id,
        bizPayload.ledger_entry.amount,
        bizPayload.ledger_entry.entry_type
      ).catch(() => {});
    }

    console.log('[BIZ-RESOLVER] ledger entry written:', data?.id?.slice(0, 8));
    return data?.id || null;
  } catch (e) {
    console.error('[BIZ-RESOLVER] writeLedgerEntry error (fail-safe):', e.message);
    return null;
  }
      }
