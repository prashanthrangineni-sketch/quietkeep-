// src/app/api/business/invoices/pdf/route.js
// Generates a shareable invoice HTML file, stores it in Supabase storage
// (documents bucket), writes pdf_url + pdf_path back to business_invoices,
// and returns a signed URL valid for 1 year.
//
// POST { invoice_id: string }
// Returns { pdf_url: string, path: string }

export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// ── Auth helpers ──────────────────────────────────────────────────────────────
function authSB(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function serviceSB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function rupee(n) {
  return '\u20b9' + (parseFloat(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── HTML invoice builder ──────────────────────────────────────────────────────
// Matches the client-side buildInvoiceHTML() in b/invoices/page.jsx exactly
// so the stored PDF looks identical to the print preview.
function buildInvoiceHTML(inv, ws) {
  const rows = (inv.line_items || []).map(i =>
    '<tr>' +
    '<td>' + esc(i.name) + '</td>' +
    '<td style="text-align:center">' + esc(i.qty) + ' ' + esc(i.unit || '') + '</td>' +
    '<td style="text-align:right">' + rupee(i.rate) + '</td>' +
    '<td style="text-align:center">' + esc(i.gst_rate) + '%</td>' +
    '<td style="text-align:right">' + rupee(i.total) + '</td>' +
    '</tr>'
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Invoice ${esc(inv.invoice_number)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:24px;max-width:820px;margin:0 auto}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #10b981}
  .biz-name{font-size:22px;font-weight:800;color:#10b981}
  .inv-num{font-size:18px;font-weight:700;text-align:right}
  .meta{font-size:11px;color:#666;margin-top:3px}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:18px}
  .party h3{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#999;margin-bottom:4px}
  .party p{font-size:11px;color:#555;line-height:1.5}
  .party strong{font-size:13px;color:#1a1a1a}
  table{width:100%;border-collapse:collapse;margin-bottom:14px}
  th{background:#f0fdf4;padding:7px 9px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;border-bottom:1px solid #d1fae5}
  td{padding:7px 9px;border-bottom:1px solid #f3f4f6;font-size:11px}
  .totals{float:right;width:210px}
  .tot-row{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;color:#555}
  .tot-final{font-size:15px;font-weight:800;color:#10b981;border-top:2px solid #10b981;padding-top:6px;margin-top:4px}
  .footer{clear:both;border-top:1px solid #e5e7eb;padding-top:12px;text-align:center;font-size:10px;color:#999;margin-top:16px}
  .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:9px;font-weight:700;text-transform:uppercase;background:#d1fae5;color:#065f46}
  @media print{body{padding:0}@page{margin:15mm;size:A4}}
</style></head><body>
<div class="header">
  <div>
    <div class="biz-name">${esc(ws?.name || 'Business')}</div>
    ${ws?.gstin ? `<div class="meta">GSTIN: ${esc(ws.gstin)}</div>` : ''}
    ${ws?.phone ? `<div class="meta">\u260e ${esc(ws.phone)}</div>` : ''}
    ${ws?.email ? `<div class="meta">${esc(ws.email)}</div>` : ''}
    ${ws?.address ? `<div class="meta">${esc(ws.address)}</div>` : ''}
  </div>
  <div>
    <div class="inv-num">${esc(inv.invoice_number)}</div>
    <div class="meta" style="text-align:right">Date: ${esc(inv.invoice_date || '')}</div>
    ${inv.due_date ? `<div class="meta" style="text-align:right">Due: ${esc(inv.due_date)}</div>` : ''}
    <div style="text-align:right;margin-top:4px"><span class="badge">${esc(inv.status || 'draft')}</span></div>
  </div>
</div>
<div class="parties">
  <div class="party">
    <h3>From</h3>
    <strong>${esc(ws?.name || '')}</strong>
    ${ws?.gstin ? `<p>GSTIN: ${esc(ws.gstin)}</p>` : ''}
    ${ws?.address ? `<p>${esc(ws.address)}</p>` : ''}
  </div>
  <div class="party">
    <h3>Bill To</h3>
    <strong>${esc(inv.customer_name || '')}</strong>
    ${inv.customer_phone ? `<p>\u260e ${esc(inv.customer_phone)}</p>` : ''}
    ${inv.customer_gstin ? `<p>GSTIN: ${esc(inv.customer_gstin)}</p>` : ''}
    ${inv.customer_address ? `<p>${esc(inv.customer_address)}</p>` : ''}
  </div>
</div>
<table>
  <thead><tr>
    <th>Description</th>
    <th style="text-align:center">Qty</th>
    <th style="text-align:right">Rate</th>
    <th style="text-align:center">GST</th>
    <th style="text-align:right">Amount</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <div class="tot-row"><span>Subtotal</span><span>${rupee(inv.subtotal)}</span></div>
  ${inv.cgst ? `<div class="tot-row"><span>CGST</span><span>${rupee(inv.cgst)}</span></div>` : ''}
  ${inv.sgst ? `<div class="tot-row"><span>SGST</span><span>${rupee(inv.sgst)}</span></div>` : ''}
  ${inv.igst ? `<div class="tot-row"><span>IGST</span><span>${rupee(inv.igst)}</span></div>` : ''}
  <div class="tot-row tot-final"><span>TOTAL</span><span>${rupee(inv.total_amount)}</span></div>
</div>
${inv.notes ? `<div style="clear:both;padding:10px;background:#f9fafb;border-radius:6px;font-size:11px;color:#555;margin-bottom:12px"><strong>Notes:</strong> ${esc(inv.notes)}</div>` : ''}
<div class="footer">Generated by QuietKeep Business &middot; ${esc(ws?.name || '')} &middot; Pranix AI Labs</div>
</body></html>`;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req) {
  try {
    // 1. Auth
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sb = authSB(token);
    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 2. Parse body
    let invoice_id;
    try {
      ({ invoice_id } = await req.json());
    } catch {
      return NextResponse.json({ error: 'invoice_id required' }, { status: 400 });
    }
    if (!invoice_id) return NextResponse.json({ error: 'invoice_id required' }, { status: 400 });

    // 3. Fetch invoice — RLS ensures user can only access their workspace's invoices
    const { data: inv, error: invErr } = await sb
      .from('business_invoices')
      .select('*')
      .eq('id', invoice_id)
      .single();
    if (invErr || !inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    // 4. Fetch workspace for letterhead
    const { data: ws } = await sb
      .from('business_workspaces')
      .select('name, gstin, phone, email, address')
      .eq('id', inv.workspace_id)
      .maybeSingle();

    // 5. Build HTML
    const html = buildInvoiceHTML(inv, ws);
    const htmlBytes = new TextEncoder().encode(html);
    const storagePath = `invoices/${inv.workspace_id}/${invoice_id}.html`;

    // 6. Upload to Supabase storage (service role needed for storage write)
    const svc = serviceSB();
    const { error: uploadErr } = await svc.storage
      .from('documents')
      .upload(storagePath, htmlBytes, {
        contentType: 'text/html; charset=utf-8',
        upsert: true, // overwrite if regenerated
      });

    if (uploadErr) {
      return NextResponse.json(
        { error: 'Storage upload failed: ' + uploadErr.message },
        { status: 500 }
      );
    }

    // 7. Generate signed URL valid for 1 year
    const { data: signed, error: signErr } = await svc.storage
      .from('documents')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365);

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Could not generate signed URL' }, { status: 500 });
    }

    // 8. Write pdf_url + pdf_path back to the invoice row
    await sb
      .from('business_invoices')
      .update({ pdf_url: signed.signedUrl, pdf_path: storagePath })
      .eq('id', invoice_id);

    return NextResponse.json({ pdf_url: signed.signedUrl, path: storagePath });
  } catch (e) {
    console.error('[INVOICES_PDF POST]', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
