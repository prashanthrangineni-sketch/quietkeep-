'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
// src/app/b/attendance/page.jsx — Attendance with geo check-in

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';
const G = '#10b981';

function fmtDate(d) { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }

export default function AttendancePage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [logs, setLogs] = useState({});
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [geoLoading, setGeoLoading] = useState(null);

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
            const { data: ws } = await supabase.from('business_workspaces').select('id,name').eq('owner_user_id', user?.id).maybeSingle();
            if (!ws) return;
            setWorkspace(ws);
            loadData(ws.id, date);
    })();
  }, [user]);

  const loadData = useCallback(async (wsId, d) => {
    setLoading(true);
    const [membersRes, logsRes] = await Promise.all([
      supabase.from('business_members').select('id,name,role,department,daily_wage').eq('workspace_id', wsId).eq('status', 'active').order('name'),
      supabase.from('attendance_logs').select('*').eq('workspace_id', wsId).eq('log_date', d),
    ]);
    setMembers(membersRes.data || []);
    const logMap = {};
    (logsRes.data || []).forEach(l => { logMap[l.member_id] = l; });
    setLogs(logMap);
    setLoading(false);
  }, []);

  async function markAttendance(memberId, status) {
    if (!workspace) return;
    setSaving(memberId);
    await supabase.from('attendance_logs').upsert({
      workspace_id: workspace.id, member_id: memberId,
      log_date: date, status,
    }, { onConflict: 'workspace_id,member_id,log_date' });
    setLogs(prev => ({ ...prev, [memberId]: { ...(prev[memberId] || {}), member_id: memberId, status } }));
    setSaving(null);
  }

  async function geoCheckIn(memberId) {
    setGeoLoading(memberId);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      await supabase.from('attendance_logs').upsert({
        workspace_id: workspace.id, member_id: memberId, log_date: date,
        status: 'present', check_in: new Date().toISOString(),
        check_in_lat: pos.coords.latitude, check_in_lng: pos.coords.longitude, geo_verified: true,
      }, { onConflict: 'workspace_id,member_id,log_date' });
      setLogs(prev => ({ ...prev, [memberId]: { ...(prev[memberId] || {}), status: 'present', geo_verified: true } }));
      setGeoLoading(null);
    }, () => { setGeoLoading(null); alert('Could not get location.'); });
  }

  const STATUS_OPTS = [
    { v: 'present', l: 'P', color: G },
    { v: 'absent', l: 'A', color: '#ef4444' },
    { v: 'half_day', l: '½', color: '#f59e0b' },
    { v: 'late', l: 'L', color: '#f59e0b' },
    { v: 'leave', l: 'Le', color: '#6366f1' },
  ];

  const presentCount = Object.values(logs).filter(l => l.status === 'present').length;
  const absentCount = Object.values(logs).filter(l => l.status === 'absent').length;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h1 className="qk-h1">👥 Attendance</h1>
            <p className="qk-desc">Mark daily attendance for your team</p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <a href="/b/team" style={{ fontSize: 11, color: G, textDecoration: 'none', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', padding: '6px 10px', borderRadius: 7, fontWeight: 600 }}>+ Add Employee</a>
            <input type="date" value={date} onChange={e => { setDate(e.target.value); workspace && loadData(workspace.id, e.target.value); }}
            className="qk-input" style={{ width: 'auto', fontSize: 12, padding: '6px 10px' }} />
          </div>
        </div>

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Present', value: presentCount, color: G },
            { label: 'Absent', value: absentCount, color: '#ef4444' },
            { label: 'Total', value: members.length, color: 'var(--primary)' },
          ].map(s => (
            <div key={s.label} className="qk-card" style={{ padding: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Mark all present */}
        <button onClick={async () => { for (const m of members) await markAttendance(m.id, 'present'); }}
          className="qk-btn qk-btn-sm" style={{ width: '100%', justifyContent: 'center', background: `rgba(16,185,129,0.1)`, border: `1px solid ${G}40`, color: G, marginBottom: 14 }}>
          ✓ Mark All Present
        </button>

        {loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="qk-spinner" /></div> : (
          members.length === 0 ? (
            <div className="qk-empty">
              <div className="qk-empty-icon">👥</div>
              <div className="qk-empty-title">No staff added yet</div>
              <div className="qk-empty-sub">Add team members to mark attendance</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {members.map(m => {
                const log = logs[m.id];
                const currentStatus = log?.status;
                return (
                  <div key={m.id} className="qk-card" style={{ padding: '13px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: currentStatus === 'present' ? `rgba(16,185,129,0.15)` : currentStatus === 'absent' ? 'rgba(239,68,68,0.1)' : 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: currentStatus === 'present' ? G : currentStatus === 'absent' ? '#ef4444' : 'var(--text-subtle)', flexShrink: 0 }}>
                      {m.name[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{m.designation || m.role}{m.department ? ` · ${m.department}` : ''}</div>
                      {log?.geo_verified && <div style={{ fontSize: 10, color: G, marginTop: 2 }}>📍 Geo verified</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {STATUS_OPTS.map(s => (
                        <button key={s.v} onClick={() => markAttendance(m.id, s.v)} disabled={saving === m.id}
                          style={{
                            width: 28, height: 28, borderRadius: '50%', border: `1.5px solid ${currentStatus === s.v ? s.color : 'var(--border)'}`,
                            background: currentStatus === s.v ? `${s.color}20` : 'transparent',
                            color: currentStatus === s.v ? s.color : 'var(--text-subtle)',
                            fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}>
                          {saving === m.id ? '...' : s.l}
                        </button>
                      ))}
                      <button onClick={() => geoCheckIn(m.id)} disabled={geoLoading === m.id}
                        style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid var(--border)', background: 'transparent', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Geo check-in">
                        {geoLoading === m.id ? '⏳' : '📍'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
