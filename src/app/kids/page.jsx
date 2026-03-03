'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const AGE_GROUPS = [
  { min: 0, max: 2, label: 'Infant', color: '#f59e0b' },
  { min: 3, max: 5, label: 'Toddler', color: '#10b981' },
  { min: 6, max: 12, label: 'Child', color: '#6366f1' },
  { min: 13, max: 17, label: 'Teen', color: '#8b5cf6' },
];

function getAgeGroup(dob) {
  if (!dob) { return null; }
  const years = Math.floor((new Date() - new Date(dob)) / (365.25 * 24 * 60 * 60 * 1000));
  return AGE_GROUPS.find(g => years >= g.min && years <= g.max) || { label: years + ' yrs', color: '#64748b' };
}

function getAge(dob) {
  if (!dob) { return ''; }
  const years = Math.floor((new Date() - new Date(dob)) / (365.25 * 24 * 60 * 60 * 1000));
  const months = Math.floor((new Date() - new Date(dob)) / (30.44 * 24 * 60 * 60 * 1000)) % 12;
  if (years === 0) { return months + 'm'; }
  return years + ' yrs';
}

export default function Kids() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [kids, setKids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeKid, setActiveKid] = useState(null);
  const [activeTab, setActiveTab] = useState('health');
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [newKid, setNewKid] = useState({ name: '', dob: '', avatar: '\u{1F467}', school: '', blood_group: '' });

  const AVATARS = ['\u{1F466}', '\u{1F467}', '\u{1F9D2}', '\u{1F476}'];

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2800);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      await loadKids(session.user.id);
      setLoading(false);
    });
  }, [router]);

  async function loadKids(uid) {
    const { data } = await supabase
      .from('kids_profiles')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });
    if (data && data.length > 0) {
      setKids(data);
      setActiveKid(data[0]);
    }
  }

  async function handleAddKid() {
    if (!newKid.name.trim() || !user) { return; }
    setSaving(true);
    const { data, error } = await supabase.from('kids_profiles').insert([{
      user_id: user.id,
      name: newKid.name.trim(),
      dob: newKid.dob || null,
      avatar: newKid.avatar,
      school: newKid.school || null,
      blood_group: newKid.blood_group || null,
    }]).select().single();
    if (!error && data) {
      const updated = [...kids, data];
      setKids(updated);
      setActiveKid(data);
      setShowAddForm(false);
      setNewKid({ name: '', dob: '', avatar: '\u{1F467}', school: '', blood_group: '' });
      showToast('Child profile added');
    }
    setSaving(false);
  }

  const card = { backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '12px' };
  const inp = { width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '10px 12px', color: '#f1f5f9', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };

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
        <span style={{ fontWeight: '700', fontSize: '14px', color: '#6366f1' }}>Kids Safe Zone</span>
        <a href="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '12px' }}>&larr; Dashboard</a>
      </div>

      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '20px 16px' }}>

        <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px', marginBottom: '20px' }}>
          {kids.map(kid => {
            const ag = getAgeGroup(kid.dob);
            const isActive = activeKid?.id === kid.id;
            return (
              <button key={kid.id} onClick={() => setActiveKid(kid)} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '12px 16px', borderRadius: '14px', border: '2px solid ' + (isActive ? '#6366f1' : '#1e293b'), backgroundColor: isActive ? 'rgba(99,102,241,0.1)' : '#0f0f1a', cursor: 'pointer', minWidth: '80px' }}>
                <span style={{ fontSize: '28px' }}>{kid.avatar || '\u{1F467}'}</span>
                <span style={{ fontSize: '12px', fontWeight: '700', color: isActive ? '#a5b4fc' : '#94a3b8' }}>{kid.name.split(' ')[0]}</span>
                {kid.dob && <span style={{ fontSize: '10px', color: ag?.color || '#64748b' }}>{getAge(kid.dob)}</span>}
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
            <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Add Child Profile</h3>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              {AVATARS.map(av => (
                <button key={av} onClick={() => setNewKid(k => ({ ...k, avatar: av }))} style={{ fontSize: '22px', padding: '6px', border: '2px solid ' + (newKid.avatar === av ? '#6366f1' : '#1e293b'), borderRadius: '8px', background: 'none', cursor: 'pointer' }}>{av}</button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input placeholder="Child's name *" value={newKid.name} onChange={e => setNewKid(k => ({ ...k, name: e.target.value }))} style={inp} />
              <div>
                <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '4px' }}>Date of Birth</label>
                <input type="date" value={newKid.dob} onChange={e => setNewKid(k => ({ ...k, dob: e.target.value }))} style={inp} />
              </div>
              <input placeholder="School name" value={newKid.school} onChange={e => setNewKid(k => ({ ...k, school: e.target.value }))} style={inp} />
              <select value={newKid.blood_group} onChange={e => setNewKid(k => ({ ...k, blood_group: e.target.value }))} style={inp}>
                <option value="">Blood Group</option>
                {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleAddKid} disabled={saving || !newKid.name.trim()} style={{ flex: 1, backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  {saving ? 'Saving...' : 'Add Child'}
                </button>
                <button onClick={() => setShowAddForm(false)} style={{ padding: '10px 16px', backgroundColor: 'transparent', border: '1px solid #1e293b', color: '#64748b', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {activeKid ? (
          <>
            <div style={{ ...card, textAlign: 'center', border: '1px solid #6366f130' }}>
              <div style={{ fontSize: '48px', marginBottom: '8px' }}>{activeKid.avatar || '\u{1F467}'}</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#f1f5f9' }}>{activeKid.name}</div>
              {activeKid.dob && (
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                  {getAge(activeKid.dob)} old &nbsp;&bull;&nbsp; Born {new Date(activeKid.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              )}
              {activeKid.blood_group && (
                <div style={{ display: 'inline-block', marginTop: '8px', padding: '3px 12px', borderRadius: '20px', backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: '12px', fontWeight: '700', border: '1px solid rgba(239,68,68,0.3)' }}>
                  {activeKid.blood_group}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', backgroundColor: '#0f0f1a', padding: '4px', borderRadius: '10px', border: '1px solid #1e1e2e' }}>
              {[{ id: 'health', label: 'Health' }, { id: 'school', label: 'School' }, { id: 'docs', label: 'Docs' }, { id: 'notes', label: 'Notes' }].map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, padding: '7px 4px', borderRadius: '7px', border: 'none', cursor: 'pointer', backgroundColor: activeTab === t.id ? '#6366f1' : 'transparent', color: activeTab === t.id ? '#fff' : '#64748b', fontSize: '12px', fontWeight: '600' }}>
                  {t.label}
                </button>
              ))}
            </div>

            {activeTab === 'health' && (
              <>
                <div style={card}>
                  <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Health & Medical</h3>
                  {[
                    { label: 'Vaccination Record', hint: 'Track all vaccines and due dates', icon: '\u{1F489}' },
                    { label: 'Doctor / Paediatrician', hint: activeKid.doctor_name || 'Add primary doctor', icon: '\u{1F469}\u{200D}\u{2695}\u{FE0F}' },
                    { label: 'Allergies', hint: activeKid.allergies || 'None recorded', icon: '\u{26A0}\u{FE0F}' },
                    { label: 'Medical History', hint: 'Past illnesses, surgeries', icon: '\u{1F4CB}' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < 3 ? '1px solid #1a1a2e' : 'none' }}>
                      <span style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{item.label}</div>
                        <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>{item.hint}</div>
                      </div>
                      <span style={{ color: '#334155', fontSize: '16px' }}>&rsaquo;</span>
                    </div>
                  ))}
                </div>
                <div style={card}>
                  <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Growth Tracking</h3>
                  {[
                    { label: 'Height / Weight', hint: 'Log growth milestones', icon: '\u{1F4CF}' },
                    { label: 'Dental Visits', hint: 'Next checkup reminder', icon: '\u{1FAB7}' },
                    { label: 'Eye Checkups', hint: 'Vision records', icon: '\u{1F441}\u{FE0F}' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < 2 ? '1px solid #1a1a2e' : 'none' }}>
                      <span style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{item.label}</div>
                        <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>{item.hint}</div>
                      </div>
                      <span style={{ color: '#334155', fontSize: '16px' }}>&rsaquo;</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'school' && (
              <>
                <div style={card}>
                  <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>School & Education</h3>
                  {activeKid.school && (
                    <div style={{ marginBottom: '12px', padding: '10px', backgroundColor: 'rgba(99,102,241,0.05)', borderRadius: '8px', border: '1px solid #6366f120' }}>
                      <div style={{ fontSize: '11px', color: '#6366f1', fontWeight: '700', marginBottom: '2px' }}>School</div>
                      <div style={{ fontSize: '14px', color: '#f1f5f9' }}>{activeKid.school}</div>
                    </div>
                  )}
                  {[
                    { label: 'Report Cards', hint: 'Academic performance records', icon: '\u{1F4CA}' },
                    { label: 'Certificates & Awards', hint: 'Achievements and recognition', icon: '\u{1F3C6}' },
                    { label: 'Academic Calendar', hint: 'Exams, holidays, events', icon: '\u{1F4C5}' },
                    { label: 'Homework & Projects', hint: 'Upcoming deadlines', icon: '\u{270F}\u{FE0F}' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < 3 ? '1px solid #1a1a2e' : 'none' }}>
                      <span style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{item.label}</div>
                        <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>{item.hint}</div>
                      </div>
                      <span style={{ color: '#334155', fontSize: '16px' }}>&rsaquo;</span>
                    </div>
                  ))}
                </div>
                <div style={card}>
                  <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Activities</h3>
                  {[
                    { label: 'Sports & Clubs', hint: 'Extracurricular activities', icon: '\u{26BD}' },
                    { label: 'Tuition / Coaching', hint: 'Classes and schedules', icon: '\u{1F4DA}' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < 1 ? '1px solid #1a1a2e' : 'none' }}>
                      <span style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{item.label}</div>
                        <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>{item.hint}</div>
                      </div>
                      <span style={{ color: '#334155', fontSize: '16px' }}>&rsaquo;</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'docs' && (
              <div style={card}>
                <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Identity Documents</h3>
                {[
                  { label: 'Birth Certificate', icon: '\u{1F4DC}' },
                  { label: 'Aadhar Card', icon: '\u{1F4F1}' },
                  { label: 'Passport', icon: '\u{1F6C2}' },
                  { label: 'School ID Card', icon: '\u{1F393}' },
                  { label: 'Insurance Card', icon: '\u{1F3E5}' },
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

            {activeTab === 'notes' && (
              <>
                <div style={card}>
                  <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Memories & Milestones</h3>
                  {[
                    { label: 'First Steps / Words', hint: 'Early milestones', icon: '\u{1F463}' },
                    { label: 'Birthdays', hint: 'Party plans and memories', icon: '\u{1F382}' },
                    { label: 'Growth Journal', hint: 'Personal notes and observations', icon: '\u{1F4D4}' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < 2 ? '1px solid #1a1a2e' : 'none' }}>
                      <span style={{ fontSize: '20px', width: '28px', textAlign: 'center' }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{item.label}</div>
                        <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>{item.hint}</div>
                      </div>
                      <span style={{ color: '#334155', fontSize: '16px' }}>&rsaquo;</span>
                    </div>
                  ))}
                </div>
                <div style={{ ...card, textAlign: 'center', border: '1px dashed #1e293b' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>{'\u{1F399}'}</div>
                  <div style={{ fontSize: '13px', color: '#475569' }}>Use voice to add a note about {activeKid.name.split(' ')[0]}</div>
                  <a href="/dashboard" style={{ display: 'inline-block', marginTop: '12px', backgroundColor: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', padding: '8px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>Go to My Keeps</a>
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '60px 24px', border: '1px dashed #1e293b', borderRadius: '14px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>{'\u{1F476}'}</div>
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#94a3b8', marginBottom: '8px' }}>No children added yet</div>
            <div style={{ fontSize: '13px', color: '#475569', marginBottom: '20px' }}>Add your first child profile to get started</div>
            <button onClick={() => setShowAddForm(true)} style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Add Child</button>
          </div>
      )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
