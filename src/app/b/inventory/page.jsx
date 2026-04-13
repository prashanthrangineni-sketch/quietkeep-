'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';
const G = '#10b981';
const UNITS = ['pcs','kg','litre','box','metre','dozen','bag','bottle','sheet','roll'];

export default function InventoryPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name:'', category:'', unit:'pcs', current_stock:'0', min_stock_alert:'5', purchase_price:'', selling_price:'', supplier_name:'', supplier_phone:'', location:'', gst_rate:'18', expiry_date:'', manufacture_date:'', batch_number:'' });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [stockAdj, setStockAdj] = useState({});

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
            const { data: ws } = await supabase.from('business_workspaces').select('id').eq('owner_user_id', user?.id).maybeSingle();
            if (ws) { setWorkspace(ws); loadItems(ws.id); }
    })();
  }, [user]);

  const loadItems = useCallback(async (wsId) => {
    setLoading(true);
    const { data } = await supabase.from('inventory_items').select('*').eq('workspace_id', wsId).order('name');
    setItems(data || []);
    setLoading(false);
  }, []);

  async function saveItem() {
    if (!form.name || !workspace) return;
    setSaving(true);
    const payload = { ...form, workspace_id: workspace.id, current_stock: parseFloat(form.current_stock)||0, min_stock_alert: parseFloat(form.min_stock_alert)||5, purchase_price: parseFloat(form.purchase_price)||null, selling_price: parseFloat(form.selling_price)||null, gst_rate: parseFloat(form.gst_rate)||18 };
    if (editId) await supabase.from('inventory_items').update(payload).eq('id', editId);
    else await supabase.from('inventory_items').insert(payload);
    setSaving(false); setShowForm(false); setEditId(null);
    setForm({ name:'', category:'', unit:'pcs', current_stock:'0', min_stock_alert:'5', purchase_price:'', selling_price:'', supplier_name:'', supplier_phone:'', location:'', gst_rate:'18', expiry_date:'', manufacture_date:'', batch_number:'' });
    loadItems(workspace.id);
  }

  async function adjustStock(id, delta) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const newStock = Math.max(0, parseFloat(item.current_stock) + delta);
    await supabase.from('inventory_items').update({ current_stock: newStock }).eq('id', id);
    setItems(prev => prev.map(i => i.id === id ? { ...i, current_stock: newStock } : i));
  }


  async function deleteItem(id, name) {
    if (!window.confirm(`Delete "${name}" from inventory?`)) return;
    await supabase.from('inventory_items').delete().eq('id', id);
    setItems(prev => prev.filter(i => i.id !== id));
  }

  const lowStock = items.filter(i => parseFloat(i.current_stock) <= parseFloat(i.min_stock_alert));
  const filtered = filter === 'low' ? lowStock : filter === 'out' ? items.filter(i => parseFloat(i.current_stock) === 0) : items;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div><h1 className="qk-h1">📦 Inventory</h1><p className="qk-desc">Stock tracking with low-stock alerts</p></div>
          <button onClick={() => { setShowForm(!showForm); setEditId(null); }} className="qk-btn qk-btn-primary qk-btn-sm">+ Add</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'Total items', value: items.length, color: 'var(--primary)', f: 'all' },
            { label: 'Low stock', value: lowStock.length, color: '#f59e0b', f: 'low' },
            { label: 'Out of stock', value: items.filter(i => parseFloat(i.current_stock)===0).length, color: '#ef4444', f: 'out' },
          ].map(s => (
            <div key={s.f} className="qk-card" style={{ padding: '12px', textAlign: 'center', cursor: 'pointer', borderColor: filter === s.f ? s.color : 'var(--border)' }} onClick={() => setFilter(s.f)}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="qk-card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'Item name *', key: 'name', type: 'text', ph: 'e.g. Parle-G', full: true },
                { label: 'Category', key: 'category', type: 'text', ph: 'Biscuits' },
                { label: 'Current stock', key: 'current_stock', type: 'number', ph: '0' },
                { label: 'Alert below', key: 'min_stock_alert', type: 'number', ph: '5' },
                { label: 'Buy price (₹)', key: 'purchase_price', type: 'number', ph: '0' },
                { label: 'Sell price (₹)', key: 'selling_price', type: 'number', ph: '0' },
                { label: 'Supplier', key: 'supplier_name', type: 'text', ph: 'Supplier name' },
                { label: 'Supplier phone', key: 'supplier_phone', type: 'tel', ph: '98765...' },
                { label: 'Expiry Date', key: 'expiry_date', type: 'date', ph: '' },
                { label: 'Manufacture Date', key: 'manufacture_date', type: 'date', ph: '' },
                { label: 'Batch / Lot Number', key: 'batch_number', type: 'text', ph: 'e.g. BTH2024A' },
              ].map(f => (
                <div key={f.key} style={{ gridColumn: f.full ? '1/-1' : undefined }}>
                  <label className="qk-lbl">{f.label}</label>
                  <input type={f.type} value={form[f.key]} onChange={e => setForm(p => ({...p, [f.key]: e.target.value}))} placeholder={f.ph} className="qk-input" style={{ marginTop: 4 }} />
                </div>
              ))}
              <div>
                <label className="qk-lbl">Unit</label>
                <select value={form.unit} onChange={e => setForm(p => ({...p, unit: e.target.value}))} className="qk-input" style={{ marginTop: 4 }}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="qk-lbl">GST %</label>
                <select value={form.gst_rate} onChange={e => setForm(p => ({...p, gst_rate: e.target.value}))} className="qk-input" style={{ marginTop: 4 }}>
                  {[0,5,12,18,28].map(r => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={saveItem} disabled={saving} className="qk-btn qk-btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{saving ? 'Saving...' : editId ? '✓ Update' : '+ Add Item'}</button>
              <button onClick={() => setShowForm(false)} className="qk-btn qk-btn-ghost">Cancel</button>
            </div>
          </div>
        )}

        {loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="qk-spinner" /></div>
        : filtered.length === 0 ? (
          <div className="qk-empty"><div className="qk-empty-icon">📦</div><div className="qk-empty-title">No inventory items</div><div className="qk-empty-sub">Add products to track stock levels</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(item => {
              const stock = parseFloat(item.current_stock);
              const alert = parseFloat(item.min_stock_alert);
              const isLow = stock <= alert;
              const isOut = stock === 0;
              const expiryDays = item.expiry_date
                ? Math.floor((new Date(item.expiry_date) - Date.now()) / 86400000)
                : null;
              const isExpired = expiryDays !== null && expiryDays < 0;
              const isExpiringSoon = expiryDays !== null && expiryDays >= 0 && expiryDays <= 30;
              return (
                <div key={item.id} className="qk-card" style={{ padding: '13px 14px', borderLeft: `3px solid ${isOut ? '#ef4444' : isLow ? '#f59e0b' : G}` }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{item.name}</span>
                        {isOut && <span className="qk-badge qk-badge-red">Out</span>}
                        {isLow && !isOut && <span className="qk-badge qk-badge-amber">Low</span>}
                        {isExpired && <span className="qk-badge qk-badge-red">Expired</span>}
                        {isExpiringSoon && !isExpired && <span className="qk-badge qk-badge-amber">Exp {expiryDays}d</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                        {item.category && `${item.category} · `}
                        Buy ₹{item.purchase_price||'—'} · Sell ₹{item.selling_price||'—'}
                        {item.supplier_name && ` · ${item.supplier_name}`}
                        {item.batch_number && ` · Batch: ${item.batch_number}`}
                        {item.expiry_date && <span style={{ color: isExpired ? '#ef4444' : isExpiringSoon ? '#f59e0b' : 'inherit', marginLeft: 4 }}>· Exp: {item.expiry_date}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <button onClick={() => adjustStock(item.id, -1)} style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--surface-hover)', cursor: 'pointer', fontSize: 14 }}>−</button>
                      <div style={{ textAlign: 'center', minWidth: 40 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: isOut ? '#ef4444' : isLow ? '#f59e0b' : G }}>{stock}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-subtle)' }}>{item.unit}</div>
                      </div>
                      <button onClick={() => adjustStock(item.id, 1)} style={{ width: 26, height: 26, borderRadius: '50%', border: `1px solid ${G}40`, background: `${G}15`, cursor: 'pointer', fontSize: 14, color: G }}>+</button>
                    </div>
                  </div>
                  {item.supplier_phone && isLow && (
                    <div style={{ marginTop: 8 }}>
                      <a href={'https://wa.me/' + item.supplier_phone.replace(/[^0-9]/g,'') + '?text=' + encodeURIComponent('Hi, we need to reorder ' + item.name + '. Current stock: ' + stock + ' ' + item.unit + '. Please confirm availability and delivery date.')} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#25D366', textDecoration: 'none', fontWeight: 600 }}>
                        WhatsApp supplier for reorder
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
