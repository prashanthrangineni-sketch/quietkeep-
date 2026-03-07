'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function KidsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [kids, setKids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({name:'', dob:'', school:'', blood_group:'', allergies:''});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadKids();
  }, []);

  const loadKids = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        const { data } = await supabase.from('kids_profiles').select('*').eq('user_id', session.user.id);
        setKids(data || []);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddKid = async () => {
    if (!formData.name.trim()) {
      alert('Enter name');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.from('kids_profiles').insert({
        user_id: user.id,
        name: formData.name,
        dob: formData.dob || null,
        school: formData.school || null,
        blood_group: formData.blood_group || null,
        allergies: formData.allergies || null,
      }).select().single();

      if (error) throw error;
      setKids([...kids, data]);
      setFormData({name:'', dob:'', school:'', blood_group:'', allergies:''});
      setShowForm(false);
      alert('Kid profile added!');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKid = async (id) => {
    try {
      await supabase.from('kids_profiles').delete().eq('id', id);
      setKids(kids.filter(k => k.id !== id));
    } catch (error) {
      alert('Error deleting');
    }
  };

  if (loading) return <div style={{padding:'20px', textAlign:'center', color:'#94a3b8', minHeight:'100vh', backgroundColor:'#0a0a0f'}}>Loading...</div>;

  return (
    <div style={{minHeight:'100vh', backgroundColor:'#0a0a0f', color:'#f1f5f9', padding:'20px'}}>
      <div style={{maxWidth:'600px', margin:'0 auto'}}>
        <div style={{marginBottom:'20px', display:'flex', justifyContent:'space-between'}}>
          <h1 style={{fontSize:'28px', fontWeight:'800', margin:0}}>👧 Kids</h1>
          <button onClick={() => router.push('/profile')} style={{backgroundColor:'#6366f1', color:'#fff', border:'none', padding:'8px 16px', borderRadius:'6px', cursor:'pointer', fontSize:'12px'}}>← Back</button>
        </div>

        {kids.length > 0 && (
          <div style={{marginBottom:'24px'}}>
            {kids.map(kid => (
              <div key={kid.id} style={{backgroundColor:'#0f0f1a', border:'1px solid #1e293b', borderRadius:'10px', padding:'14px', marginBottom:'8px'}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                  <div style={{fontSize:'13px', fontWeight:'600'}}>{kid.name}</div>
                  <button onClick={() => handleDeleteKid(kid.id)} style={{backgroundColor:'transparent', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'12px'}}>Delete</button>
                </div>
                {kid.dob && <div style={{fontSize:'11px', color:'#94a3b8'}}>DOB: {new Date(kid.dob).toLocaleDateString('en-IN')}</div>}
                {kid.blood_group && <div style={{fontSize:'11px', color:'#94a3b8'}}>Blood: {kid.blood_group}</div>}
              </div>
            ))}
          </div>
        )}

        <button onClick={() => setShowForm(!showForm)} style={{width:'100%', backgroundColor:'#6366f1', color:'#fff', border:'none', padding:'12px', borderRadius:'8px', cursor:'pointer', fontSize:'14px', fontWeight:'600', marginBottom:'16px'}}>+ Add Kid Profile</button>

        {showForm && (
          <div style={{backgroundColor:'#0f0f1a', border:'1px solid #1e293b', borderRadius:'14px', padding:'16px'}}>
            <input type="text" placeholder="Name" value={formData.name} onChange={(e) => setFormData({...formData, name:e.target.value})} style={{width:'100%', padding:'10px', marginBottom:'10px', backgroundColor:'#1a1a2e', border:'1px solid #334155', color:'#f1f5f9', borderRadius:'8px', fontSize:'13px', boxSizing:'border-box'}} />
            <input type="date" value={formData.dob} onChange={(e) => setFormData({...formData, dob:e.target.value})} style={{width:'100%', padding:'10px', marginBottom:'10px', backgroundColor:'#1a1a2e', border:'1px solid #334155', color:'#f1f5f9', borderRadius:'8px', fontSize:'13px', boxSizing:'border-box'}} />
            <input type="text" placeholder="School (optional)" value={formData.school} onChange={(e) => setFormData({...formData, school:e.target.value})} style={{width:'100%', padding:'10px', marginBottom:'10px', backgroundColor:'#1a1a2e', border:'1px solid #334155', color:'#f1f5f9', borderRadius:'8px', fontSize:'13px', boxSizing:'border-box'}} />
            <input type="text" placeholder="Blood Group (optional)" value={formData.blood_group} onChange={(e) => setFormData({...formData, blood_group:e.target.value})} style={{width:'100%', padding:'10px', marginBottom:'10px', backgroundColor:'#1a1a2e', border:'1px solid #334155', color:'#f1f5f9', borderRadius:'8px', fontSize:'13px', boxSizing:'border-box'}} />
            <div style={{display:'flex', gap:'8px'}}>
              <button onClick={handleAddKid} disabled={saving} style={{flex:1, backgroundColor:'#6366f1', color:'#fff', border:'none', padding:'10px', borderRadius:'6px', cursor:'pointer', fontSize:'12px', fontWeight:'600'}}>
                {saving ? 'Saving...' : 'Add'}
              </button>
              <button onClick={() => setShowForm(false)} style={{flex:1, backgroundColor:'#1a1a2e', color:'#94a3b8', border:'1px solid #334155', padding:'10px', borderRadius:'6px', cursor:'pointer', fontSize:'12px'}}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
