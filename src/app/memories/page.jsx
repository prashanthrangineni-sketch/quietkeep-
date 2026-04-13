'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/memories/page.jsx — AI Memory Engine
 * Year-grouped timeline · AI life insights · Pattern detection · Photo/video/audio upload
 */
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';
import { safeFetch } from '@/lib/safeFetch';

const LIFE_EVENTS = [
  'personal','birthday','anniversary','festival','travel',
  'milestone','family','health','work','purchase','other',
];
const EVENT_EMOJI  = { personal:'💭', birthday:'🎂', anniversary:'💑', festival:'🎉',
  travel:'✈️', milestone:'🏆', family:'👨‍👩‍👧', health:'❤️', work:'💼', purchase:'🛍️', other:'📌' };
const EVENT_COLOR  = { personal:'#6366f1', birthday:'#f59e0b', anniversary:'#ec4899',
  festival:'#f97316', travel:'#3b82f6', milestone:'#22c55e', family:'#8b5cf6',
  health:'#ef4444', work:'#64748b', purchase:'#10b981', other:'#475569' };

export default function MemoriesPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [memories, setMemories]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [view, setView]                 = useState('list'); // list | add | detail
  const [active, setActive]             = useState(null);
  const [items, setItems]               = useState([]);
  const [saving, setSaving]             = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [search, setSearch]             = useState('');
  const [filterType, setFilterType]     = useState('all');
  const [aiInsights, setAiInsights]     = useState(null);
  const [aiLoading, setAiLoading]       = useState(false);
  const [form, setForm]                 = useState({
    title:'', description:'', life_event_type:'personal', event_date:'',
  });
  const [uTitle, setUTitle]             = useState('');
  const [uFile, setUFile]               = useState(null);
  const fileRef                         = useRef();

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
          loadMemories(user?.id);
  }, [user]);

  async function loadMemories(uid) {
    setLoading(true);
    const { data } = await supabase.from('memories')
      .select('*, memory_items(id)')
      .eq('user_id', uid)
      .order('event_date', { ascending: false, nullsFirst: false });
    setMemories(data || []);
    setLoading(false);
  }

  async function openMemory(m) {
    setActive(m);
    const { data } = await supabase.from('memory_items').select('*')
      .eq('memory_id', m.id).order('created_at', { ascending: false });
    setItems(data || []);
    setView('detail');
  }

  async function createMemory() {
    if (!form.title.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from('memories').insert({
      user_id: user.id, title: form.title.trim(),
      description: form.description.trim()||null,
      life_event_type: form.life_event_type,
      event_date: form.event_date||null,
    }).select().single();
    if (!error && data) {
      setMemories(prev => [data, ...prev]);
      setForm({ title:'', description:'', life_event_type:'personal', event_date:'' });
      setView('list');
    }
    setSaving(false);
  }

  async function deleteMemory(id) {
    if (!confirm('Delete this memory and all files?')) return;
    const { data: its } = await supabase.from('memory_items').select('file_path').eq('memory_id', id);
    if (its?.length) {
      await supabase.storage.from('memories').remove(its.map(i => i.file_path).filter(Boolean));
    }
    await supabase.from('memories').delete().eq('id', id);
    setMemories(prev => prev.filter(m => m.id !== id));
    if (active?.id === id) { setActive(null); setItems([]); setView('list'); }
  }

  async function uploadFile() {
    if (!uFile || !active) return;
    setUploading(true);
    const ext  = uFile.name.split('.').pop();
    const path = `${user.id}/${active.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('memories')
      .upload(path, uFile, { cacheControl:'3600', upsert:false });
    if (error) { alert('Upload failed: '+error.message); setUploading(false); return; }
    const { data: { signedUrl } } = await supabase.storage.from('memories')
      .createSignedUrl(path, 60*60*24*365*5);
    await supabase.from('memory_items').insert({
      memory_id: active.id, user_id: user.id,
      item_type: uFile.type.startsWith('video') ? 'video'
        : uFile.type.startsWith('audio') ? 'audio'
        : uFile.type.startsWith('image') ? 'image' : 'file',
      file_path: path, file_url: signedUrl,
      title: uTitle.trim()||uFile.name,
      metadata: { size:uFile.size, mime:uFile.type },
    });
    setUFile(null); setUTitle('');
    const { data } = await supabase.from('memory_items').select('*')
      .eq('memory_id', active.id).order('created_at', { ascending: false });
    setItems(data || []);
    setUploading(false);
  }

  async function generateAIInsights() {
    if (!memories.length || aiLoading) return;
    setAiLoading(true);
    try {
      const summary = memories.slice(0, 30).map(m =>
        `${m.event_date||'unknown'}: ${m.life_event_type} — ${m.title}. ${m.description||''}`
      ).join('\n');
      const { data: _d, error: _e } = await safeFetch('/api/ai/summary', {
        method: 'POST',
        body: JSON.stringify({
          prompt: `Analyse these life memories briefly. Return ONLY valid JSON:
${summary}
{"patterns":["string"],"highlights":["string"],"mood_summary":"string","recommendations":["string"]}`,
          type: 'memory_insights',
        }),
        token: accessToken,
      });
      if (!_e && _d) {
        const text = _d.summary||_d.result||'';
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { setAiInsights(JSON.parse(m[0])); } catch {} }
      }
    } catch {}
    setAiLoading(false);
  }

  // Filter + search
  const visible = memories.filter(m => {
    const t = filterType === 'all' || m.life_event_type === filterType;
    const s = !search.trim() || (
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      (m.description||'').toLowerCase().includes(search.toLowerCase())
    );
    return t && s;
  });

  // Group by year for timeline
  const byYear = visible.reduce((acc, m) => {
    const yr = m.event_date ? new Date(m.event_date).getFullYear() : 'Undated';
    if (!acc[yr]) acc[yr] = [];
    acc[yr].push(m);
    return acc;
  }, {});

  const inp = {
    width:'100%', background:'var(--surface)', border:'1px solid var(--border)',
    borderRadius:10, padding:'10px 14px', color:'var(--text)', fontSize:14,
    outline:'none', boxSizing:'border-box', fontFamily:'inherit',
  };

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight:'100dvh', background:'var(--bg)', paddingTop:56, paddingBottom:80,
        fontFamily:"'Inter',-apple-system,sans-serif", color:'var(--text)' }}>

        {/* ── LIST / TIMELINE ── */}
        {view === 'list' && (
          <div style={{ maxWidth:520, margin:'0 auto', padding:'20px 16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between',
              alignItems:'flex-start', marginBottom:14 }}>
              <div>
                <div style={{ fontSize:22, fontWeight:900, letterSpacing:'-0.5px' }}>🧠 Memories</div>
                <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:2 }}>
                  {memories.length} memories · AI-powered timeline
                </div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={generateAIInsights} disabled={aiLoading||!memories.length}
                  style={{ padding:'7px 12px', borderRadius:8,
                    border:'1px solid var(--primary-glow)', background:'var(--primary-dim)',
                    color:'var(--primary)', fontSize:12, fontWeight:600,
                    cursor: memories.length ? 'pointer' : 'not-allowed', fontFamily:'inherit' }}>
                  {aiLoading ? '⏳' : '✨ Insights'}
                </button>
                <button onClick={() => {
                  setForm({ title:'', description:'', life_event_type:'personal', event_date:'' });
                  setView('add');
                }} style={{ padding:'7px 14px', borderRadius:8, border:'none',
                  background:'var(--primary)', color:'#fff', fontSize:13, fontWeight:700,
                  cursor:'pointer', fontFamily:'inherit' }}>+ Add</button>
              </div>
            </div>

            {/* AI Insights */}
            {aiInsights && (
              <div style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.2)',
                borderRadius:14, padding:14, marginBottom:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between',
                  alignItems:'center', marginBottom:8 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--primary)' }}>🤖 AI Life Insights</div>
                  <button onClick={() => setAiInsights(null)}
                    style={{ background:'none', border:'none', color:'var(--text-subtle)',
                      cursor:'pointer', fontSize:18 }}>×</button>
                </div>
                {aiInsights.mood_summary && (
                  <div style={{ fontSize:13, color:'var(--text-muted)', fontStyle:'italic', marginBottom:8 }}>
                    {aiInsights.mood_summary}
                  </div>
                )}
                {aiInsights.patterns?.length > 0 && (
                  <div style={{ marginBottom:6 }}>
                    <div style={{ fontSize:9, fontWeight:700, color:'var(--text-subtle)',
                      textTransform:'uppercase', marginBottom:4 }}>PATTERNS</div>
                    {aiInsights.patterns.map((p,i) => (
                      <div key={i} style={{ fontSize:12, color:'var(--text)', marginBottom:2 }}>• {p}</div>
                    ))}
                  </div>
                )}
                {aiInsights.recommendations?.length > 0 && (
                  <div>
                    <div style={{ fontSize:9, fontWeight:700, color:'var(--text-subtle)',
                      textTransform:'uppercase', marginBottom:4 }}>SUGGESTIONS</div>
                    {aiInsights.recommendations.map((r,i) => (
                      <div key={i} style={{ fontSize:12, color:'var(--text-muted)', marginBottom:2 }}>
                        💡 {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Search */}
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Search memories…" style={{ ...inp, marginBottom:10 }} />

            {/* Type filter */}
            <div style={{ display:'flex', gap:5, marginBottom:14, overflowX:'auto', paddingBottom:4 }}>
              {['all',...LIFE_EVENTS].map(t => {
                const color = EVENT_COLOR[t]||'var(--primary)';
                return (
                  <button key={t} onClick={() => setFilterType(t)}
                    style={{ padding:'3px 10px', borderRadius:20, fontSize:10, flexShrink:0,
                      background: filterType===t ? `${color}18` : 'transparent',
                      border:`1px solid ${filterType===t ? color : 'var(--border)'}`,
                      color: filterType===t ? color : 'var(--text-muted)',
                      cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap',
                      textTransform:'capitalize' }}>
                    {t==='all' ? 'All' : `${EVENT_EMOJI[t]||'📌'} ${t}`}
                  </button>
                );
              })}
            </div>

            {loading ? (
              <div style={{ textAlign:'center', padding:'48px 0' }}>
                <div className="qk-spinner" style={{ margin:'0 auto 12px' }} />
                <div style={{ color:'var(--text-subtle)', fontSize:13 }}>Loading memories…</div>
              </div>
            ) : visible.length === 0 ? (
              <div style={{ textAlign:'center', padding:'60px 20px',
                border:'1px dashed var(--border)', borderRadius:20 }}>
                <div style={{ fontSize:52, marginBottom:16 }}>🧠</div>
                <div style={{ fontSize:16, fontWeight:700, marginBottom:6 }}>
                  {search ? 'No memories found' : 'Start capturing your life'}
                </div>
                <div style={{ fontSize:13, color:'var(--text-muted)' }}>
                  {search ? 'Try a different search' : 'Add photos, notes, and life events to your timeline'}
                </div>
              </div>
            ) : (
              Object.keys(byYear).sort((a,b) => b - a).map(yr => (
                <div key={yr} style={{ marginBottom:22 }}>
                  <div style={{ fontSize:16, fontWeight:900, color:'var(--primary)',
                    marginBottom:10, paddingLeft:8,
                    borderLeft:'3px solid var(--primary)' }}>
                    {yr}
                  </div>
                  {byYear[yr].map(m => {
                    const color     = EVENT_COLOR[m.life_event_type]||'#6366f1';
                    const emoji     = EVENT_EMOJI[m.life_event_type]||'📌';
                    const itemCount = m.memory_items?.length||0;
                    return (
                      <div key={m.id} onClick={() => openMemory(m)}
                        style={{ background:'var(--surface)',
                          border:'1px solid var(--border)',
                          borderLeft:`3px solid ${color}`,
                          borderRadius:'0 12px 12px 0', padding:'12px 14px',
                          marginBottom:8, cursor:'pointer' }}>
                        <div style={{ display:'flex', justifyContent:'space-between',
                          alignItems:'flex-start', gap:8 }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:3 }}>
                              <span style={{ fontSize:15 }}>{emoji}</span>
                              <span style={{ fontSize:14, fontWeight:700 }}>{m.title}</span>
                            </div>
                            {m.description && (
                              <div style={{ fontSize:12, color:'var(--text-muted)',
                                lineHeight:1.5, marginLeft:22 }}>
                                {m.description.slice(0,80)}{m.description.length>80?'…':''}
                              </div>
                            )}
                            <div style={{ display:'flex', gap:10, marginTop:5, marginLeft:22 }}>
                              {m.event_date && (
                                <span style={{ fontSize:10, color:'var(--text-subtle)' }}>
                                  📅 {new Date(m.event_date).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}
                                </span>
                              )}
                              {itemCount > 0 && (
                                <span style={{ fontSize:10, color:'var(--text-subtle)' }}>
                                  🖼 {itemCount}
                                </span>
                              )}
                              <span style={{ fontSize:8, fontWeight:700, padding:'1px 6px',
                                borderRadius:999, background:`${color}18`, color,
                                textTransform:'capitalize' }}>
                                {m.life_event_type}
                              </span>
                            </div>
                          </div>
                          <span style={{ color:'var(--text-subtle)', fontSize:14 }}>›</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── ADD ── */}
        {view === 'add' && (
          <div style={{ maxWidth:520, margin:'0 auto', padding:'20px 16px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
              <button onClick={() => setView('list')}
                style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--border)',
                  background:'transparent', color:'var(--text-muted)', fontSize:13,
                  cursor:'pointer', fontFamily:'inherit' }}>←</button>
              <div style={{ fontSize:18, fontWeight:800 }}>Add Memory</div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                  display:'block', marginBottom:4 }}>TITLE *</label>
                <input value={form.title}
                  onChange={e => setForm(p=>({...p,title:e.target.value}))}
                  placeholder="Give this memory a name…" style={inp} />
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                  display:'block', marginBottom:4 }}>DESCRIPTION</label>
                <textarea value={form.description} rows={3}
                  onChange={e => setForm(p=>({...p,description:e.target.value}))}
                  placeholder="What happened? How did you feel?"
                  style={{ ...inp, resize:'vertical', lineHeight:1.6 }} />
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                  display:'block', marginBottom:4 }}>DATE</label>
                <input type="date" value={form.event_date}
                  onChange={e => setForm(p=>({...p,event_date:e.target.value}))} style={inp} />
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                  display:'block', marginBottom:7 }}>TYPE</label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {LIFE_EVENTS.map(t => {
                    const color = EVENT_COLOR[t]||'#6366f1';
                    return (
                      <button key={t} onClick={() => setForm(p=>({...p,life_event_type:t}))}
                        style={{ padding:'4px 10px', borderRadius:20, fontSize:11,
                          background: form.life_event_type===t ? `${color}18` : 'transparent',
                          border:`1px solid ${form.life_event_type===t ? color : 'var(--border)'}`,
                          color: form.life_event_type===t ? color : 'var(--text-muted)',
                          cursor:'pointer', fontFamily:'inherit', textTransform:'capitalize' }}>
                        {EVENT_EMOJI[t]} {t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button onClick={createMemory} disabled={saving||!form.title.trim()}
                style={{ width:'100%', padding:'14px', borderRadius:12, border:'none',
                  background: form.title.trim() ? 'var(--primary)' : 'var(--surface-hover)',
                  color: form.title.trim() ? '#fff' : 'var(--text-subtle)',
                  fontSize:15, fontWeight:700,
                  cursor: form.title.trim() ? 'pointer' : 'not-allowed',
                  fontFamily:'inherit' }}>
                {saving ? 'Saving…' : '✓ Save Memory'}
              </button>
            </div>
          </div>
        )}

        {/* ── DETAIL ── */}
        {view === 'detail' && active && (
          <div style={{ maxWidth:520, margin:'0 auto', padding:'20px 16px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
              <button onClick={() => setView('list')}
                style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--border)',
                  background:'transparent', color:'var(--text-muted)', fontSize:13,
                  cursor:'pointer', fontFamily:'inherit' }}>←</button>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:16, fontWeight:800 }}>
                  {EVENT_EMOJI[active.life_event_type]} {active.title}
                </div>
                {active.event_date && (
                  <div style={{ fontSize:11, color:'var(--text-subtle)', marginTop:2 }}>
                    {new Date(active.event_date).toLocaleDateString('en-IN',{
                      weekday:'long', day:'numeric', month:'long', year:'numeric',
                    })}
                  </div>
                )}
              </div>
              <button onClick={() => deleteMemory(active.id)}
                style={{ padding:'7px 10px', borderRadius:8,
                  border:'1px solid rgba(239,68,68,0.2)', background:'rgba(239,68,68,0.05)',
                  color:'#ef4444', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>🗑</button>
            </div>

            {active.description && (
              <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:12, padding:14, marginBottom:14, fontSize:14,
                color:'var(--text-muted)', lineHeight:1.7 }}>
                {active.description}
              </div>
            )}

            {/* Image grid */}
            {items.filter(i => i.item_type === 'image').length > 0 && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)',
                gap:6, marginBottom:14 }}>
                {items.filter(i => i.item_type === 'image').map(item => (
                  <div key={item.id} style={{ aspectRatio:'1', borderRadius:10,
                    overflow:'hidden', background:'var(--surface)' }}>
                    <img src={item.file_url} alt={item.title}
                      style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                  </div>
                ))}
              </div>
            )}

            {/* Other media */}
            {items.filter(i => i.item_type !== 'image').map(item => (
              <div key={item.id} style={{ background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:12, padding:'12px 14px', marginBottom:8,
                display:'flex', alignItems:'center', gap:12 }}>
                <span style={{ fontSize:24 }}>
                  {item.item_type==='video'?'🎬':item.item_type==='audio'?'🎵':'📎'}
                </span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{item.title}</div>
                  {item.item_type === 'audio' && (
                    <audio controls src={item.file_url} style={{ width:'100%', marginTop:6 }} />
                  )}
                  {item.item_type === 'video' && (
                    <a href={item.file_url} target="_blank" rel="noopener"
                      style={{ fontSize:12, color:'var(--primary)' }}>View video →</a>
                  )}
                </div>
              </div>
            ))}

            {/* Upload */}
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:14, padding:14, marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-subtle)',
                textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>
                📎 Add Photo / Video / Audio
              </div>
              <input value={uTitle} onChange={e => setUTitle(e.target.value)}
                placeholder="Caption (optional)" style={{ ...inp, marginBottom:8, fontSize:12 }} />
              <input type="file" ref={fileRef} accept="image/*,video/*,audio/*"
                onChange={e => setUFile(e.target.files?.[0]||null)}
                style={{ display:'none' }} />
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => fileRef.current?.click()}
                  style={{ flex:1, padding:'9px', borderRadius:8,
                    border:'1px dashed var(--border)', background:'transparent',
                    color:'var(--text-muted)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
                  {uFile ? `✓ ${uFile.name.slice(0,22)}…` : '📷 Choose file'}
                </button>
                {uFile && (
                  <button onClick={uploadFile} disabled={uploading}
                    style={{ padding:'9px 16px', borderRadius:8, border:'none',
                      background:'var(--primary)', color:'#fff', fontSize:13, fontWeight:700,
                      cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>
                    {uploading ? '⏳' : '↑ Upload'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
