'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';

const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const inp = { width:'100%', background:'#111', border:'1px solid #333', borderRadius:8, color:'#fff', padding:'0.6rem 0.75rem', fontSize:'0.88rem', outline:'none', boxSizing:'border-box' };
const btn1 = { padding:'0.6rem 1.2rem', borderRadius:8, border:'none', background:'#6366f1', color:'#fff', fontSize:'0.88rem', fontWeight:600, cursor:'pointer' };
const btn0 = { ...btn1, background:'transparent', border:'1px solid #333', color:'#aaa' };
const SC = { pending:'#f59e0b', active:'#22c55e', rejected:'#ef4444' };

export default function FamilyPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [sharedKeeps, setSharedKeeps] = useState([]);
  const [tab, setTab] = useState('members');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login'; return; }
    setUser(user);
    const [ownedRes, memberRes] = await Promise.all([
      supabase.from('family_members').select('*').eq('owner_user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('family_members').select('*').eq('member_user_id', user.id),
    ]);
    const all = [...(ownedRes.data || []), ...(memberRes.data || [])];
    const seen = new Set();
    const deduped = all.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
    setMembers(deduped);
    const memberUids = (ownedRes.data || []).map(m => m.member_user_id).filter(Boolean);
    if (memberUids.length > 0) {
      const { data: keeps } = await supabase.from('keeps').select('*').in('user_id', [user.id, ...memberUids]).eq('status', 'open').order('created_at', { ascending: false }).limit(20);
      setSharedKeeps(keeps || []);
    }
    setLoading(false);
  }

  async function inviteMember() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    const { data, error } = await supabase.from('family_members').insert({ owner_user_id: user.id, member_email: inviteEmail.trim(), role: inviteRole, status: 'pending' }).select().single();
    if (!error && data) {
      setMembers(p => [data, ...p]);
      await supabase.from('audit_log').insert({ user_id: user.id, action: 'family_member_invited', service: 'family', details: { email: inviteEmail, role: inviteRole } });
    }
    setInviteEmail(''); setInviting(false); setShowInvite(false);
  }

  async function removeMember(id) {
    await supabase.from('family_members').delete().eq('id', id);
    setMembers(p => p.filter(m => m.id !== id));
    await supabase.from('audit_log').insert({ user_id: user.id, action: 'family_member_removed', service: 'family', details: { member_id: id } });
  }

  if (loading) return (<div style={{ minHeight:'100vh', background:'#0f0f0f', display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ color:'#6366f1' }}>Loading Family…</div></div>);

  return (
    <div style={{ minHeight:'100vh', background:'#0f0f0f', color:'#fff' }}>
      <NavbarClient />
      <div style={{ maxWidth:680, margin:'0 auto', padding:'1.5rem 1rem 4rem' }}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1.5rem' }}>
          <div>
            <h1 style={{ fontSize:'1.4rem', fontWeight:700, marginBottom:4 }}>Family</h1>
            <p style={{ color:'#555', fontSize:'0.85rem' }}>Share keeps and manage your family circle</p>
          </div>
          <button onClick={() => setShowInvite(!showInvite)} style={btn1}>+ Invite</button>
        </div>

        {showInvite && (
          <div style={{ background:'#1a1a1a', border:'1px solid #333', borderRadius:12, padding:'1.2rem', marginBottom:'1.5rem' }}>
            <h3 style={{ color:'#fff', fontSize:'0.9rem', marginBottom:'1rem' }}>Invite Family Member</h3>
            <div style={{ marginBottom:'0.75rem' }}><label style={{ color:'#aaa', fontSize:'0.78rem', display:'block', marginBottom:4 }}>Email</label><input style={inp} type="email" placeholder="family@example.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></div>
            <div style={{ marginBottom:'0.75rem' }}><label style={{ color:'#aaa', fontSize:'0.78rem', display:'block', marginBottom:4 }}>Role</label>
              <select style={inp} value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                {['member','admin','viewer'].map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
              </select>
            </div>
            <div style={{ background:'#111', borderRadius:8, padding:'0.6rem 0.8rem', marginBottom:'0.75rem', fontSize:'0.8rem', color:'#666' }}>📧 An invite will be sent to their email.</div>
            <div style={{ display:'flex', gap:'0.5rem' }}>
              <button onClick={inviteMember} disabled={inviting} style={btn1}>{inviting ? 'Inviting…' : 'Send Invite'}</button>
              <button onClick={() => setShowInvite(false)} style={btn0}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1.5rem', background:'#1a1a1a', borderRadius:10, padding:4 }}>
          {['members','shared keeps'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex:1, padding:'0.55rem', borderRadius:8, border:'none', background:tab===t?'#6366f1':'transparent', color:tab===t?'#fff':'#666', fontSize:'0.85rem', fontWeight:600, cursor:'pointer', textTransform:'capitalize' }}>{t}</button>
          ))}
        </div>

        {tab === 'members' && (
          members.length === 0
            ? <div style={{ textAlign:'center', padding:'3rem', color:'#444' }}><div style={{ fontSize:'2.5rem', marginBottom:'0.75rem' }}>👨‍👩‍👧</div><div>No family members yet. Invite someone.</div></div>
            : members.map(m => (
              <div key={m.id} style={{ background:'#1a1a1a', border:'1px solid #222', borderRadius:10, padding:'1rem', marginBottom:'0.5rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ color:'#fff', fontWeight:500, fontSize:'0.9rem' }}>{m.member_email}</div>
                  <div style={{ display:'flex', gap:'0.5rem', marginTop:4 }}>
                    <span style={{ background:'#222', borderRadius:4, padding:'2px 8px', fontSize:'0.75rem', color:'#aaa', textTransform:'capitalize' }}>{m.role}</span>
                    <span style={{ background:(SC[m.status]||'#666')+'22', borderRadius:4, padding:'2px 8px', fontSize:'0.75rem', color:SC[m.status]||'#666', textTransform:'capitalize' }}>{m.status}</span>
                  </div>
                </div>
                {m.owner_user_id === user.id && (
                  <button onClick={() => removeMember(m.id)} style={{ background:'none', border:'1px solid #333', borderRadius:6, color:'#ef4444', padding:'4px 10px', cursor:'pointer', fontSize:'0.8rem' }}>Remove</button>
                )}
              </div>
            ))
        )}

        {tab === 'shared keeps' && (
          sharedKeeps.length === 0
            ? <div style={{ textAlign:'center', padding:'3rem', color:'#444' }}>Add family members to see shared keeps.</div>
            : sharedKeeps.map(k => (
              <div key={k.id} style={{ background:'#1a1a1a', border:'1px solid #222', borderRadius:10, padding:'1rem', marginBottom:'0.5rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div style={{ color:'#fff', fontSize:'0.9rem', flex:1 }}>{k.content}</div>
                  <span style={{ background:'#6366f122', color:'#6366f1', borderRadius:4, padding:'2px 8px', fontSize:'0.75rem', marginLeft:8 }}>{k.intent_type}</span>
                </div>
                {k.reminder_at && <div style={{ color:'#f59e0b', fontSize:'0.78rem', marginTop:4 }}>⏰ {new Date(k.reminder_at).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' })}</div>}
                <div style={{ color:'#444', fontSize:'0.75rem', marginTop:4 }}>{k.user_id === user.id ? 'You' : 'Family'} · {new Date(k.created_at).toLocaleDateString('en-IN')}</div>
              </div>
            ))
        )}

      </div>
    </div>
  );
}
