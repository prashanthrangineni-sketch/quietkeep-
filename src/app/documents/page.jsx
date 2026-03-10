'use client';
import { useState, useEffect, useRef } from 'react';
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
  { name: 'Aadhar', emoji: '🪪', color: '#f43f5e' },
  { name: 'PAN', emoji: '💼', color: '#f97316' },
  { name: 'Vehicle', emoji: '🚗', color: '#06b6d4' },
  { name: 'Other', emoji: '📋', color: '#64748b' },
];

const fmt = n => n >= 1048576 ? (n/1048576).toFixed(1)+'MB' : n >= 1024 ? (n/1024).toFixed(0)+'KB' : n+'B';
const inp = { width:'100%', backgroundColor:'#1a1a2e', border:'1px solid #334155', color:'#f1f5f9', padding:'10px 12px', borderRadius:'8px', fontSize:'13px', boxSizing:'border-box', outline:'none' };

export default function Documents() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filterCat, setFilterCat] = useState('All');
  const [formData, setFormData] = useState({ name: '', category: 'Other', expiry_date: '', reminder_days_before: 30 });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      const { data } = await supabase.from('documents').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
      setDocuments(data || []);
      setLoading(false);
    });
  }, [router]);

  const getDaysUntilExpiry = (expiryDate) => {
    if (!expiryDate) return null;
    return Math.floor((new Date(expiryDate) - new Date()) / (1000*60*60*24));
  };

  async function handleAddDocument() {
    if (!formData.name.trim()) { setErr('Document name is required'); return; }
    setErr(''); setSaving(true);
    let file_url = null, file_name = null, file_size = null, file_type = null;

    if (file) {
      if (file.size > 52428800) { setErr('File too large (max 50MB)'); setSaving(false); return; }
      setUploading(true); setUploadPct(20);
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { cacheControl:'3600', upsert:false });
      if (upErr) { setErr(upErr.message); setSaving(false); setUploading(false); return; }
      setUploadPct(70);
      const { data: signed } = await supabase.storage.from('documents').createSignedUrl(path, 60*60*24*365*5);
      file_url = signed?.signedUrl || path;
      file_name = file.name; file_size = file.size; file_type = file.type;
      setUploadPct(90); setUploading(false);
    }

    const { data, error } = await supabase.from('documents').insert({
      user_id: user.id,
      name: formData.name,
      doc_name: formData.name,
      doc_type: formData.category.toLowerCase(),
      category: formData.category,
      expiry_date: formData.expiry_date || null,
      reminder_days_before: formData.reminder_days_before,
      file_url, file_name, file_size, file_type,
    }).select().single();

    if (!error && data) {
      setDocuments([data, ...documents]);
      setFormData({ name: '', category: 'Other', expiry_date: '', reminder_days_before: 30 });
      setFile(null); setShowForm(false);
    } else if (error) setErr(error.message);
    setSaving(false); setUploadPct(0);
  }

  async function handleDelete(doc) {
    if (doc.file_url) {
      const pathMatch = doc.file_url.match(/documents\/(.+?)(\?|$)/);
      if (pathMatch) await supabase.storage.from('documents').remove([pathMatch[1]]);
    }
    await supabase.from('documents').delete().eq('id', doc.id);
    setDocuments(documents.filter(d => d.id !== doc.id));
  }

  const filtered = filterCat === 'All' ? documents : documents.filter(d => d.category === filterCat);
  const expiring = documents.filter(d => { const x = getDaysUntilExpiry(d.expiry_date); return x !== null && x >= 0 && x <= 30; });
  const expired = documents.filter(d => { const x = getDaysUntilExpiry(d.expiry_date); return x !== null && x < 0; });

  if (loading) return (<><NavbarClient /><div style={{ minHeight:'100vh', backgroundColor:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ color:'#6366f1', fontSize:18 }}>Loading…</div></div></>);

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight:'100vh', backgroundColor:'#0a0a0f', color:'#f1f5f9', padding:'96px 16px 80px' }}>
        <div style={{ maxWidth:'660px', margin:'0 auto' }}>

          {/* Header */}
          <div style={{ marginBottom:'20px' }}>
            <h1 style={{ fontSize:'28px', fontWeight:'800', margin:'0 0 6px' }}>📄 Documents</h1>
            <div style={{ fontSize:'13px', color:'#94a3b8' }}>{documents.length} document{documents.length!==1?'s':''} · {expiring.length} expiring soon · {expired.length} expired</div>
          </div>

          {/* Alerts */}
          {(expiring.length > 0 || expired.length > 0) && (
            <div style={{ marginBottom:'16px', display:'flex', flexDirection:'column', gap:'8px' }}>
              {expired.length > 0 && <div style={{ background:'#ef444415', border:'1px solid #ef444433', borderRadius:10, padding:'10px 14px', fontSize:'13px', color:'#ef4444' }}>❌ {expired.length} document{expired.length!==1?'s':''} expired — please renew</div>}
              {expiring.length > 0 && <div style={{ background:'#f59e0b15', border:'1px solid #f59e0b33', borderRadius:10, padding:'10px 14px', fontSize:'13px', color:'#f59e0b' }}>⚠️ {expiring.length} document{expiring.length!==1?'s':''} expiring within 30 days</div>}
            </div>
          )}

          {/* Category Filter */}
          <div style={{ display:'flex', gap:'8px', overflowX:'auto', paddingBottom:'8px', marginBottom:'16px' }}>
            {['All', ...CATEGORIES.map(c => c.name)].map(cat => (
              <button key={cat} onClick={() => setFilterCat(cat)} style={{ whiteSpace:'nowrap', padding:'6px 14px', borderRadius:20, border:`1px solid ${filterCat===cat ? '#6366f1' : '#334155'}`, background: filterCat===cat ? '#6366f122' : 'transparent', color: filterCat===cat ? '#6366f1' : '#94a3b8', fontSize:'12px', cursor:'pointer' }}>
                {cat}
              </button>
            ))}
          </div>

          {/* Doc List */}
          {filtered.length > 0 && (
            <div style={{ display:'grid', gap:'10px', marginBottom:'20px' }}>
              {filtered.map(doc => {
                const days = getDaysUntilExpiry(doc.expiry_date);
                const isExpired = days !== null && days < 0;
                const isSoon = days !== null && days >= 0 && days <= 30;
                const cat = CATEGORIES.find(c => c.name === doc.category);
                return <DocCard key={doc.id} doc={doc} days={days} isExpired={isExpired} isSoon={isSoon} cat={cat} onDelete={() => handleDelete(doc)} />;
              })}
            </div>
          )}

          {filtered.length === 0 && <div style={{ textAlign:'center', padding:'3rem', color:'#475569' }}><div style={{ fontSize:'2.5rem', marginBottom:'8px' }}>📂</div><div>No documents in this category</div></div>}

          <button onClick={() => setShowForm(!showForm)} style={{ width:'100%', backgroundColor:'#6366f1', color:'#fff', border:'none', padding:'12px', borderRadius:'10px', fontSize:'14px', fontWeight:'600', cursor:'pointer' }}>
            {showForm ? 'Cancel' : '+ Add Document'}
          </button>
          {/* Add Form */}
          {showForm && (
            <div style={{ backgroundColor:'#0f0f1a', border:'1px solid #1e293b', borderRadius:'14px', padding:'20px', marginTop:'20px' }}>
              <h3 style={{ fontSize:'15px', fontWeight:'700', color:'#f1f5f9', margin:'0 0 14px' }}>Add Document</h3>

              {/* Category picker */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(90px,1fr))', gap:'8px', marginBottom:'14px' }}>
                {CATEGORIES.map(cat => (
                  <button key={cat.name} onClick={() => setFormData({ ...formData, category: cat.name })} style={{ backgroundColor: formData.category===cat.name ? cat.color : '#1e1e2e', border:`1px solid ${formData.category===cat.name ? cat.color : '#334155'}`, color:'#f1f5f9', padding:'8px 4px', borderRadius:'8px', cursor:'pointer', fontSize:'11px', fontWeight:'600' }}>
                    {cat.emoji} {cat.name}
                  </button>
                ))}
              </div>

              <input type="text" placeholder="Document name (e.g. Amma's Passport)" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} style={{ ...inp, marginBottom:'10px' }} />

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'10px' }}>
                <div>
                  <label style={{ color:'#64748b', fontSize:'11px', display:'block', marginBottom:4 }}>Expiry Date</label>
                  <input type="date" value={formData.expiry_date} onChange={e => setFormData({ ...formData, expiry_date: e.target.value })} style={inp} />
                </div>
                <div>
                  <label style={{ color:'#64748b', fontSize:'11px', display:'block', marginBottom:4 }}>Alert Before (days)</label>
                  <select value={formData.reminder_days_before} onChange={e => setFormData({ ...formData, reminder_days_before: parseInt(e.target.value) })} style={inp}>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </div>
              </div>

              {/* File upload */}
              <div
                onClick={() => fileRef.current.click()}
                style={{ border:'2px dashed #334155', borderRadius:'8px', padding:'1.2rem', textAlign:'center', cursor:'pointer', marginBottom:'12px', color: file ? '#10b981' : '#475569', fontSize:'13px' }}
              >
                {file ? `✓ ${file.name} (${fmt(file.size)})` : '📎 Attach file (PDF, image — optional, max 50MB)'}
              </div>
              <input ref={fileRef} type="file" style={{ display:'none' }} accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx" onChange={e => setFile(e.target.files[0])} />

              {uploading && (
                <div style={{ marginBottom:'10px' }}>
                  <div style={{ background:'#1e293b', borderRadius:20, height:5, overflow:'hidden' }}>
                    <div style={{ background:'#6366f1', height:'100%', width:`${uploadPct}%`, transition:'width 0.3s' }} />
                  </div>
                  <div style={{ color:'#6366f1', fontSize:'11px', marginTop:4 }}>Uploading {uploadPct}%…</div>
                </div>
              )}

              {err && <div style={{ color:'#ef4444', fontSize:'12px', marginBottom:'10px' }}>{err}</div>}

              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={handleAddDocument} disabled={saving || uploading} style={{ flex:1, backgroundColor:'#6366f1', color:'#fff', border:'none', padding:'10px', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer', opacity: saving||uploading ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : '💾 Save Document'}
                </button>
                <button onClick={() => { setShowForm(false); setFile(null); setErr(''); }} style={{ flex:1, backgroundColor:'#1a1a2e', color:'#94a3b8', border:'1px solid #334155', padding:'10px', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

function DocCard({ doc, days, isExpired, isSoon, cat, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const borderColor = isExpired ? 'rgba(239,68,68,0.35)' : isSoon ? 'rgba(245,158,11,0.25)' : '#1e1e2e';
  const catColor = cat?.color || '#64748b';
  return (
    <div style={{ backgroundColor:'#0f0f1a', border:`1px solid ${borderColor}`, borderRadius:'12px', padding:'14px', cursor:'pointer' }} onClick={() => setExpanded(!expanded)}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:'12px' }}>
        <div style={{ fontSize:'22px', width:'28px', flexShrink:0 }}>{cat?.emoji || '📄'}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:'13px', fontWeight:'600', color:'#e2e8f0', marginBottom:'2px' }}>{doc.name}</div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
            <span style={{ fontSize:'10px', color: catColor, background: catColor+'18', padding:'2px 8px', borderRadius:20, fontWeight:600 }}>{doc.category}</span>
            {doc.expiry_date && <span style={{ fontSize:'11px', color: isExpired ? '#ef4444' : isSoon ? '#f59e0b' : '#10b981', fontWeight:'600' }}>
              {isExpired ? `❌ Expired ${Math.abs(days)}d ago` : isSoon ? `⚠️ ${days}d left` : `✅ ${days}d left`}
            </span>}
          </div>
          {expanded && doc.file_url && (
            <div style={{ marginTop:'8px' }}>
              <a href={doc.file_url} target="_blank" rel="noreferrer" style={{ display:'inline-block', padding:'5px 12px', borderRadius:6, background:'#6366f122', border:'1px solid #6366f133', color:'#6366f1', fontSize:'11px', textDecoration:'none', fontWeight:600 }}>
                📎 {doc.file_name || 'View File'} {doc.file_size ? `(${fmt(doc.file_size)})` : ''}
              </a>
            </div>
          )}
        </div>
        <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ backgroundColor:'transparent', border:'none', color:'#ef4444', fontSize:'18px', cursor:'pointer', padding:'0', flexShrink:0 }}>×</button>
      </div>
    </div>
  );
}
