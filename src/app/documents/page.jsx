'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const CATEGORIES = [
  { name: 'Passport', emoji: '🛂', color: '#6366f1' },
  { name: 'Vaccination', emoji: '💉', color: '#10b981' },
  { name: 'Insurance', emoji: '🛡️', color: '#f59e0b' },
  { name: 'License', emoji: '📜', color: '#8b5cf6' },
  { name: 'Property', emoji: '🏠', color: '#ef4444' },
  { name: 'Financial', emoji: '💳', color: '#14b8a6' },
  { name: 'Medical', emoji: '⚕️', color: '#3b82f6' },
  { name: 'Other', emoji: '📋', color: '#64748b' },
];

export default function Documents() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', category: 'Other', expiry_date: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      const { data } = await supabase.from('documents').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
      setDocuments(data || []);
      setLoading(false);
    });
  }, [router]);

  const handleAddDocument = async () => {
    if (!formData.name.trim()) { alert('Name required'); return; }
    setSaving(true);
    const { data, error } = await supabase.from('documents').insert({
      user_id: user.id,
      name: formData.name,
      category: formData.category,
      expiry_date: formData.expiry_date || null,
    }).select().single();
    if (!error) {
      setDocuments([data, ...documents]);
      setFormData({ name: '', category: 'Other', expiry_date: '' });
      setShowForm(false);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    await supabase.from('documents').delete().eq('id', id);
    setDocuments(documents.filter(d => d.id !== id));
  };

  const getDaysUntilExpiry = (expiryDate) => {
    if (!expiryDate) return null;
    const expiry = new Date(expiryDate);
    const today = new Date();
    const diff = Math.floor((expiry - today) / (1000 * 60 * 60 * 24));
    return diff;
  };

  if (loading) {
    return (
      <>
        <NavbarClient />
        <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '24px' }}>Loading...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '24px 16px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{ marginBottom: '32px' }}>
            <h1 style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 8px' }}>📄 Documents</h1>
            <div style={{ fontSize: '14px', color: '#94a3b8' }}>Track important documents</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            {CATEGORIES.map((cat) => (
              <button key={cat.name} onClick={() => setFormData({ ...formData, category: cat.name })} style={{ backgroundColor: formData.category === cat.name ? cat.color : '#1e1e2e', border: '1px solid #334155', color: '#f1f5f9', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                {cat.emoji} {cat.name}
              </button>
            ))}
          </div>

          {documents.length > 0 && (
            <div style={{ display: 'grid', gap: '12px', marginBottom: '24px' }}>
              {documents.map((doc) => {
                const days = getDaysUntilExpiry(doc.expiry_date);
                const isExpired = days !== null && days < 0;
                const isExpiringSoon = days !== null && days >= 0 && days <= 30;
                const catColor = CATEGORIES.find(c => c.name === doc.category)?.color || '#64748b';
                return (
                  <DocCard key={doc.id} doc={doc} days={days} isExpired={isExpired} isExpiringSoon={isExpiringSoon} catColor={catColor} onDelete={() => handleDelete(doc.id)} />
                );
              })}
            </div>
          )}

          <button onClick={() => setShowForm(!showForm)} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            + Add Document
          </button>

          {showForm && (
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginTop: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9', margin: '0 0 16px' }}>Add Document</h3>
              <input type="text" placeholder="Document name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box' }} />
              <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box' }}>
                {CATEGORIES.map(c => <option key={c.name}>{c.name}</option>)}
              </select>
              <input type="date" value={formData.expiry_date} onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleAddDocument} disabled={saving} style={{ flex: 1, backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setShowForm(false)} style={{ flex: 1, backgroundColor: '#1a1a2e', color: '#94a3b8', border: '1px solid #334155', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

function DocCard({ doc, days, isExpired, isExpiringSoon, catColor, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ backgroundColor: '#0f0f1a', border: '1px solid ' + (isExpired ? 'rgba(239,68,68,0.3)' : isExpiringSoon ? 'rgba(245,158,11,0.2)' : '#1e1e2e'), borderRadius: '12px', padding: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ fontSize: '24px', width: '30px' }}>📄</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{doc.name}</div>
          <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{doc.category}</div>
          {doc.expiry_date && <div style={{ fontSize: '11px', color: isExpired ? '#ef4444' : isExpiringSoon ? '#f59e0b' : '#10b981', marginTop: '4px', fontWeight: '600' }}>
            {isExpired ? '❌ Expired' : isExpiringSoon ? '⚠️ Expiring in ' + days + ' days' : '✅ Valid for ' + days + ' days'}
          </div>}
        </div>
        <button onClick={onDelete} style={{ backgroundColor: 'transparent', border: 'none', color: '#ef4444', fontSize: '18px', cursor: 'pointer', padding: '0' }}>×</button>
      </div>
    </div>
  );
}
