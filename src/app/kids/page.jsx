'use client';
import { useEffect, useState, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';
import KidsLockOverlay, { PinSetupModal, setKidsLock, isKidsLocked, getStoredPin } from '@/components/KidsLockOverlay';

const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const inp = { width:'100%', background:'#111', border:'1px solid #333', borderRadius:8, color:'#fff', padding:'0.6rem 0.75rem', fontSize:'0.88rem', outline:'none', boxSizing:'border-box' };
const btn1 = { padding:'0.6rem 1.2rem', borderRadius:8, border:'none', background:'#6366f1', color:'#fff', fontSize:'0.88rem', fontWeight:600, cursor:'pointer' };
const btn0 = { ...btn1, background:'transparent', border:'1px solid #333', color:'#aaa' };
const AE = { '3-5':'🧒', '6-8':'👦', '9-12':'🧑', '13+':'👨‍🎓' };
const calcAge = dob => dob ? Math.floor((Date.now() - new Date(dob)) / (1000*60*60*24*365.25)) : null;
const ageGroup = a => !a ? '6-8' : a <= 5 ? '3-5' : a <= 8 ? '6-8' : a <= 12 ? '9-12' : '13+';
const CONTENT_TYPES = [
  { value:'school', label:'📚 School', color:'#6366f1' },
  { value:'drawing', label:'🎨 Drawing', color:'#f59e0b' },
  { value:'photo', label:'📸 Photo', color:'#10b981' },
  { value:'certificate', label:'🏅 Certificate', color:'#8b5cf6' },
  { value:'report', label:'📋 Report Card', color:'#3b82f6' },
  { value:'other', label:'📎 Other', color:'#64748b' },
];
const fmt = n => n >= 1048576 ? (n/1048576).toFixed(1)+'MB' : n >= 1024 ? (n/1024).toFixed(0)+'KB' : n+'B';

export default function KidsPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kids, setKids] = useState([]);
  const [activeKid, setActiveKid] = useState(null);
  const [content, setContent] = useState([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  // Kids soft lock
  const [kidsMode, setKidsMode] = useState(false);
  const [showLock, setShowLock] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [softLockEnabled, setSoftLockEnabled] = useState(false);
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [school, setSchool] = useState('');
  const [blood, setBlood] = useState('');
  const [doctor, setDoctor] = useState('');
  const [allergies, setAllergies] = useState('');
  const [uFile, setUFile] = useState(null);
  const [uTitle, setUTitle] = useState('');
  const [uType, setUType] = useState('school');
  const [uDesc, setUDesc] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef();

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login'; return; }
    setUser(user);
    const { data } = await supabase.from('kids_profiles').select('*').eq('user_id', user.id).order('created_at', { ascending: true });
    setKids(data || []);
    // Check kids_soft_lock feature flag
    const { data: flag } = await supabase.from('feature_flags').select('feature_name').eq('feature_name', 'kids_soft_lock').single();
    if (flag) setSoftLockEnabled(true);
    // Restore lock state from localStorage
    if (isKidsLocked()) { setKidsMode(true); setShowLock(true); }
    setLoading(false);
  }

  function enableKidsMode() {
    if (!softLockEnabled) { setKidsMode(true); return; }
    const pin = getStoredPin();
    if (!pin) { setShowPinSetup(true); }
    else { setKidsLock(true); setKidsMode(true); }
  }

  function disableKidsMode() {
    if (!softLockEnabled || !getStoredPin()) { setKidsMode(false); return; }
    setShowLock(true);
  }

  async function loadContent(kidId) {
    setLoadingContent(true);
    const { data } = await supabase.from('kids_content').select('*').eq('kid_id', kidId).eq('user_id', user.id).order('created_at', { ascending: false });
    setContent(data || []);
    setLoadingContent(false);
  }

  function selectKid(kid) {
    setActiveKid(kid);
    setShowUpload(false);
    loadContent(kid.id);
  }

  function startEdit(kid) {
    setEditing(kid); setName(kid.name||''); setDob(kid.dob||''); setSchool(kid.school||'');
    setBlood(kid.blood_group||''); setDoctor(kid.doctor_name||''); setAllergies(kid.allergies||'');
    setShowForm(true);
  }

  function resetForm() { setEditing(null); setName(''); setDob(''); setSchool(''); setBlood(''); setDoctor(''); setAllergies(''); }

  async function saveKid() {
    if (!name.trim()) return;
    setSaving(true);
    const payload = { user_id: user.id, name: name.trim(), dob: dob||null, school: school||null, blood_group: blood||null, doctor_name: doctor||null, allergies: allergies||null };
    let data;
    if (editing) {
      const res = await supabase.from('kids_profiles').update(payload).eq('id', editing.id).select().single();
      data = res.data;
      if (data) setKids(p => p.map(k => k.id === editing.id ? data : k));
    } else {
      const res = await supabase.from('kids_profiles').insert(payload).select().single();
      data = res.data;
      if (data) setKids(p => [...p, data]);
    }
    await supabase.from('audit_log').insert({ user_id: user.id, action: editing ? 'kid_updated' : 'kid_created', service: 'kids', details: { name: name.trim() } });
    resetForm(); setSaving(false); setShowForm(false);
  }

  async function deleteKid(id) {
    await supabase.from('kids_profiles').delete().eq('id', id);
    setKids(p => p.filter(k => k.id !== id));
    if (activeKid?.id === id) { setActiveKid(null); setContent([]); }
  }

  async function uploadFile() {
    if (!uFile || !activeKid) return;
    if (uFile.size > 52428800) { setErr('File too large (max 50MB)'); return; }
    setErr(''); setUploading(true); setUploadPct(10);
    const ext = uFile.name.split('.').pop();
    const path = `${user.id}/${activeKid.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('kids-content').upload(path, uFile, { cacheControl:'3600', upsert:false });
    if (upErr) { setErr(upErr.message); setUploading(false); return; }
    setUploadPct(70);
    const { data: { publicUrl } } = supabase.storage.from('kids-content').getPublicUrl(path);
    const { data: { signedUrl } } = await supabase.storage.from('kids-content').createSignedUrl(path, 60*60*24*365);
    setUploadPct(90);
    const { data: row } = await supabase.from('kids_content').insert({
      user_id: user.id, kid_id: activeKid.id, title: uTitle || uFile.name,
      content_type: uType, description: uDesc||null,
      file_url: signedUrl || path, file_name: uFile.name,
      file_size: uFile.size, file_type: uFile.type,
    }).select().single();
    if (row) setContent(p => [row, ...p]);
    await supabase.from('audit_log').insert({ user_id: user.id, action: 'kids_file_uploaded', service: 'kids', details: { kid: activeKid.name, file: uFile.name } });
    setUploadPct(100);
    setUploading(false); setShowUpload(false); setUFile(null); setUTitle(''); setUDesc(''); setUType('school');
  }

  async function deleteContent(item) {
    const pathMatch = item.file_url?.match(/kids-content\/(.+?)(\?|$)/);
    if (pathMatch) await supabase.storage.from('kids-content').remove([pathMatch[1]]);
    await supabase.from('kids_content').delete().eq('id', item.id);
    setContent(p => p.filter(c => c.id !== item.id));
  }


  const KID_COLORS = ['#6366f1','#f59e0b','#10b981','#ec4899','#3b82f6','#8b5cf6'];
  const KID_BG = ['rgba(99,102,241,0.12)','rgba(245,158,11,0.12)','rgba(16,185,129,0.12)','rgba(236,72,153,0.12)','rgba(59,130,246,0.12)','rgba(139,92,246,0.12)'];

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#0d1117', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16 }}>
      <div style={{ fontSize:48 }}>🧒</div>
      <div style={{ color:'#6366f1', fontSize:14 }}>Loading Kids Zone…</div>
    </div>
  );

  return (
    <div style={{ minHeight:'100vh', background:'#0d1117', color:'#fff', fontFamily:'system-ui,sans-serif' }}>
      {showPinSetup && (
        <PinSetupModal
          onSave={(pin) => { setKidsLock(true); setKidsMode(true); setShowPinSetup(false); }}
          onCancel={() => { setKidsMode(false); setShowPinSetup(false); }}
        />
      )}
      {showLock && <KidsLockOverlay onUnlock={() => { setShowLock(false); setKidsMode(false); }} />}
      <NavbarClient />
      <div style={{ maxWidth:480, margin:'0 auto', padding:'6rem 16px 6rem' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <div>
            <h1 style={{ fontSize:22, fontWeight:800, marginBottom:2 }}>🧒 Kids Zone</h1>
            <div style={{ fontSize:12, color:'#475569' }}>Profiles · files · memories</div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {softLockEnabled && (
              <button onClick={kidsMode ? disableKidsMode : enableKidsMode}
                style={{ padding:'7px 12px', borderRadius:10, border:`1px solid ${kidsMode ? '#10b981' : 'rgba(255,255,255,0.1)'}`, background: kidsMode ? 'rgba(16,185,129,0.1)' : 'transparent', color: kidsMode ? '#10b981' : '#64748b', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                {kidsMode ? '🔓 Exit' : '🔒 Lock'}
              </button>
            )}
            <button onClick={() => { resetForm(); setShowForm(!showForm); }}
              style={{ padding:'7px 14px', borderRadius:10, border:'none', background:'#6366f1', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>
              {showForm ? '✕ Cancel' : '+ Add Child'}
            </button>
          </div>
        </div>

        {/* Add/Edit form */}
        {showForm && (
          <div style={{ background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:16, padding:20, marginBottom:24 }}>
            <div style={{ fontSize:15, fontWeight:700, color:'#a5b4fc', marginBottom:16 }}>
              {editing ? `✏️ Edit — ${editing.name}` : '🌟 New Child Profile'}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
              <div>
                <div style={{ fontSize:11, color:'#64748b', marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Name *</div>
                <input style={{ width:'100%', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:10, color:'#e2e8f0', padding:'10px 12px', fontSize:14, outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
                  placeholder="Child's name" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize:11, color:'#64748b', marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Date of Birth</div>
                <input type="date" style={{ width:'100%', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:10, color:'#e2e8f0', padding:'10px 12px', fontSize:14, outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
                  value={dob} onChange={e => setDob(e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:8, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>School / Notes</div>
              <input style={{ width:'100%', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:10, color:'#e2e8f0', padding:'10px 12px', fontSize:14, outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
                placeholder="School name, grade, notes…" value={school} onChange={e => setSchool(e.target.value)} />
            </div>
            {err && <div style={{ color:'#f87171', fontSize:12, marginBottom:8 }}>⚠️ {err}</div>}
            <button onClick={saveKid} disabled={saving}
              style={{ width:'100%', padding:12, borderRadius:10, border:'none', background:'linear-gradient(135deg,#6366f1,#818cf8)', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer', opacity: saving ? 0.7 : 1, fontFamily:'inherit' }}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Child ✨'}
            </button>
          </div>
        )}

        {/* Kids grid */}
        {kids.length === 0 && !showForm ? (
          <div style={{ textAlign:'center', padding:'60px 20px' }}>
            <div style={{ fontSize:64, marginBottom:16 }}>🌈</div>
            <div style={{ fontSize:16, fontWeight:700, color:'#e2e8f0', marginBottom:8 }}>No child profiles yet</div>
            <div style={{ fontSize:13, color:'#475569' }}>Tap + Add Child to create the first profile</div>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:24 }}>
            {kids.map((kid, idx) => {
              const age = calcAge(kid.date_of_birth);
              const ag = ageGroup(age);
              const isActive = activeKid?.id === kid.id;
              const col = KID_COLORS[idx % KID_COLORS.length];
              const bg = KID_BG[idx % KID_BG.length];
              return (
                <div key={kid.id} onClick={() => setActiveKid(isActive ? null : kid)}
                  style={{ background: isActive ? bg : 'rgba(255,255,255,0.04)', border:`2px solid ${isActive ? col : 'rgba(255,255,255,0.08)'}`, borderRadius:16, padding:16, cursor:'pointer', transition:'all 0.15s' }}>
                  <div style={{ fontSize:36, marginBottom:8 }}>{AE[ag] || '🧒'}</div>
                  <div style={{ fontSize:15, fontWeight:700, color:'#e2e8f0', marginBottom:2 }}>{kid.name}</div>
                  {age !== null && <div style={{ fontSize:11, color: col, fontWeight:600 }}>{age} yrs · {ag}</div>}
                  {kid.school && <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>📚 {kid.school}</div>}
                  <div style={{ display:'flex', gap:6, marginTop:10 }}>
                    <button onClick={e => { e.stopPropagation(); startEdit(kid); }}
                      style={{ flex:1, padding:'5px 0', borderRadius:8, border:`1px solid rgba(255,255,255,0.1)`, background:'transparent', color:'#64748b', fontSize:11, cursor:'pointer' }}>✏️ Edit</button>
                    <button onClick={e => { e.stopPropagation(); deleteKid(kid.id); }}
                      style={{ padding:'5px 10px', borderRadius:8, border:'1px solid rgba(239,68,68,0.25)', background:'transparent', color:'#ef4444', fontSize:11, cursor:'pointer' }}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Active kid — content section */}
        {activeKid && (
          <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:16, padding:20, marginBottom:24 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div style={{ fontSize:15, fontWeight:700, color:'#e2e8f0' }}>📁 {activeKid.name}'s Files</div>
              <button onClick={() => { setShowUpload(!showUpload); setUFile(null); setUTitle(''); setUDesc(''); setUType('school'); }}
                style={{ padding:'7px 14px', borderRadius:10, border:'none', background:'rgba(99,102,241,0.2)', color:'#a5b4fc', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                {showUpload ? '✕ Cancel' : '📎 Upload'}
              </button>
            </div>

            {/* Upload form */}
            {showUpload && (
              <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:12, padding:16, marginBottom:16 }}>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12 }}>
                  {CONTENT_TYPES.map(ct => (
                    <button key={ct.value} onClick={() => setUType(ct.value)}
                      style={{ padding:'5px 10px', borderRadius:20, border:`1px solid ${uType===ct.value ? ct.color : 'rgba(255,255,255,0.1)'}`, background: uType===ct.value ? ct.color+'22' : 'transparent', color: uType===ct.value ? ct.color : '#64748b', fontSize:11, cursor:'pointer' }}>
                      {ct.label}
                    </button>
                  ))}
                </div>
                <input style={{ width:'100%', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'#e2e8f0', padding:'9px 12px', fontSize:13, outline:'none', boxSizing:'border-box', marginBottom:8, fontFamily:'inherit' }}
                  placeholder="Title (e.g. Report Card Term 1)" value={uTitle} onChange={e => setUTitle(e.target.value)} />
                <input type="file" accept="image/*,application/pdf,.doc,.docx"
                  onChange={e => setUFile(e.target.files?.[0] || null)}
                  style={{ fontSize:12, color:'#64748b', marginBottom:8, width:'100%' }} />
                {err && <div style={{ color:'#f87171', fontSize:12, marginBottom:8 }}>{err}</div>}
                {uploading && <div style={{ height:4, background:'rgba(99,102,241,0.2)', borderRadius:2, marginBottom:8 }}><div style={{ height:'100%', width:`${uploadPct}%`, background:'#6366f1', borderRadius:2, transition:'width 0.3s' }} /></div>}
                <button onClick={uploadContent} disabled={uploading || !uFile}
                  style={{ width:'100%', padding:10, borderRadius:8, border:'none', background:'#6366f1', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', opacity: (uploading||!uFile) ? 0.5 : 1, fontFamily:'inherit' }}>
                  {uploading ? `Uploading ${uploadPct}%…` : '📤 Upload File'}
                </button>
              </div>
            )}

            {/* Content list */}
            {loadingContent ? (
              <div style={{ textAlign:'center', padding:20, color:'#64748b', fontSize:13 }}>Loading files…</div>
            ) : content.length === 0 ? (
              <div style={{ textAlign:'center', padding:'30px 0', color:'#475569' }}>
                <div style={{ fontSize:32, marginBottom:8 }}>📂</div>
                <div style={{ fontSize:13 }}>No files yet. Upload the first one!</div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {content.map(item => {
                  const ct = CONTENT_TYPES.find(c => c.value === item.content_type) || CONTENT_TYPES[5];
                  return (
                    <div key={item.id} style={{ display:'flex', alignItems:'center', gap:12, background:'rgba(255,255,255,0.04)', borderRadius:10, padding:'10px 12px' }}>
                      <div style={{ fontSize:22, flexShrink:0 }}>{ct.label.split(' ')[0]}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:'#e2e8f0', marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.title || item.file_name}</div>
                        <div style={{ fontSize:11, color:'#475569' }}>{ct.label} · {item.file_size ? fmt(item.file_size) : ''}</div>
                      </div>
                      {item.file_url && (
                        <a href={item.file_url} target="_blank" rel="noreferrer"
                          style={{ padding:'4px 10px', borderRadius:6, background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.25)', color:'#a5b4fc', fontSize:11, textDecoration:'none', flexShrink:0 }}>View</a>
                      )}
                      <button onClick={() => deleteContent(item)}
                        style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:16, flexShrink:0, padding:'0 2px' }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Privacy note */}
        <div style={{ background:'rgba(16,185,129,0.07)', border:'1px solid rgba(16,185,129,0.2)', borderRadius:12, padding:'12px 16px', fontSize:12, color:'#6ee7b7', display:'flex', gap:10, alignItems:'center' }}>
          <span style={{ fontSize:16 }}>🔒</span>
          <span>Kids profiles and files are private — only visible to you.</span>
        </div>

      </div>
    </div>
  );
}
