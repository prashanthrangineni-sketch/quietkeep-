'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const RELATIONS = ['Spouse','Father','Mother','Sibling','Child','Grandparent','Other'];

export default function Family() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeMember, setActiveMember] = useState(null);
  const [activeTab, setActiveTab] = useState('health');
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [newMember, setNewMember] = useState({ name: '', relation: 'Father', dob: '', avatar: '\u{1F474}', phone: '', blood_group: '' });

  const AVATARS = ['\u{1F474}', '\u{1F475}', '\u{1F9D1}', '\u{1F468}', '\u{1F469}', '\u{1F466}', '\u{1F467}'];

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2800);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      await loadMembers(session.user.id);
      setLoading(false);
    });
  }, [router]);

  async function loadMembers(uid) {
    const { data } = await supabase
      .from('family_profiles')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });
    if (data && data.length > 0) {
      setMembers(data);
      setActiveMember(data[0]);
    }
  }

  async function handleAddMember() {
    if (!newMember.name.trim() || !user) { return; }
    setSaving(true);
    const { data, error } = await supabase.from('family_profiles').insert([{
      user_id: user.id,
      name: newMember.name.trim(),
      relation: newMember.relation,
      dob: newMember.dob || null,
      avatar: newMember.avatar,
      phone: newMember.phone || null,
      blood_group: newMember.blood_group || null,
    }]).select().single();
    if (!error && data) {
      const updated = [...members, data];
      setMembers(updated);
      setActiveMember(data);
      setShowAddForm(false);
      setNewMember({ name: '', relation: 'Father', dob: '', avatar: '\u{1F474}', phone: '', blood_group: '' });
      showToast('Family member added successfuly');
  }

  const card = { backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '12px' };
  const inp = { width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '10px 12px', color: '#f1f5f9', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };

  function getAge(dob) {
    if (!dob) { return ''; }
    const years = Math.floor((new Date() - new Date(dob)) / (365.25 * 24 * 60 * 60 * 1000));
    return years + ' yrs';
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
        <div style={{ width: '36px', height: '36px', border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ color: '#475569', fontSize: '13px' }}>Loading...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '70px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1e1e2e', border: '1px solid #6366f1', borderRadius: '10px', padding: '10px 20px', color: '#f1f5f9', fontSize: '14px', zIndex: 9999, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      <div style={{ borderBottom: '1px solid #1e1e2e', padding: '10px 16px', backgroundColor: 'rgba(10,10,15,0.98)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: '700', fontSize: '14px', color: '#6366f1' }}>Family</span>
        <a href="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '12px' }}>&larr; Dashboard</a>
      </div>

      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '20px 16px' }}>

        <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px', marginBottom: '20px' }}>
          {members.map(m => {
            const isActive = activeMember?.id === m.id;
            return (
              <button key={m.id} onClick={() => setActiveMember(m)} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '12px 16px', borderRadius: '14px', border: '2px solid ' + (isActive ? '#6366f1' : '#1e293b'), backgroundColor: isActive ? 'rgba(99,102,241,0.1)' : '#0f0f1a', cursor: 'pointer', minWidth: '80px' }}>
                <span style={{ fontSize: '28px' }}>{m.avatar || '\u{1F9D1}'}</span>
                <span style={{ fontSize: '12px', fontWeight: '700', color: isActive ? '#a5b4fc' : '#94a3b8' }}>{m.name.split(' ')[0]}</span>
                <span style={{ fontSize: '10px', color: '#475569' }}>{m.relation}</span>
              </button>
            );
          })}
          <button onClick={() => setShowAddForm(v => !v)} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '12px 16px', borderRadius: '14px', border: '2px dashed #1e293b', backgroundColor: '#0f0f1a', cursor: 'pointer', minWidth: '80px', color: '#475569' }}>
            <span style={{ fontSize: '22px' }}>+</span>
            <span style={{ fontSize: '11px' }}>Add</span>
          </button>
        </div>

        {showAddForm && (
          <div style={{ ...card, border: '1px solid #6366f150', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Add Family Member</h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {AVATARS.map(av => (
                <button key={av} onClick={() => setNewMember(m => ({ ...m, avatar: av }))} style={{ fontSize: '22px', padding: '6px', border: '2px solid ' + (newMember.avatar === av ? '#6366f1' : '#1e293b'), borderRadius: '8px', background: 'none', cursor: 'pointer' }}>{av}</button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input placeholder="Full name *" value={newMember.name} onChange={e => setNewMember(m => ({ ...m, name: e.target.value }))} style={inp} />
              <select value={newMember.relation} onChange={e => setNewMember(m => ({ ...m, relation: e.target.value }))} style={inp}>
                {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <div>
                <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '4px' }}>Date of Birth</label>
                <input type="date" value={newMember.dob} onChange={e => setNewMember(m => ({ ...m, dob: e.target.value }))} style={inp} />
              </div>
              <input placeholder="Phone number" value={newMember.phone} onChange={e => setNewMember(m => ({ ...m, phone: e.target.value }))} style={inp} />
              <select value={newMember.blood_group} onChange={e => setNewMember(m => ({ ...m, blood_group: e.target.value }))} style={inp}>
                <option value="">Blood Group</option>
                {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleAddMember} disabled={saving || !newMember.name.trim()} style={{ flex: 1, backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  {saving ? 'Saving...' : 'Add Member'}
                </button>
                <button onClick={() => setShowAddForm(false)} style={{ padding: '10px 16px', backgroundColor: 'transparent', border: '1px solid #1e293b', color: '#64748b', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {activeMember ? (
          <>
            <div style={{ ...card, textAlign: 'center', border: '1px solid #6366f130' }}>
              <div style={{ fontSize: '48px', marginBottom: '8px' }}>{activeMember.avatar || '\u{1F9D1}'}</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#f1f5f9' }}>{activeMember.name}</div>
              <div style={{ fontSize: '13px', color: '#6366f1', fontWeight: '600', marginTop: '4px' }}>{activeMember.relation}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '8px' }}>
                {activeMember.dob && <span style={{ fontSize: '12px', color: '#64748b' }}>{getAge(activeMember.dob)} old</span>}
                {activeMember.blood_group && <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '20px', backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', fontWeight: '700' }}>{activeMember.blood_group}</span>}
                {activeMember.phone && <span style={{ fontSize: '12px', color: '#64748b' }}>{activeMember.phone}</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', backgroundColor: '#0f0f1a', padding: '4px', borderRadius: '10px', border: '1px solid #1e1e2e' }}>
              {[{ id: 'health', label: 'Health' }, { id: 'finance', label: 'Finance' }, { id: 'docs', label: 'Docs' }, { id: 'emergency', label: 'Emergency' }].map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, padding: '7px 4px', borderRadius: '7px', border: 'none', cursor: 'pointer', backgroundColor: activeTab === t.id ? '#6366f1' : 'transparent', color: activeTab === t.id ? '#fff' : '#64748b', fontSize: '12px', fontWeight: '600' }}>
                  {t.label}
                </button>
              ))}
            </div>

            {activeTab === 'health' && (
              <div style={card}>
                <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Health & Insurance</h3>
                {[
                  { label: 'Health Insurance', hint: 'Policy details, renewal date', icon: '\u{1F3E5}' },
                  { label: 'Medical Records', hint: 'Reports, prescriptions', icon: '\u{1F4CB}' },
                  { label: 'Regular Doctors', hint: 'Primary care contacts', icon: '\u{1F469}\u{200D}\u{2695}\u{FE0F}' },
                  { label: 'Medications', hint: 'Daily medicines and doses', icon: '\u{1F48A}' },
                  { label: 'Family History', hint: 'Hereditary conditions', icon: '\u{1F9EC}' },
                ].map((item, i, arr) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid #1a1a2e' : 'none' }}>
                    <span style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>{item.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{item.label}</div>
                      <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>{item.hint}</div>
                    </div>
                    <span style={{ color: '#334155', fontSize: '16px' }}>&rsaquo;</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'finance' && (
              <div style={card}>
                <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Finance & Legal</h3>
                {[
                  { label: 'Bank Accounts', hint: 'Account details and nominees', icon: '\u{1F3E6}' },
                  { label: 'Investments', hint: 'Mutual funds, stocks, FDs', icon: '\u{1F4C8}' },
                  { label: 'Property Documents', hint: 'Land, house documents', icon: '\u{1F3E0}' },
                  { label: 'Will & Nominations', hint: 'Legal succession documents', icon: '\u{1F4DC}' },
                  { label: 'Loans & EMIs', hint: 'Active loans and repayment', icon: '\u{1F4B0}' },
                ].map((item, i, arr) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid #1a1a2e' : 'none' }}>
                    <span style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>{item.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{item.label}</div>
                      <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>{item.hint}</div>
                    </div>
                    <span style={{ color: '#334155', fontSize: '16px' }}>&rsaquo;</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'docs' && (
              <div style={card}>
                <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Documents</h3>
                {[
                  { label: 'Aadhar Card', icon: '\u{1F4F1}' },
                  { label: 'PAN Card', icon: '\u{1F4B3}' },
                  { label: 'Passport', icon: '\u{1F6C2}' },
                  { label: 'Driving Licence', icon: '\u{1F697}' },
                  { label: 'Voter ID', icon: '\u{1F5F3}\u{FE0F}' },
                  { label: 'Ration Card', icon: '\u{1F4C4}' },
                ].map((item, i, arr) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid #1a1a2e' : 'none' }}>
                    <span style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>{item.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{item.label}</div>
                    </div>
                    <div style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', backgroundColor: 'rgba(100,116,139,0.1)', color: '#64748b', border: '1px solid #1e293b' }}>Add</div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'emergency' && (
              <>
                <div style={card}>
                  <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#ef4444', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Emergency Info</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {activeMember.phone && (
                      <a href={'tel:' + activeMember.phone} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: 'rgba(34,197,94,0.05)', borderRadius: '10px', border: '1px solid rgba(34,197,94,0.2)', textDecoration: 'none' }}>
                        <span style={{ fontSize: '20px' }}>{'\u{1F4DE}'}</span>
                        <div>
                          <div style={{ fontSize: '12px', color: '#22c55e', fontWeight: '700' }}>Call {activeMember.name.split(' ')[0]}</div>
                          <div style={{ fontSize: '13px', color: '#f1f5f9' }}>{activeMember.phone}</div>
                        </div>
                      </a>
                    )}
                    {activeMember.blood_group && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: 'rgba(239,68,68,0.05)', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)' }}>
                        <span style={{ fontSize: '20px' }}>{'\u{1FA78}'}</span>
                        <div>
                          <div style={{ fontSize: '12px', color: '#ef4444', fontWeight: '700' }}>Blood Group</div>
                          <div style={{ fontSize: '16px', color: '#f1f5f9', fontWeight: '800' }}>{activeMember.blood_group}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div style={card}>
                  <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Important Dates</h3>
                  {[
                    { label: 'Birthday', hint: activeMember.dob ? new Date(activeMember.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : 'Not set', icon: '\u{1F382}' },
                    { label: 'Anniversary', hint: 'Add anniversary date', icon: '\u{1F48D}' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < 1 ? '1px solid #1a1a2e' : 'none' }}>
                      <span style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{item.label}</div>
                        <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>{item.hint}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '60px 24px', border: '1px dashed #1e293b', borderRadius: '14px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>{'\u{1F46A}'}</div>
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#94a3b8', marginBottom: '8px' }}>No family members yet</div>
            <div style={{ fontSize: '13px', color: '#475569', marginBottom: '20px' }}>Add family members to manage their health, documents and more</div>
            <button onClick={() => setShowAddForm(true)} style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Add Member</button>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
