'use client';
import { useEffect, useState, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';

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
    setLoading(false);
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

  if (loading) return (<div style={{ minHeight:'100vh', background:'#0f0f0f', display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ color:'#6366f1' }}>Loading Kids…</div></div>);

  return (
    <div style={{ minHeight:'100vh', background:'#0f0f0f', color:'#fff' }}>
      <NavbarClient />
      <div style={{ maxWidth:740, margin:'0 auto', padding:'1.5rem 1rem 5rem' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1.5rem' }}>
          <div>
            <h1 style={{ fontSize:'1.4rem', fontWeight:700, marginBottom:4 }}>🧒 Kids Safe Zone</h1>
            <p style={{ color:'#555', fontSize:'0.85rem' }}>Profiles + file uploads per child</p>
          </div>
          <button onClick={() => { resetForm(); setShowForm(!showForm); }} style={btn1}>{showForm ? 'Cancel' : '+ Add Child'}</button>
        </div>

        {/* Add/Edit Profile Form */}
        {showForm && (
          <div style={{ background:'#1a1a1a', border:'1px solid #333', borderRadius:12, padding:'1.2rem', marginBottom:'1.5rem' }}>
            <h3 style={{ color:'#fff', fontSize:'0.9rem', fontWeight:600, marginBottom:'1rem' }}>{editing ? `Edit — ${editing.name}` : 'New Child Profile'}</h3>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginBottom:'0.75rem' }}>
              <div><label style={{ color:'#aaa', fontSize:'0.78rem', display:'block', marginBottom:4 }}>Name*</label><input style={inp} placeholder="Child's name" value={name} onChange={e => setName(e.target.value)} /></div>
              <div><label style={{ color:'#aaa', fontSize:'0.78rem', display:'block', marginBottom:4 }}>Date of Birth</label><input style={inp} type="date" value={dob} onChange={e => setDob(e.target.value)} /></div>
            </div>
            <div style={{ marginBottom:'0.75rem' }}><label style={{ color:'#aaa', fontSize:'0.78rem', display:'block', marginBottom:4 }}>School</label><input style={inp} placeholder="School name" value={school} onChange={e => setSchool(e.target.value)} /></div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginBottom:'0.75rem' }}>
              <div>
                <label style={{ color:'#aaa', fontSize:'0.78rem', display:'block', marginBottom:4 }}>Blood Group</label>
                <select style={inp} value={blood} onChange={e => setBlood(e.target.value)}>
                  <option value="">Unknown</option>
                  {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bg => <option key={bg}>{bg}</option>)}
                </select>
              </div>
              <div><label style={{ color:'#aaa', fontSize:'0.78rem', display:'block', marginBottom:4 }}>Doctor</label><input style={inp} placeholder="Paediatrician" value={doctor} onChange={e => setDoctor(e.target.value)} /></div>
            </div>
            <div style={{ marginBottom:'1rem' }}><label style={{ color:'#aaa', fontSize:'0.78rem', display:'block', marginBottom:4 }}>Allergies / Medical Notes</label><input style={inp} placeholder="e.g. Peanut allergy" value={allergies} onChange={e => setAllergies(e.target.value)} /></div>
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <button onClick={saveKid} disabled={saving} style={btn1}>{saving ? 'Saving…' : editing ? 'Update' : 'Save Profile'}</button>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={btn0}>Cancel</button>
            </div>
          </div>
        )}

        {/* Kids List */}
        {kids.length === 0 && !showForm
          ? <div style={{ textAlign:'center', padding:'4rem 2rem', color:'#444' }}><div style={{ fontSize:'3rem', marginBottom:'0.75rem' }}>👶</div><div>No child profiles yet. Add your first.</div></div>
          : <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', marginBottom:'1.5rem' }}>
              {kids.map(kid => {
                const age = calcAge(kid.dob);
                const grp = ageGroup(age);
                const active = activeKid?.id === kid.id;
                return (
                  <div key={kid.id} onClick={() => selectKid(kid)} style={{ background: active ? '#6366f115' : '#1a1a1a', border: `1px solid ${active ? '#6366f1' : '#2a2a2a'}`, borderRadius:12, padding:'0.9rem 1.1rem', cursor:'pointer', minWidth:160, flex:'1 1 160px', transition:'border 0.2s' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.5rem' }}>
                      <span style={{ fontSize:'1.4rem' }}>{AE[grp]}</span>
                      <div>
                        <div style={{ color:'#fff', fontWeight:600, fontSize:'0.9rem' }}>{kid.name}</div>
                        <div style={{ color:'#666', fontSize:'0.72rem' }}>{age !== null ? `${age} yrs` : 'Age N/A'}</div>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.6rem' }}>
                      <button onClick={e => { e.stopPropagation(); startEdit(kid); }} style={{ ...btn0, fontSize:'0.72rem', padding:'0.3rem 0.6rem', flex:1 }}>Edit</button>
                      <button onClick={e => { e.stopPropagation(); deleteKid(kid.id); }} style={{ padding:'0.3rem 0.5rem', borderRadius:6, border:'1px solid #ef444433', background:'transparent', color:'#ef4444', cursor:'pointer', fontSize:'0.72rem' }}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
        }
        {/* Active Kid Content Panel */}
        {activeKid && (
          <div style={{ background:'#111', border:'1px solid #222', borderRadius:14, padding:'1.2rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
              <div>
                <div style={{ color:'#fff', fontWeight:700, fontSize:'1rem' }}>{activeKid.name}'s Files</div>
                <div style={{ color:'#555', fontSize:'0.78rem' }}>{content.length} item{content.length !== 1 ? 's' : ''}</div>
              </div>
              <button onClick={() => setShowUpload(!showUpload)} style={btn1}>
                {showUpload ? 'Cancel' : '+ Upload'}
              </button>
            </div>

            {/* Upload Form */}
            {showUpload && (
              <div style={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:10, padding:'1rem', marginBottom:'1rem' }}>
                <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', marginBottom:'0.75rem' }}>
                  {CONTENT_TYPES.map(ct => (
                    <button key={ct.value} onClick={() => setUType(ct.value)} style={{ padding:'0.35rem 0.75rem', borderRadius:20, border:`1px solid ${uType===ct.value ? ct.color : '#333'}`, background: uType===ct.value ? ct.color+'22' : 'transparent', color: uType===ct.value ? ct.color : '#777', fontSize:'0.78rem', cursor:'pointer' }}>
                      {ct.label}
                    </button>
                  ))}
                </div>
                <div style={{ marginBottom:'0.6rem' }}>
                  <input style={inp} placeholder="Title (optional, defaults to filename)" value={uTitle} onChange={e => setUTitle(e.target.value)} />
                </div>
                <div style={{ marginBottom:'0.75rem' }}>
                  <input style={inp} placeholder="Description (optional)" value={uDesc} onChange={e => setUDesc(e.target.value)} />
                </div>
                <div
                  onClick={() => fileRef.current.click()}
                  style={{ border:'2px dashed #333', borderRadius:8, padding:'1.5rem', textAlign:'center', cursor:'pointer', marginBottom:'0.75rem', color: uFile ? '#6366f1' : '#555', fontSize:'0.85rem' }}
                >
                  {uFile ? `✓ ${uFile.name} (${fmt(uFile.size)})` : '📎 Tap to choose file (PDF, image, max 50MB)'}
                </div>
                <input ref={fileRef} type="file" style={{ display:'none' }} accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.mp4,.mp3,.wav" onChange={e => setUFile(e.target.files[0])} />
                {err && <div style={{ color:'#ef4444', fontSize:'0.8rem', marginBottom:'0.5rem' }}>{err}</div>}
                {uploading && (
                  <div style={{ marginBottom:'0.75rem' }}>
                    <div style={{ background:'#222', borderRadius:20, height:6, overflow:'hidden' }}>
                      <div style={{ background:'#6366f1', height:'100%', width:`${uploadPct}%`, transition:'width 0.3s' }} />
                    </div>
                    <div style={{ color:'#6366f1', fontSize:'0.75rem', marginTop:4 }}>Uploading {uploadPct}%…</div>
                  </div>
                )}
                <button onClick={uploadFile} disabled={!uFile || uploading} style={{ ...btn1, width:'100%', opacity: !uFile || uploading ? 0.5 : 1 }}>
                  {uploading ? 'Uploading…' : '⬆ Upload File'}
                </button>
              </div>
            )}

            {/* Content Grid */}
            {loadingContent
              ? <div style={{ textAlign:'center', padding:'2rem', color:'#555' }}>Loading…</div>
              : content.length === 0
                ? <div style={{ textAlign:'center', padding:'2.5rem', color:'#444', fontSize:'0.85rem' }}>No files yet. Upload {activeKid.name}'s first file!</div>
                : <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:'0.75rem' }}>
                    {content.map(item => {
                      const ct = CONTENT_TYPES.find(c => c.value === item.content_type) || CONTENT_TYPES[5];
                      const isImg = item.file_type?.startsWith('image/');
                      return (
                        <div key={item.id} style={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:10, overflow:'hidden' }}>
                          {isImg
                            ? <img src={item.file_url} alt={item.title} style={{ width:'100%', height:100, objectFit:'cover', display:'block' }} onError={e => { e.target.style.display='none'; }} />
                            : <div style={{ height:80, background: ct.color+'18', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'2rem' }}>
                                {ct.label.split(' ')[0]}
                              </div>
                          }
                          <div style={{ padding:'0.6rem' }}>
                            <div style={{ color:'#e2e8f0', fontSize:'0.82rem', fontWeight:600, marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.title || item.file_name}</div>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                              <span style={{ fontSize:'0.7rem', color: ct.color }}>{ct.label.split(' ')[1]}</span>
                              {item.file_size && <span style={{ fontSize:'0.7rem', color:'#555' }}>{fmt(item.file_size)}</span>}
                            </div>
                            <div style={{ display:'flex', gap:'0.4rem', marginTop:'0.5rem' }}>
                              <a href={item.file_url} target="_blank" rel="noreferrer" style={{ flex:1, padding:'0.35rem', borderRadius:6, border:'1px solid #333', background:'transparent', color:'#aaa', cursor:'pointer', fontSize:'0.72rem', textAlign:'center', textDecoration:'none' }}>View</a>
                              <button onClick={() => deleteContent(item)} style={{ padding:'0.35rem 0.5rem', borderRadius:6, border:'1px solid #ef444433', background:'transparent', color:'#ef4444', cursor:'pointer', fontSize:'0.72rem' }}>✕</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
            }
          </div>
        )}

        {kids.length > 0 && <div style={{ background:'#6366f108', border:'1px solid #6366f122', borderRadius:10, padding:'0.9rem', marginTop:'1.5rem', fontSize:'0.82rem', color:'#6366f1' }}>🔒 Kids profiles and files are private — only visible to you.</div>}

      </div>
    </div>
  );
}
