'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const CATEGORIES = ['All', 'Identity', 'Finance', 'Health', 'Property', 'Legal', 'Insurance', 'Vehicle'];

const CAT_COLORS = {
  Identity: '#6366f1', Finance: '#f59e0b', Health: '#ef4444',
  Property: '#10b981', Legal: '#8b5cf6', Insurance: '#3b82f6', Vehicle: '#f97316',
};

const CAT_ICONS = {
  Identity: '\u{1F4F1}', Finance: '\u{1F4B0}', Health: '\u{1F3E5}',
  Property: '\u{1F3E0}', Legal: '\u{2696}\u{FE0F}', Insurance: '\u{1F6E1}\u{FE0F}', Vehicle: '\u{1F697}',
};

function daysUntil(dateStr) {
  if (!dateStr) { return null; }
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function Documents() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [newDoc, setNewDoc] = useState({ title: '', category: 'Identity', doc_number: '', issued_by: '', issue_date: '', expiry_date: '', notes: '' });

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2800);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      await loadDocs(session.user.id);
      setLoading(false);
    });
  }, [router]);

  async function loadDocs(uid) {
    const { data } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (data) { setDocs(data); }
  }

  async function handleAddDoc() {
    if (!newDoc.title.trim() || !user) { return; }
    setSaving(true);
    const { error } = await supabase.from('documents').insert([{
      user_id: user.id,
      title: newDoc.title.trim(),
      category: newDoc.category,
      doc_number: newDoc.doc_number || null,
      issued_by: newDoc.issued_by || null,
      issue_date: newDoc.issue_date || null,
      expiry_date: newDoc.expiry_date || null,
      notes: newDoc.notes || null,
    }]);
    if (!error) {
      await loadDocs(user.id);
      setShowAddForm(false);
      setNewDoc({ title: '', category: 'Identity', doc_number: '', issued_by: '', issue_date: '', expiry_date: '', notes: '' });
      showToast('Document added');
    }
    setSaving(false);
  }

  async function handleDelete(id) {
    await supabase.from('documents').delete().eq('id', id);
    setDocs(prev => prev.filter(d => d.id !== id));
    showToast('Deleted');
  }

  const filtered = docs.filter(d => {
    const matchCat = activeCategory === 'All' || d.category === activeCategory;
    const matchSearch = !searchQuery.trim() ||
      d.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.doc_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.issued_by?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  const expiringSoon = docs.filter(d => {
    const days = daysUntil(d.expiry_date);
    return days !== null && days >= 0 && days <= 90;
  }).sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));

  const card = { backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '12px' };
  const inp = { width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '10px 12px', color: '#f1f5f9', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
        <div style={{ width: '36px', height: '36px', border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ color: '#475569', fontSize: '13px' }}>Loading documents...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '70px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1e1e2e', border: '1px solid #6366f1', borderRadius: '10px', padding: '10px 20px', color: '#f1f5f9', fontSize: '14px', zIndex: 9999, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      <div style={{ borderBottom: '1px solid #1e1e2e', padding: '10px 16px', backgroundColor: 'rgba(10,10,15,0.98)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: '700', fontSize: '14px', color: '#6366f1' }}>Documents Vault</span>
        <a href="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '12px' }}>&larr; Dashboard</a>
      </div>

      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '20px 16px' }}>

        {expiringSoon.length > 0 && (
          <div style={{ ...card, border: '1px solid rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.04)', marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#ef4444', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Expiring Soon</div>
            {expiringSoon.slice(0, 3).map((d, i) => {
              const days = daysUntil(d.expiry_date);
              return (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: i < Math.min(expiringSoon.length, 3) - 1 ? '1px solid rgba(239,68,68,0.1)' : 'none' }}>
                  <span style={{ fontSize: '18px' }}>{CAT_ICONS[d.category] || '\u{1F4C4}'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{d.title}</div>
                    <div style={{ fontSize: '11px', color: days <= 30 ? '#ef4444' : '#f59e0b' }}>
                      {days === 0 ? 'Expires today' : days < 0 ? 'Expired ' + Math.abs(days) + ' days ago' : 'Expires in ' + days + ' days'}
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', backgroundColor: days <= 30 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)', color: days <= 30 ? '#ef4444' : '#f59e0b', border: '1px solid ' + (days <= 30 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'), fontWeight: '700' }}>
                    {days <= 0 ? 'Expired' : days + 'd'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
          {[
            { label: 'Total', value: docs.length, color: '#6366f1' },
            { label: 'Expiring', value: expiringSoon.length, color: '#f59e0b' },
            { label: 'Categories', value: [...new Set(docs.map(d => d.category))].length, color: '#10b981' },
          ].map((s, i) => (
            <div key={i} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: '12px', position: 'relative' }}>
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search documents..." style={{ ...inp, paddingRight: searchQuery ? '36px' : '12px' }} />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '16px' }}>&times;</button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px', marginBottom: '16px' }}>
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)} style={{ flexShrink: 0, padding: '6px 14px', borderRadius: '20px', border: '1px solid ' + (activeCategory === cat ? (CAT_COLORS[cat] || '#6366f1') : '#1e293b'), backgroundColor: activeCategory === cat ? (CAT_COLORS[cat] || '#6366f1') + '18' : 'transparent', color: activeCategory === cat ? (CAT_COLORS[cat] || '#a5b4fc') : '#64748b', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {cat}
            </button>
          ))}
        </div>

        <button onClick={() => setShowAddForm(v => !v)} style={{ width: '100%', marginBottom: '16px', backgroundColor: showAddForm ? 'transparent' : 'rgba(99,102,241,0.1)', border: '1px solid ' + (showAddForm ? '#1e293b' : 'rgba(99,102,241,0.4)'), color: showAddForm ? '#64748b' : '#a5b4fc', padding: '10px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
          {showAddForm ? 'Cancel' : '+ Add Document'}
        </button>

        {showAddForm && (
          <div style={{ ...card, border: '1px solid #6366f150', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>New Document</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input placeholder="Document title *" value={newDoc.title} onChange={e => setNewDoc(d => ({ ...d, title: e.target.value }))} style={inp} />
              <select value={newDoc.category} onChange={e => setNewDoc(d => ({ ...d, category: e.target.value }))} style={inp}>
                {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="Document number / ID" value={newDoc.doc_number} onChange={e => setNewDoc(d => ({ ...d, doc_number: e.target.value }))} style={inp} />
              <input placeholder="Issued by (e.g. UIDAI, RTO)" value={newDoc.issued_by} onChange={e => setNewDoc(d => ({ ...d, issued_by: e.target.value }))} style={inp} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '4px' }}>Issue Date</label>
                  <input type="date" value={newDoc.issue_date} onChange={e => setNewDoc(d => ({ ...d, issue_date: e.target.value }))} style={inp} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '4px' }}>Expiry Date</label>
                  <input type="date" value={newDoc.expiry_date} onChange={e => setNewDoc(d => ({ ...d, expiry_date: e.target.value }))} style={inp} />
                </div>
              </div>
              <input placeholder="Notes (optional)" value={newDoc.notes} onChange={e => setNewDoc(d => ({ ...d, notes: e.target.value }))} style={inp} />
              <button onClick={handleAddDoc} disabled={saving || !newDoc.title.trim()} style={{ backgroundColor: saving || !newDoc.title.trim() ? '#1a1a2e' : '#6366f1', color: saving || !newDoc.title.trim() ? '#334155' : '#fff', border: 'none', padding: '11px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: saving || !newDoc.title.trim() ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save Document'}
              </button>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', border: '1px dashed #1e293b', borderRadius: '14px' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>{'\u{1F4C2}'}</div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#64748b', marginBottom: '6px' }}>
              {searchQuery ? 'No documents matching "' + searchQuery + '"' : 'No ' + (activeCategory === 'All' ? '' : activeCategory + ' ') + 'documents yet'}
            </div>
            <div style={{ fontSize: '12px', color: '#334155' }}>Tap + Add Document to get started</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filtered.map(doc => {
              const days = daysUntil(doc.expiry_date);
              const isExpired = days !== null && days < 0;
              const isExpiringSoon = days !== null && days >= 0 && days <= 90;
              const catColor = CAT_COLORS[doc.category] || '#6366f1';
              return <DocCard key={doc.id} doc={doc} days={days} isExpired={isExpired} isExpiringSoon={isExpiringSoon} catColor={catColor} onDelete={handleDelete} />;
            })}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function DocCard({ doc, days, isExpired, isExpiringSoon, catColor, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ backgroundColor: '#0f0f1a', border: '1px solid ' + (isExpired ? 'rgba(239,68,68,0.3)' : isExpiringSoon ? 'rgba(245,158,11,0.2)' : '#1e1e2e'), borderRadius: '12px', padding: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: catColor + '15', border: '1px solid ' + catColor + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '18px' }}>
          {CAT_ICONS[doc.category] || '\u{1F4C4}'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9' }}>{doc.title}</span>
            {(isExpired || isExpiringSoon) && (
              <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '10px', backgroundColor: isExpired ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)', color: isExpired ? '#ef4444' : '#f59e0b', border: '1px solid ' + (isExpired ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'), fontWeight: '700', whiteSpace: 'nowrap' }}>
                {isExpired ? 'Expired' : days + 'd left'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '10px', backgroundColor: catColor + '15', color: catColor, fontWeight: '600' }}>{doc.category}</span>
            {doc.doc_number && <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'monospace' }}>{doc.doc_number}</span>}
            {doc.issued_by && <span style={{ fontSize: '11px', color: '#475569' }}>{doc.issued_by}</span>}
          </div>
        </div>
        <button onClick={() => setExpanded(e => !e)} style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', fontSize: '14px', padding: '2px 6px' }}>
          {expanded ? '\u{25B2}' : '\u{25BC}'}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #1a1a2e' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            {doc.issue_date && (
              <div>
                <div style={{ fontSize: '10px', color: '#475569', marginBottom: '2px' }}>Issued</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>{new Date(doc.issue_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
            )}
            {doc.expiry_date && (
              <div>
                <div style={{ fontSize: '10px', color: '#475569', marginBottom: '2px' }}>Expires</div>
                <div style={{ fontSize: '12px', color: isExpired ? '#ef4444' : isExpiringSoon ? '#f59e0b' : '#94a3b8' }}>
                  {new Date(doc.expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
            )}
          </div>
          {doc.notes && <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px', padding: '8px', backgroundColor: '#0a0a0f', borderRadius: '6px' }}>{doc.notes}</div>}
          <button onClick={() => onDelete(doc.id)} style={{ backgroundColor: 'transparent', border: '1px solid #2d1515', color: '#ef4444', padding: '5px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Delete</button>
        </div>
      )}
    </div>
  );
}
