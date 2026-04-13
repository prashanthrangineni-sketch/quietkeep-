'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { apiPost, apiGet } from '@/lib/safeFetch';
/**
 * src/app/b/invoices/page.jsx
 * GST Invoice system with client-side PDF (print window) + WhatsApp sharing.
 * No server or external library required for PDF generation.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';

const G          = '#10b981';
const GST_RATES  = [0, 5, 12, 18, 28];
const EMPTY_ITEM = { name: '', qty: 1, unit: 'pcs', rate: 0, gst_rate: 18 };

function calcItem(i) {
  const base = parseFloat(i.qty || 1) * parseFloat(i.rate || 0);
  const gst  = base * (parseFloat(i.gst_rate || 0) / 100);
  return { ...i, base, gst, total: base + gst };
}

function rupee(n) {
  return '₹' + (parseFloat(n) || 0).toLocaleString('en-IN',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_STYLE = {
  draft:     { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' },
  sent:      { bg: 'rgba(59,130,246,0.15)',  color: '#60a5fa' },
  paid:      { bg: `${G}20`,                  color: G },
  overdue:   { bg: 'rgba(239,68,68,0.15)',   color: '#f87171' },
  cancelled: { bg: 'rgba(100,116,139,0.1)',  color: '#64748b' },
};

// ── Client-side PDF via print window ────────────────────────────────────────
function buildInvoiceHTML(inv, ws) {
  const rows = (inv.line_items || []).map(i => `
    <tr>
      <td>${i.name}</td>
      <td style="text-align:center">${i.qty} ${i.unit||''}</td>
      <td style="text-align:right">${rupee(i.rate)}</td>
      <td style="text-align:center">${i.gst_rate}%</td>
      <td style="text-align:right">${rupee(i.total)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${inv.invoice_number}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:24px}
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
    <div class="biz-name">${ws?.name||'Business'}</div>
    ${ws?.gstin?`<div class="meta">GSTIN: ${ws.gstin}</div>`:''}
    ${ws?.phone?`<div class="meta">📞 ${ws.phone}</div>`:''}
  </div>
  <div>
    <div class="inv-num">${inv.invoice_number}</div>
    <div class="meta" style="text-align:right">Date: ${inv.invoice_date||''}</div>
    ${inv.due_date?`<div class="meta" style="text-align:right">Due: ${inv.due_date}</div>`:''}
    <div style="text-align:right;margin-top:4px"><span class="badge">${inv.status||'draft'}</span></div>
  </div>
</div>
<div class="parties">
  <div class="party">
    <h3>From</h3>
    <strong>${ws?.name||''}</strong>
    ${ws?.gstin?`<p>GSTIN: ${ws.gstin}</p>`:''}
  </div>
  <div class="party">
    <h3>Bill To</h3>
    <strong>${inv.customer_name}</strong>
    ${inv.customer_phone?`<p>📞 ${inv.customer_phone}</p>`:''}
    ${inv.customer_gstin?`<p>GSTIN: ${inv.customer_gstin}</p>`:''}
    ${inv.customer_address?`<p>${inv.customer_address}</p>`:''}
  </div>
</div>
<table>
  <thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:center">GST</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <div class="tot-row"><span>Subtotal</span><span>${rupee(inv.subtotal)}</span></div>
  <div class="tot-row"><span>CGST</span><span>${rupee(inv.cgst)}</span></div>
  <div class="tot-row"><span>SGST</span><span>${rupee(inv.sgst)}</span></div>
  <div class="tot-row tot-final"><span>TOTAL</span><span>${rupee(inv.total_amount)}</span></div>
</div>
${inv.notes?`<div style="clear:both;padding:10px;background:#f9fafb;border-radius:6px;font-size:11px;color:#555;margin-bottom:12px"><strong>Notes:</strong> ${inv.notes}</div>`:''}
<div class="footer">Generated by QuietKeep Business · ${ws?.name||''} · Pranix AI Labs</div>
</body></html>`;
}

function printInvoice(inv, ws) {
  const w = window.open('', '_blank', 'width=820,height=920');
  if (!w) { alert('Allow popups to print / save PDF'); return; }
  w.document.write(buildInvoiceHTML(inv, ws));
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

export default function InvoicesPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [invoices, setInvoices]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [view, setView]           = useState('list'); // list | create | detail
  const [selectedInv, setSelectedInv] = useState(null);
  const [form, setForm]           = useState({
    customer_name:'', customer_phone:'', customer_gstin:'', customer_address:'',
    invoice_type:'sales', invoice_date: new Date().toISOString().split('T')[0],
    due_date:'', notes:'',
  });
  const [items, setItems]   = useState([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');

  function canDo(resource, action) {
    if (!permissions || Object.keys(permissions).length === 0) return true;
    return permissions?.[resource]?.[action] === true;
  }

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
            const { data: ws } = await supabase
              .from('business_workspaces').select('*')
              .eq('owner_user_id', user?.id).maybeSingle();
            if (ws) {
        setWorkspace(ws);
        loadInvoices(ws.id);
        apiGet('/api/business/permissions', accessToken)
          .then(({ data: d }) => { if (d?.permissions) setPermissions(d.permissions); })
          .catch(() => {});
      }
    })();
  }, [user]);

  const loadInvoices = useCallback(async (wsId) => {
    setLoading(true);
    const { data } = await supabase.from('business_invoices').select('*')
      .eq('workspace_id', wsId).order('invoice_date', { ascending: false });
    setInvoices(data || []);
    setLoading(false);
  }, []);

  function calcTotals() {
    const ci       = items.map(calcItem);
    const subtotal = ci.reduce((s, i) => s + i.base, 0);
    const totalGst = ci.reduce((s, i) => s + i.gst,  0);
    return { ci, subtotal, totalGst, total: subtotal + totalGst };
  }

  async function saveInvoice() {
    if (!form.customer_name || !workspace) return;
    if (!canDo('invoices', 'create')) { alert('You do not have permission to create invoices'); return; };
    setSaving(true);
    const { ci, subtotal, totalGst, total } = calcTotals();
    const invNum = `INV-${Date.now().toString(36).toUpperCase()}`;
    const { data } = await supabase.from('business_invoices').insert({
      workspace_id: workspace.id, invoice_number: invNum,
      invoice_type: form.invoice_type,
      customer_name: form.customer_name, customer_phone: form.customer_phone||null,
      customer_gstin: form.customer_gstin||null, customer_address: form.customer_address||null,
      line_items: ci, subtotal, cgst: totalGst/2, sgst: totalGst/2,
      total_gst: totalGst, total_amount: total, amount_paid: 0, amount_due: total,
      invoice_date: form.invoice_date, due_date: form.due_date||null,
      notes: form.notes||null, status: 'draft',
    }).select().single();
    setSaving(false);
    if (data) { setSelectedInv(data); setView('detail'); loadInvoices(workspace.id); }
  }


  async function generatePdf(inv) {
    if (!accessToken) return null;
    setPdfLoading(true);
    const { data, error } = await apiPost('/api/business/invoices/pdf',
      { invoice_id: inv.id }, accessToken);
    setPdfLoading(false);
    if (error || !data?.pdf_url) {
      alert('PDF generation failed: ' + (error || 'Unknown error'));
      return null;
    }
    // Update local invoice state with pdf_url
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, pdf_url: data.pdf_url } : i));
    if (selectedInv?.id === inv.id) setSelectedInv(s => ({ ...s, pdf_url: data.pdf_url }));
    return data.pdf_url;
  }

  async function shareViaWhatsApp(inv) {
    const pdfUrl = inv.pdf_url || (await generatePdf(inv));
    if (!pdfUrl) return;
    const ph = String(inv.customer_phone || '').replace(/[^0-9]/g, '');
    if (!ph) { alert('No customer phone number on this invoice'); return; }
    const prefix = ph.startsWith('91') ? '' : '91';
    const total = '₹' + (parseFloat(inv.total_amount) || 0)
      .toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const lines = [
      '*Invoice ' + inv.invoice_number + '*',
      'Dear ' + (inv.customer_name || 'Customer') + ',',
      '',
      'Your invoice for ' + total + ' is ready.',
      '',
      'View & download: ' + pdfUrl,
      '',
      'From: ' + (workspace?.name || ''),
    ];
    if (workspace?.gstin) lines.push('GSTIN: ' + workspace.gstin);
    lines.push('Due: ' + (inv.due_date || 'on receipt'));
    const msg = lines.join('\n');
    window.open('https://wa.me/' + prefix + ph + '?text=' + encodeURIComponent(msg), '_blank');
  }

  function sendWhatsApp(inv) {
    if (!inv.customer_phone) return;
    const lines = (inv.line_items||[])
      .map(i => `  • ${i.name} ×${i.qty} = ${rupee(i.total)}`).join('\n');
    const msg = `*Invoice ${inv.invoice_number}*\nDear ${inv.customer_name},\n\n${lines}\n\nSubtotal: ${rupee(inv.subtotal)}\nGST: ${rupee(inv.total_gst)}\n*Total: ${rupee(inv.total_amount)}*\n\nFrom: ${workspace?.name}\n${workspace?.gstin?'GSTIN: '+workspace.gstin:''}\nDue: ${inv.due_date||'on receipt'}`;
    const ph = inv.customer_phone.replace(/[^0-9]/g,'');
    window.open(`https://wa.me/${ph.startsWith('91')?'':91}${ph}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  const { ci, subtotal, totalGst, total } = calcTotals();
  const filtered     = invoices.filter(i => filter === 'all' || i.status === filter);
  const totalPending = invoices.filter(i => !['paid','cancelled'].includes(i.status))
    .reduce((s,i) => s + (parseFloat(i.amount_due)||0), 0);

  const inp = {
    width:'100%', background:'var(--surface)', border:'1px solid var(--border)',
    borderRadius:10, padding:'10px 14px', color:'var(--text)', fontSize:14,
    outline:'none', boxSizing:'border-box', fontFamily:'inherit',
  };

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg)',
      paddingTop:56, paddingBottom:'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth:520, margin:'0 auto', padding:'20px 16px' }}>

        {/* ── LIST ── */}
        {view === 'list' && (
          <>
            <div style={{ display:'flex', justifyContent:'space-between',
              alignItems:'flex-start', marginBottom:16 }}>
              <div>
                <div style={{ fontSize:20, fontWeight:800, color:'var(--text)' }}>🧾 Invoices</div>
                <div style={{ fontSize:12, color:'var(--text-subtle)', marginTop:2 }}>
                  GST invoices · PDF + WhatsApp
                </div>
              </div>
              <button onClick={() => {
                setForm({ customer_name:'', customer_phone:'', customer_gstin:'',
                  customer_address:'', invoice_type:'sales',
                  invoice_date: new Date().toISOString().split('T')[0],
                  due_date:'', notes:'' });
                setItems([{ ...EMPTY_ITEM }]);
                setView('create');
              }} style={{ padding:'8px 16px', borderRadius:8, border:'none',
                background:G, color:'#fff', fontSize:13, fontWeight:700,
                cursor:'pointer', fontFamily:'inherit' }}>+ New</button>
            </div>

            {totalPending > 0 && (
              <div style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)',
                borderRadius:12, padding:'12px 16px', marginBottom:12 }}>
                <div style={{ fontSize:20, fontWeight:900, color:'#f59e0b' }}>{rupee(totalPending)}</div>
                <div style={{ fontSize:11, color:'var(--text-subtle)', marginTop:2 }}>Total outstanding</div>
              </div>
            )}

            <div style={{ display:'flex', gap:5, marginBottom:12, overflowX:'auto', paddingBottom:4 }}>
              {['all','draft','sent','paid','overdue'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{ padding:'4px 12px', borderRadius:20, fontSize:11, flexShrink:0,
                    background: filter===f ? `${G}18` : 'transparent',
                    border:`1px solid ${filter===f ? G : 'var(--border)'}`,
                    color: filter===f ? G : 'var(--text-muted)',
                    cursor:'pointer', fontFamily:'inherit', textTransform:'capitalize' }}>
                  {f}
                </button>
              ))}
            </div>

            {loading ? (
              <div style={{ display:'flex', justifyContent:'center', padding:40 }}>
                <div className="qk-spinner" />
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign:'center', padding:'48px 20px' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🧾</div>
                <div style={{ fontSize:15, fontWeight:700, color:'var(--text)', marginBottom:6 }}>
                  No invoices yet
                </div>
                <div style={{ fontSize:13, color:'var(--text-muted)' }}>
                  Create your first GST invoice
                </div>
              </div>
            ) : filtered.map(inv => {
              const ss = STATUS_STYLE[inv.status]||STATUS_STYLE.draft;
              return (
                <div key={inv.id}
                  onClick={() => { setSelectedInv(inv); setView('detail'); }}
                  style={{ background:'var(--surface)', border:'1px solid var(--border)',
                    borderRadius:12, padding:'13px 14px', marginBottom:8, cursor:'pointer' }}>
                  <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>
                        {inv.customer_name}
                      </div>
                      <div style={{ fontSize:11, color:'var(--text-subtle)' }}>
                        {inv.invoice_number} · {inv.invoice_date}
                      </div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:15, fontWeight:800, color:'var(--text)' }}>
                        {rupee(inv.total_amount)}
                      </div>
                      <span style={{ fontSize:8, fontWeight:700, padding:'2px 7px', borderRadius:999,
                        ...ss, border:`1px solid ${ss.color}30`,
                        textTransform:'uppercase', letterSpacing:'0.06em' }}>
                        {inv.status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ── CREATE ── */}
        {view === 'create' && (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
              <button onClick={() => setView('list')}
                style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--border)',
                  background:'transparent', color:'var(--text-muted)', fontSize:13,
                  cursor:'pointer', fontFamily:'inherit' }}>← Back</button>
              <div style={{ fontSize:18, fontWeight:800, color:'var(--text)' }}>New Invoice</div>
            </div>

            {/* Customer */}
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:14, padding:16, marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-subtle)',
                textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>
                Customer Details
              </div>
              {[
                { label:'Customer Name *',     key:'customer_name',    type:'text',  ph:'Raju Enterprises' },
                { label:'Phone (for WhatsApp)',key:'customer_phone',   type:'tel',   ph:'98765 43210' },
                { label:'GSTIN (optional)',     key:'customer_gstin',   type:'text',  ph:'29AABCU...' },
                { label:'Address',             key:'customer_address', type:'text',  ph:'Customer address' },
              ].map(f => (
                <div key={f.key} style={{ marginBottom:10 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                    display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    {f.label}
                  </label>
                  <input type={f.type} value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.ph} style={inp} />
                </div>
              ))}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                    display:'block', marginBottom:4 }}>INVOICE DATE</label>
                  <input type="date" value={form.invoice_date}
                    onChange={e => setForm(p=>({...p,invoice_date:e.target.value}))} style={inp} />
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                    display:'block', marginBottom:4 }}>DUE DATE</label>
                  <input type="date" value={form.due_date}
                    onChange={e => setForm(p=>({...p,due_date:e.target.value}))} style={inp} />
                </div>
              </div>
            </div>

            {/* Line items */}
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:14, padding:16, marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-subtle)',
                textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>
                Line Items
              </div>
              {items.map((item, idx) => (
                <div key={idx} style={{ background:'rgba(255,255,255,0.03)',
                  border:'1px solid var(--border)', borderRadius:10,
                  padding:'10px 12px', marginBottom:8 }}>
                  <input value={item.name}
                    onChange={e => { const a=[...items]; a[idx]={...a[idx],name:e.target.value}; setItems(a); }}
                    placeholder="Item name / description"
                    style={{ ...inp, marginBottom:8, fontSize:13 }} />
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:6, alignItems:'end' }}>
                    {[
                      { label:'QTY',     key:'qty',      type:'number' },
                      { label:'RATE (₹)',key:'rate',     type:'number' },
                    ].map(f => (
                      <div key={f.key}>
                        <label style={{ fontSize:9, color:'var(--text-subtle)', display:'block', marginBottom:3 }}>
                          {f.label}
                        </label>
                        <input type={f.type} value={item[f.key]}
                          onChange={e => { const a=[...items]; a[idx]={...a[idx],[f.key]:e.target.value}; setItems(a); }}
                          style={{ ...inp, fontSize:12 }} />
                      </div>
                    ))}
                    <div>
                      <label style={{ fontSize:9, color:'var(--text-subtle)', display:'block', marginBottom:3 }}>
                        GST%
                      </label>
                      <select value={item.gst_rate}
                        onChange={e => { const a=[...items]; a[idx]={...a[idx],gst_rate:e.target.value}; setItems(a); }}
                        style={{ ...inp, fontSize:12 }}>
                        {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </div>
                    <div style={{ fontSize:13, fontWeight:700, color:G, paddingBottom:8, whiteSpace:'nowrap' }}>
                      {rupee(calcItem(item).total)}
                    </div>
                  </div>
                  {items.length > 1 && (
                    <button onClick={() => setItems(items.filter((_,i)=>i!==idx))}
                      style={{ background:'none', border:'none', color:'#ef4444',
                        fontSize:11, cursor:'pointer', marginTop:4, fontFamily:'inherit' }}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button onClick={() => setItems([...items, { ...EMPTY_ITEM }])}
                style={{ width:'100%', padding:'8px', borderRadius:8,
                  border:'1px dashed var(--border)', background:'transparent',
                  color:'var(--text-muted)', fontSize:12, cursor:'pointer',
                  fontFamily:'inherit', marginBottom:12 }}>+ Add item</button>

              {/* Totals summary */}
              <div style={{ borderTop:'1px solid var(--border)', paddingTop:12 }}>
                {[['Subtotal',subtotal,false],['CGST',totalGst/2,false],
                  ['SGST',totalGst/2,false],['Total',total,true]].map(([l,v,big]) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between',
                    fontSize: big?16:13, fontWeight: big?800:500,
                    color: big?G:'var(--text-muted)', marginBottom:4,
                    borderTop: big?`2px solid ${G}`:'none',
                    paddingTop: big?8:0, marginTop: big?4:0 }}>
                    <span>{l}</span><span>{rupee(v)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                display:'block', marginBottom:4 }}>NOTES (optional)</label>
              <textarea value={form.notes} rows={2}
                onChange={e => setForm(p=>({...p,notes:e.target.value}))}
                placeholder="Payment terms, bank account details…"
                style={{ ...inp, resize:'vertical', lineHeight:1.5 }} />
            </div>

            <div style={{ display:'flex', gap:8 }}>
              <button onClick={saveInvoice} disabled={saving||!form.customer_name}
                style={{ flex:2, padding:'14px', borderRadius:12, border:'none',
                  background: form.customer_name ? G : 'var(--surface-hover)',
                  color: form.customer_name ? '#fff' : 'var(--text-subtle)',
                  fontSize:15, fontWeight:700,
                  cursor: form.customer_name ? 'pointer' : 'not-allowed',
                  fontFamily:'inherit' }}>
                {saving ? 'Creating…' : '✓ Create Invoice'}
              </button>
              <button onClick={() => setView('list')}
                style={{ flex:1, padding:'14px', borderRadius:12,
                  border:'1px solid var(--border)', background:'transparent',
                  color:'var(--text-muted)', fontSize:14, cursor:'pointer',
                  fontFamily:'inherit' }}>Cancel</button>
            </div>
          </>
        )}

        {/* ── DETAIL ── */}
        {view === 'detail' && selectedInv && (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
              <button onClick={() => setView('list')}
                style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--border)',
                  background:'transparent', color:'var(--text-muted)', fontSize:13,
                  cursor:'pointer', fontFamily:'inherit' }}>← Back</button>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:16, fontWeight:800, color:'var(--text)' }}>
                  {selectedInv.invoice_number}
                </div>
              </div>
              {(() => { const ss = STATUS_STYLE[selectedInv.status]||STATUS_STYLE.draft; return (
                <span style={{ fontSize:9, fontWeight:700, padding:'3px 9px', borderRadius:999,
                  ...ss, border:`1px solid ${ss.color}30`, textTransform:'uppercase' }}>
                  {selectedInv.status}
                </span>
              );})()}
            </div>

            {/* Invoice card */}
            <div style={{ background:'var(--surface)', border:`2px solid ${G}30`,
              borderRadius:16, padding:18, marginBottom:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:9, fontWeight:700, color:'var(--text-subtle)',
                    textTransform:'uppercase', marginBottom:4 }}>FROM</div>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{workspace?.name}</div>
                  {workspace?.gstin && (
                    <div style={{ fontSize:10, color:'var(--text-subtle)' }}>GSTIN: {workspace.gstin}</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize:9, fontWeight:700, color:'var(--text-subtle)',
                    textTransform:'uppercase', marginBottom:4 }}>BILL TO</div>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>
                    {selectedInv.customer_name}
                  </div>
                  {selectedInv.customer_phone && (
                    <div style={{ fontSize:10, color:'var(--text-subtle)' }}>📞 {selectedInv.customer_phone}</div>
                  )}
                  {selectedInv.customer_gstin && (
                    <div style={{ fontSize:10, color:'var(--text-subtle)' }}>GSTIN: {selectedInv.customer_gstin}</div>
                  )}
                </div>
              </div>

              {/* Items */}
              <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginBottom:12 }}>
                {(selectedInv.line_items||[]).map((item,i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between',
                    fontSize:12, padding:'5px 0',
                    borderBottom: i < selectedInv.line_items.length-1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ color:'var(--text)' }}>
                      {item.name} <span style={{ color:'var(--text-subtle)' }}>×{item.qty}</span>
                    </span>
                    <span style={{ fontWeight:600, color:'var(--text)' }}>{rupee(item.total)}</span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div style={{ background:'rgba(255,255,255,0.03)', borderRadius:10, padding:'10px 12px' }}>
                {[['Subtotal',selectedInv.subtotal],['CGST',selectedInv.cgst],['SGST',selectedInv.sgst]].map(([l,v]) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between',
                    fontSize:12, color:'var(--text-muted)', marginBottom:4 }}>
                    <span>{l}</span><span>{rupee(v)}</span>
                  </div>
                ))}
                <div style={{ display:'flex', justifyContent:'space-between',
                  fontSize:18, fontWeight:900, color:G,
                  borderTop:`2px solid ${G}`, paddingTop:7, marginTop:4 }}>
                  <span>Total</span><span>{rupee(selectedInv.total_amount)}</span>
                </div>
              </div>

              {selectedInv.notes && (
                <div style={{ marginTop:10, fontSize:11, color:'var(--text-muted)', fontStyle:'italic' }}>
                  Note: {selectedInv.notes}
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display:'flex', gap:8, marginBottom:10 }}>
              <button onClick={() => printInvoice(selectedInv, workspace)}
                style={{ flex:1, padding:'12px 8px', borderRadius:10,
                  border:'1px solid var(--border)', background:'var(--surface)',
                  color:'var(--text)', fontSize:13, fontWeight:600,
                  cursor:'pointer', fontFamily:'inherit',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                🖨️ Print / PDF
              </button>
              {selectedInv.pdf_url && (
                <a href={selectedInv.pdf_url} target="_blank" rel="noopener noreferrer"
                  style={{ display:'block', textAlign:'center', padding:'8px', borderRadius:8,
                    background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.2)',
                    color:'#6ee7b7', fontSize:12, textDecoration:'none', marginBottom:6 }}>
                  🔗 PDF link active — tap to open
                </a>
              )}
              <button
                onClick={() => generatePdf(selectedInv)}
                disabled={pdfLoading}
                style={{ flex:1, padding:'10px 0', borderRadius:10, border:'none',
                  background: pdfLoading ? 'rgba(16,185,129,0.1)' : '#10b981',
                  color: pdfLoading ? '#6ee7b7' : '#fff',
                  fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                {pdfLoading ? '⏳ Generating…' : (selectedInv.pdf_url ? '🔄 Refresh PDF' : '📄 Generate PDF')}
              </button>
              <button onClick={() => shareViaWhatsApp(selectedInv)}
                disabled={!selectedInv.customer_phone}
                style={{ flex:1, padding:'12px 8px', borderRadius:10,
                  border:'1px solid rgba(37,211,102,0.3)',
                  background:'rgba(37,211,102,0.08)', color:'#25D366',
                  fontSize:13, fontWeight:600,
                  cursor: selectedInv.customer_phone ? 'pointer' : 'not-allowed',
                  fontFamily:'inherit', opacity: selectedInv.customer_phone ? 1 : 0.4,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                📲 WhatsApp
              </button>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              {selectedInv.status !== 'paid' && (
                <button onClick={async () => {
                  await supabase.from('business_invoices').update({
                    status:'paid', amount_paid:selectedInv.total_amount, amount_due:0,
                  }).eq('id', selectedInv.id);
                  setSelectedInv({ ...selectedInv, status:'paid' });
                  loadInvoices(workspace.id);
                }} style={{ flex:1, padding:'12px', borderRadius:10, border:'none',
                  background:G, color:'#fff', fontSize:13, fontWeight:700,
                  cursor:'pointer', fontFamily:'inherit' }}>
                  ✓ Mark Paid
                </button>
              )}
              {selectedInv.status === 'draft' && (
                <button onClick={async () => {
                  await supabase.from('business_invoices').update({ status:'sent' }).eq('id', selectedInv.id);
                  setSelectedInv({ ...selectedInv, status:'sent' });
                  loadInvoices(workspace.id);
                }} style={{ flex:1, padding:'12px', borderRadius:10,
                  border:'1px solid rgba(59,130,246,0.3)', background:'rgba(59,130,246,0.08)',
                  color:'#60a5fa', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                  → Mark Sent
                </button>
              )}
              <button onClick={async () => {
                if (!confirm('Cancel this invoice?')) return;
                await supabase.from('business_invoices').update({ status:'cancelled' }).eq('id', selectedInv.id);
                setView('list'); loadInvoices(workspace.id);
              }} style={{ width:42, padding:'12px', borderRadius:10,
                border:'1px solid rgba(239,68,68,0.2)', background:'rgba(239,68,68,0.06)',
                color:'#ef4444', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                ✕
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
