// src/app/api/business/gstr-3b/route.js
// ─────────────────────────────────────────────────────────────────────────────
// GSTR-3B DRAFT (SOT P3) — monthly return, computed from business_invoices +
// business_ledger. THIS IS A DRAFT AID, NOT A FILING. The merchant reviews the
// numbers and files them on the GST portal (or via a GSP). Nothing is
// submitted to any tax authority from here.
//
// WHY DRAFT-ONLY
// A wrong GSTR-3B has real legal + monetary consequences (interest under
// Section 50, late fees under Section 47, ITC mismatch notices). Direct filing
// requires GSP integration + digital signature and is a separate, licensed
// path. Automating the arithmetic — which is where most manual errors come
// from — is the safe, useful thing to do now.
//
// SOURCES
//   Table 3.1(a) outward taxable supplies   ← business_invoices where issued
//                                             (status in sent/paid), sum
//                                             subtotal + CGST/SGST/IGST
//   Table 3.1(b/c/e) zero/exempt/non-GST    ← UNSUPPORTED in MVP — flagged as
//                                             manual (no schema field yet)
//   Table 3.1(d) inward RCM                 ← UNSUPPORTED in MVP — flagged
//   Table 4(A)(5) other ITC                 ← business_ledger where debit
//                                             AND gst_amount > 0
//   Table 4(B/D) reversals + ineligible ITC ← manual (no schema fields)
//   Net tax payable                         ← output tax − ITC, per head
//                                             (CGST vs SGST vs IGST, never
//                                             cross-set-off)
//
// STATUS FILTER
// draft and cancelled invoices are EXCLUDED — a draft has not been issued to
// the customer, and cancelled invoices are not part of taxable supply.
//
//   GET /api/business/gstr-3b?period=YYYY-MM
//     → { period, gstin, tables: {...}, warnings: [...], generated_at }
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';

const ISSUED = new Set(['sent', 'paid', 'partial', 'overdue']); // filed statuses

function monthRange(period) {
  // period = 'YYYY-MM' → [startISO, endISO) — end is exclusive first-of-next-month
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function n(v) { return Number(v || 0); }
function round(v) { return Math.round(n(v) * 100) / 100; }

export async function GET(req) {
  try {
    const ctx = await requireBizPermission(req, 'billing', 'view');
    if (ctx.error) return ctx.error;

    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period')
      || new Date().toISOString().slice(0, 7);      // default = current month
    const range = monthRange(period);
    if (!range) return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 });

    const db = createWriteClient();

    // ── Outward: invoices issued in the period (draft/cancelled excluded) ──
    const { data: invoices } = await db.from('business_invoices')
      .select('id,status,subtotal,cgst,sgst,igst,total_gst,total_amount,invoice_date')
      .eq('workspace_id', ctx.workspace.id)
      .gte('invoice_date', range.start)
      .lt('invoice_date', range.end);

    const issued = (invoices || []).filter(i => ISSUED.has((i.status || '').toLowerCase()));
    const draftOrCancelled = (invoices || []).length - issued.length;

    let outSubtotal = 0, outCGST = 0, outSGST = 0, outIGST = 0;
    for (const i of issued) {
      outSubtotal += n(i.subtotal);
      outCGST += n(i.cgst);
      outSGST += n(i.sgst);
      outIGST += n(i.igst);
    }

    // ── Inward: ledger DEBITS with GST — treat as ITC-eligible purchases ──
    // MVP: everything falls in 4(A)(5) "All other ITC" until we distinguish
    // imports / RCM / ISD (adds schema fields).
    const { data: purchases } = await db.from('business_ledger')
      .select('id,amount,gst_amount,gst_rate,transaction_date,category')
      .eq('workspace_id', ctx.workspace.id)
      .eq('entry_type', 'debit')
      .gt('gst_amount', 0)
      .gte('transaction_date', range.start)
      .lt('transaction_date', range.end);

    // Split ITC into CGST/SGST/IGST halves. Without a place-of-supply signal
    // per row we assume intra-state (CGST+SGST); we flag this in warnings.
    let itcCGST = 0, itcSGST = 0, itcIGST = 0;
    for (const p of purchases || []) {
      const g = n(p.gst_amount);
      itcCGST += g / 2;
      itcSGST += g / 2;
    }

    // ── Net tax payable (per head; heads never cross-set-off in 3B) ──
    const netCGST = Math.max(0, outCGST - itcCGST);
    const netSGST = Math.max(0, outSGST - itcSGST);
    const netIGST = Math.max(0, outIGST - itcIGST);

    // ── Warnings — the merchant MUST see what's not automated ──
    const warnings = [];
    if (!issued.length) warnings.push('no_issued_invoices_in_period');
    if (draftOrCancelled > 0) warnings.push(`excluded_${draftOrCancelled}_draft_or_cancelled_invoice(s)`);
    if (!purchases?.length) warnings.push('no_gst_purchases_logged_ITC_is_zero_verify');
    if (purchases?.length) warnings.push('itc_split_assumes_intra_state_verify_inter_state_purchases');
    warnings.push('zero_rated_exempt_non_gst_supplies_not_auto_detected_add_manually');
    warnings.push('rcm_inward_3_1_d_not_auto_detected_add_manually');
    warnings.push('itc_reversals_and_ineligible_itc_manual_only');
    if (!ctx.workspace.gstin) warnings.push('workspace_has_no_gstin_configured');

    return NextResponse.json({
      period,
      gstin: ctx.workspace.gstin || null,
      business_name: ctx.workspace.name || null,
      is_draft: true,
      generated_at: new Date().toISOString(),
      tables: {
        '3.1_a_outward_taxable': {
          label: 'Outward taxable supplies (other than zero-rated, nil-rated, exempted)',
          taxable_value: round(outSubtotal),
          cgst: round(outCGST),
          sgst: round(outSGST),
          igst: round(outIGST),
          cess: 0,
        },
        '3.1_b_zero_rated':    { label: 'Zero-rated (exports + SEZ)',      auto: false, note: 'add manually' },
        '3.1_c_nil_exempt':    { label: 'Nil-rated, exempted',              auto: false, note: 'add manually' },
        '3.1_d_inward_rcm':    { label: 'Inward supplies liable to reverse charge', auto: false, note: 'add manually' },
        '3.1_e_non_gst':       { label: 'Non-GST outward supplies',         auto: false, note: 'add manually' },
        '4_A_5_other_itc': {
          label: 'ITC available — all other ITC',
          cgst: round(itcCGST),
          sgst: round(itcSGST),
          igst: round(itcIGST),
          cess: 0,
        },
        '4_B_reversals':       { label: 'ITC reversals (Rules 38/42/43, 180-day)', auto: false, note: 'manual entry' },
        '4_D_ineligible':      { label: 'Ineligible ITC (Section 17(5))',            auto: false, note: 'manual entry' },
      },
      totals: {
        output_tax:   { cgst: round(outCGST), sgst: round(outSGST), igst: round(outIGST) },
        itc_available:{ cgst: round(itcCGST), sgst: round(itcSGST), igst: round(itcIGST) },
        net_payable:  { cgst: round(netCGST), sgst: round(netSGST), igst: round(netIGST),
                        total: round(netCGST + netSGST + netIGST) },
      },
      counts: {
        invoices_included: issued.length,
        invoices_excluded_draft_or_cancelled: draftOrCancelled,
        purchases_with_gst: purchases?.length || 0,
      },
      warnings,
      disclaimer: 'DRAFT ONLY — verify every line on the GST portal before filing. Wrong figures attract interest and penalties.',
    });
  } catch (e) {
    console.error('[gstr-3b]', e?.message || e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
