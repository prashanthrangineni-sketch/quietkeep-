// File: src/app/memories/page.jsx
'use client';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const LIFE_EVENTS = ['personal','birthday','anniversary','festival','travel','milestone','family','health','work','other'];
const inp = { width:'100%', background:'#111', border:'1px solid #333', borderRadius:8, color:'#fff', padding:'0.65rem 0.85rem', fontSize:'0.88rem', outline:'none', boxSizing:'border-box' };
const btn = { padding:'0.6rem 1.2rem', borderRadius:8, border:'none', background:'#6366f1', color:'#fff', fontSize:'0.88rem', fontWeight:600, cursor:'pointer' };

export default function MemoriesPage() {
  const [user, setUser] = useState(null);
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [activeMemory, setActiveMemory] = useState(null);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const fileRef = useRef();
  const [form, setForm] = useState({ title:'', description:'', life_event_type:'personal', event_date:'' });
  const [uTitle, setUTitle] = useState('');
  const [uFile, setUFile] = useState(null);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUser(user);
    await loadMemories(user.id);
    setLoading(false);
  }

  async function loadMemories(uid) {
    const { data } = await supabase.from('memories').select('*').eq('user_id', uid).order('created_at', { ascending: false });
    setMemories(data || []);
  }

  async function loadItems(memoryId) {
    const { data } = await supabase.from('memory_items').select('*').eq('memory_id', memoryId).order('created_at', { ascending: false });
    setItems(data || []);
  }

  async function createMemory() {
    if (!form.title.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from('memories').insert({
      user_id: user.id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      life_event_type: form.life_event_type,
      event_date: form.event_date || null,
    }).select().single();
    if (!error && data) {
      setMemories(prev => [data, ...prev]);
      setForm({ title:'', description:'', life_event_type:'personal', event_date:'' });
      setShowForm(false);
    }
    setSaving(false);
  }

  async function deleteMemory(id) {
    if (!confirm('Delete this memory and all its files?')) return;
    const { data: its } = await supabase.from('memory_items').select('file_path').eq('memory_id', id);
    if (its?.length) {
      await supabase.storage.from('memories').remove(its.map(i => i.file_path).filter(Boolean));
    }
    await supabase.from('memories').delete().eq('id', id);
    setMemories(prev => prev.filter(m => m.id !== id));
    if (activeMemory?.id === id) { setActiveMemory(null); setItems([]); }
  }

  async function openMemory(m) {
    setActiveMemory(m);
    await loadItems(m.id);
  }

  async function uploadFile() {
    if (!uFile || !activeMemory) return;
    setUploading(true); setUploadPct(0);
    const ext = uFile.name.split('.').pop();
    const path = `${user.id}/${activeMemory.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('memories').upload(path, uFile, { cacheControl:'3600', upsert:false });
    if (error) { alert('Upload failed: ' + error.message); setUploading(false); return; }
    const { data: { signedUrl } } = await supabase.storage.from('memories').createSignedUrl(path, 60*60*24*365*5);
    await supabase.from('memory_items').insert({
      memory_id: activeMemory.id,
      user_id: user.id,
      item_type: uFile.type.startsWith('video') ? 'video' : uFile.type.startsWith('audio') ? 'audio' : uFile.type.startsWith('image') ? 'image' : 'file',
      file_path: path,
      file_url: signedUrl,
      title: uTitle.trim() || uFile.name,
      metadata: { size: uFile.size, mime: uFile.type },
    });
    setUFile(null); setUTitle(''); setUploadPct(100);
    await loadItems(activeMemory.id);
    setUploading(false);
  }

  async function deleteItem(item) {
    if (item.file_path) await supabase.storage.from('memories').remove([item.file_path]);
    await supabase.from('memory_items').delete().eq('id', item.id);
    setItems(prev => prev.filter(i => i.id !== item.id));
  }

  const EVENT_EMOJI = { personal:'💫', birthday:'🎂', anniversary:'💝', festival:'🪔', travel:'✈️', milestone:'🏆', family:'👨‍👩‍👧', health:'🏃', work:'💼', other:'📦' };

  if (loading) return <div style={{ minHeight:'100vh', background:'#0a0a0f', display:'flex', alignItems:'center', justifyContent:'center', color:'#6366f1' }}>Loading...</div>;

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight:'100vh', background:'#0a0a0f', color:'#f1f5f9', paddingBottom: '100px' }}>
        <div style={{ maxWidth:'640px', margin:'0 auto', padding:'20px 16px' }}>

          {/* Header */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
            <div>
              <h1 style={{ margin:0, fontSize:'20px', fontWeight:700, color:'#f1f5f9' }}>🧠 Memory Vault</h1>
              <div style={{ fontSize:'12px', color:'#475569', marginTop:'2px' }}>Photos, docs, videos — organised by meaning</div>
            </div>
            <button onClick={() => setShowForm(!showForm)} style={btn}>+ Memory</button>
          </div>

          {/* Create form */}
          {showForm && (
            <div style={{ background:'#0f0f1a', border:'1px solid #1e1e2e', borderRadius:'14px', padding:'18px', marginBottom:'20px' }}>
              <input style={{ ...inp, marginBottom:'10px' }} placeholder="Memory title *" value={form.title} onChange={e => setForm(f=>({...f, title:e.target.value}))} />
              <input style={{ ...inp, marginBottom:'10px' }} placeholder="Description (optional)" value={form.description} onChange={e => setForm(f=>({...f, description:e.target.value}))} />
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'12px' }}>
                <select style={inp} value={form.life_event_type} onChange={e => setForm(f=>({...f, life_event_type:e.target.value}))}>
                  {LIFE_EVENTS.map(ev => <option key={ev} value={ev}>{EVENT_EMOJI[ev]} {ev.charAt(0).toUpperCase()+ev.slice(1)}</option>)}
                </select>
                <input style={inp} type="date" value={form.event_date} onChange={e => setForm(f=>({...f, event_date:e.target.value}))} />
              </div>
              <div style={{ display:'flex', gap:'10px' }}>
                <button onClick={createMemory} disabled={saving || !form.title.trim()} style={{ ...btn, opacity: saving||!form.title.trim() ? 0.5:1 }}>{saving ? 'Saving...' : 'Create Memory'}</button>
                <button onClick={() => setShowForm(false)} style={{ ...btn, background:'transparent', border:'1px solid #333', color:'#64748b' }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Memory detail view */}
          {activeMemory ? (
            <div>
              <button onClick={() => { setActiveMemory(null); setItems([]); }} style={{ ...btn, background:'transparent', border:'1px solid #333', color:'#94a3b8', marginBottom:'16px', fontSize:'13px' }}>← Back</button>
              <div style={{ background:'#0f0f1a', border:'1px solid #1e1e2e', borderRadius:'14px', padding:'18px', marginBottom:'16px' }}>
                <div style={{ fontSize:'18px', marginBottom:'4px' }}>{EVENT_EMOJI[activeMemory.life_event_type]} <strong>{activeMemory.title}</strong></div>
                {activeMemory.description && <div style={{ fontSize:'13px', color:'#64748b', marginBottom:'6px' }}>{activeMemory.description}</div>}
                {activeMemory.event_date && <div style={{ fontSize:'12px', color:'#475569' }}>📅 {new Date(activeMemory.event_date+'T00:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })}</div>}
              </div>

              {/* Upload area */}
              <div style={{ background:'#0f0f1a', border:'1px solid #1e1e2e', borderRadius:'14px', padding:'16px', marginBottom:'16px' }}>
                <div style={{ fontSize:'13px', fontWeight:600, color:'#6366f1', marginBottom:'10px' }}>+ Add File</div>
                <input style={{ ...inp, marginBottom:'8px' }} placeholder="Title (optional)" value={uTitle} onChange={e => setUTitle(e.target.value)} />
                <input ref={fileRef} type="file" style={{ display:'none' }} accept="image/*,video/mp4,audio/*,application/pdf,.doc,.docx" onChange={e => setUFile(e.target.files[0])} />
                <button onClick={() => fileRef.current?.click()} style={{ ...btn, background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.3)', color:'#a5b4fc', marginBottom:'8px', width:'100%' }}>
                  {uFile ? `📎 ${uFile.name}` : '📁 Choose File'}
                </button>
                {uploading && (
                  <div style={{ marginBottom:'8px' }}>
                    <div style={{ background:'#1e293b', borderRadius:'4px', height:'4px' }}><div style={{ background:'#6366f1', height:'100%', width:`${uploadPct}%`, transition:'width 0.3s' }} /></div>
                    <div style={{ color:'#6366f1', fontSize:'11px', marginTop:'4px' }}>Uploading...</div>
                  </div>
                )}
                <button onClick={uploadFile} disabled={!uFile || uploading} style={{ ...btn, opacity: !uFile||uploading ? 0.5:1 }}>Upload</button>
              </div>

              {/* Items grid */}
              {items.length === 0 ? (
                <div style={{ textAlign:'center', color:'#334155', padding:'30px', border:'1px dashed #1e293b', borderRadius:'12px' }}>No files yet. Add photos, videos, or documents.</div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'10px' }}>
                  {items.map(item => (
                    <div key={item.id} style={{ background:'#0f0f1a', border:'1px solid #1e1e2e', borderRadius:'12px', overflow:'hidden' }}>
                      {item.item_type === 'image' ? (
                        <img src={item.file_url} alt={item.title} style={{ width:'100%', height:'120px', objectFit:'cover' }} />
                      ) : (
                        <div style={{ height:'80px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'32px', background:'#12121a' }}>
                          {item.item_type==='video'?'🎥':item.item_type==='audio'?'🎵':'📄'}
                        </div>
                      )}
                      <div style={{ padding:'8px' }}>
                        <div style={{ fontSize:'12px', color:'#e2e8f0', marginBottom:'6px', wordBreak:'break-word' }}>{item.title}</div>
                        <div style={{ display:'flex', gap:'6px' }}>
                          <a href={item.file_url} target="_blank" rel="noopener noreferrer" style={{ flex:1, textAlign:'center', padding:'5px', background:'rgba(99,102,241,0.1)', borderRadius:'6px', color:'#a5b4fc', fontSize:'11px', textDecoration:'none' }}>View</a>
                          <button onClick={() => deleteItem(item)} style={{ padding:'5px 8px', background:'rgba(239,68,68,0.1)', border:'none', borderRadius:'6px', color:'#ef4444', fontSize:'11px', cursor:'pointer' }}>✕</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Memory list */
            memories.length === 0 ? (
              <div style={{ textAlign:'center', color:'#334155', padding:'40px', border:'1px dashed #1e293b', borderRadius:'14px' }}>
                <div style={{ fontSize:'32px', marginBottom:'10px' }}>🧠</div>
                <div>No memories yet. Create your first memory vault.</div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                {memories.map(m => (
                  <div key={m.id} onClick={() => openMemory(m)} style={{ background:'#0f0f1a', border:'1px solid #1e1e2e', borderRadius:'14px', padding:'16px', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div>
                      <div style={{ fontSize:'15px', fontWeight:600 }}>{EVENT_EMOJI[m.life_event_type]} {m.title}</div>
                      {m.description && <div style={{ fontSize:'12px', color:'#475569', marginTop:'3px' }}>{m.description}</div>}
                      {m.event_date && <div style={{ fontSize:'11px', color:'#334155', marginTop:'3px' }}>📅 {new Date(m.event_date+'T00:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</div>}
                      <div style={{ fontSize:'10px', color:'#1e293b', marginTop:'3px', textTransform:'uppercase', letterSpacing:'0.05em' }}>{m.life_event_type}</div>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'8px' }}>
                      <span style={{ fontSize:'20px' }}>›</span>
                      <button onClick={e => { e.stopPropagation(); deleteMemory(m.id); }} style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:'13px' }}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}
