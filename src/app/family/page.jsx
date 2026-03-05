'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

export default function Family() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [familyProfile, setFamilyProfile] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberData, setMemberData] = useState({ name: '', relationship: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);

      const { data: fam } = await supabase.from('family_profiles').select('*').eq('user_id', session.user.id).single();
      setFamilyProfile(fam);

      const { data: mems } = await supabase.from('family_members').select('*').eq('family_id', fam?.id);
      setMembers(mems || []);

      setLoading(false);
    });
  }, [router]);

  const handleAddMember = async () => {
    if (!memberData.name.trim()) { alert('Name required'); return; }
    if (!familyProfile) { alert('Family profile not found'); return; }
    setSaving(true);

    const { data, error } = await supabase.from('family_members').insert({
      family_id: familyProfile.id,
      name: memberData.name,
      relationship: memberData.relationship,
      email: memberData.email || null,
    }).select().single();

    if (!error) {
      setMembers([...members, data]);
      setMemberData({ name: '', relationship: '', email: '' });
      setShowAddMember(false);
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <>
        <NavbarClient />
        <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '24px' }}>Loading...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '24px 16px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{ marginBottom: '32px' }}>
            <h1 style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 8px' }}>👨‍👩‍👧‍👦 Family</h1>
            <div style={{ fontSize: '14px', color: '#94a3b8' }}>Manage family members & expenses</div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid #1e293b' }}>
            {['overview', 'members', 'expenses'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '12px 16px', backgroundColor: 'transparent', border: 'none', color: activeTab === tab ? '#6366f1' : '#64748b', fontWeight: activeTab === tab ? '700' : '500', borderBottom: activeTab === tab ? '2px solid #6366f1' : 'none', cursor: 'pointer', fontSize: '13px' }}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9', margin: '0 0 16px' }}>Family Overview</h3>
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ backgroundColor: '#1a1a2e', padding: '12px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Members</div>
                  <div style={{ fontSize: '20px', fontWeight: '700' }}>{members.length}</div>
                </div>
                <div style={{ backgroundColor: '#1a1a2e', padding: '12px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Health Status</div>
                  <div style={{ fontSize: '14px', color: '#10b981' }}>✓ All Good</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'members' && (
            <>
              {members.length > 0 && (
                <div style={{ display: 'grid', gap: '12px', marginBottom: '24px' }}>
                  {members.map((mem) => (
                    <div key={mem.id} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ fontSize: '24px' }}>👤</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{mem.name}</div>
                        <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{mem.relationship}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setShowAddMember(!showAddMember)} style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                + Add Family Member
              </button>

              {showAddMember && (
                <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginTop: '24px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9', margin: '0 0 16px' }}>Add Member</h3>
                  <input type="text" placeholder="Name" value={memberData.name} onChange={(e) => setMemberData({ ...memberData, name: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box' }} />
                  <select value={memberData.relationship} onChange={(e) => setMemberData({ ...memberData, relationship: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box' }}>
                    <option>Select relationship</option>
                    <option>Spouse</option>
                    <option>Parent</option>
                    <option>Child</option>
                    <option>Sibling</option>
                  </select>
                  <input type="email" placeholder="Email (optional)" value={memberData.email} onChange={(e) => setMemberData({ ...memberData, email: e.target.value })} style={{ width: '100%', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', boxSizing: 'border-box' }} />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={handleAddMember} disabled={saving} style={{ flex: 1, backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => setShowAddMember(false)} style={{ flex: 1, backgroundColor: '#1a1a2e', color: '#94a3b8', border: '1px solid #334155', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'expenses' && (
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '12px' }}>💰</div>
              <div style={{ fontSize: '14px', color: '#94a3b8' }}>Family expense tracking coming soon</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
