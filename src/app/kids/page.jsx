'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';

const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const inp = { width:'100%', background:'#111', border:'1px solid #333', borderRadius:8, color:'#fff', padding:'0.6rem 0.75rem', fontSize:'0.88rem', outline:'none', boxSizing:'border-box' };
const btn1 = { padding:'0.6rem 1.2rem', borderRadius:8, border:'none', background:'#6366f1', color:'#fff', fontSize:'0.88rem', fontWeight:600, cursor:'pointer' };
const btn0 = { ...btn1, background:'transparent', border:'1px solid #333', color:'#aaa' };
const AE = { '3-5':'🧒', '6-8':'👦', '9-12':'🧑', '13+':'👨‍🎓' };
const calcAge = dob => dob ? Math.floor((Date.now() - new Date(dob)) / (1000*60*60*24*365.25)) : null;
const ageGroup = a => !a ? '6-8' : a <= 5 ? '3-5' : a <= 8 ? '6-8' : a <= 12 ? '9-12' : '13+';

export default function KidsPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kids, setKids] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [school, setSchool] = useState('');
  const [blood, setBlood] = useState('');
  const [doctor, setDoctor] = useState('');
  const [allergies, setAllergies] = useState('');

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login'; return; }
    setUser(user);
    const { data } = await supabase.from('kids_profiles').select('*').eq('user_id', user.id).order('created_at', { ascending: true });
    setKids(data || []);
    setLoading(false);
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
  }

  if (loading) return (<div style={{ minHeight:'100vh', background:'#0f0f0f', display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ color:'#6366f1' }}>Loading Kids…</div></div>);

  return (
    <div style={{ minHeight:'100vh', background:'#0f0f0f', color:'#fff' }}>
      <NavbarClient />
      <div style={{ maxWidth:680, margin:'0 auto', padding:'1.5rem 1rem 4rem' }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1.5rem' }}>
          <div>
            <h1 style={{ fontSize:'1.4rem', fontWeight:700, marginBottom:4 }}>Kids Safe Zone</h1>
            <p style={{ color:'#555', fontSize:'0.85rem' }}>Manage your children's profiles</p>
          </div>
          <button onClick={() => { resetForm(); setShowForm(!showForm); }} style={btn1}>{showForm ? 'Cancel' : '+ Add Child'}</button>
        </div>

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

        {kids.length === 0 && !showForm
          ? <div style={{ textAlign:'center', padding:'4rem 2rem', color:'#444' }}><div style={{ fontSize:'3rem', marginBottom:'0.75rem' }}>👶</div><div>No child profiles yet. Add your first.</div></div>
          : <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:'1rem' }}>
              {kids.map(kid => {
                const age = calcAge(kid.dob);
                const grp = ageGroup(age);
                return (
                  <div key={kid.id} style={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:14, padding:'1.2rem' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1rem' }}>
                      <div style={{ width:48, height:48, borderRadius:'50%', background:'#6366f122', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.6rem' }}>{AE[grp]}</div>
                      <div>
                        <div style={{ color:'#fff', fontWeight:600, fontSize:'1rem' }}>{kid.name}</div>
                        <div style={{ color:'#666', fontSize:'0.78rem' }}>{age !== null ? `${age} yrs` : 'Age not set'} · {grp}</div>
                      </div>
                    </div>
                    {[['🏫', kid.school], ['🩸', kid.blood_group], ['👨‍⚕️', kid.doctor_name], kid.allergies && ['⚠️', kid.allergies]].filter(Boolean).map(([icon, val], i) => val && (
                      <div key={i} style={{ display:'flex', gap:'0.5rem', marginBottom:'0.4rem', fontSize:'0.82rem' }}>
                        <span>{icon}</span><span style={{ color: icon==='⚠️' ? '#f59e0b' : '#888' }}>{val}</span>
                      </div>
                    ))}
                    <div style={{ display:'flex', gap:'0.5rem', marginTop:'1rem', paddingTop:'0.75rem', borderTop:'1px solid #222' }}>
                      <button onClick={() => startEdit(kid)} style={{ ...btn0, flex:1, padding:'0.5rem', fontSize:'0.8rem' }}>Edit</button>
                      <button onClick={() => deleteKid(kid.id)} style={{ padding:'0.5rem 0.75rem', borderRadius:8, border:'1px solid #ef444433', background:'transparent', color:'#ef4444', cursor:'pointer', fontSize:'0.8rem' }}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
        }

        {kids.length > 0 && <div style={{ background:'#6366f108', border:'1px solid #6366f122', borderRadius:10, padding:'0.9rem', marginTop:'1.5rem', fontSize:'0.82rem', color:'#6366f1' }}>🔒 Kids profiles are private and visible only to you.</div>}

      </div>
    </div>
  );
}
