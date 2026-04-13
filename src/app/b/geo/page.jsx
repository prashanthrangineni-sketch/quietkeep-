'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
// src/app/b/geo/page.jsx — Field team geo check-in tracking

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';
const G = '#10b981';

export default function GeoPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ member_id:'', checkin_type:'field_visit', client_name:'', purpose:'', notes:'' });
  const [geoLoading, setGeoLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
            const { data: ws } = await supabase.from('business_workspaces').select('id').eq('owner_user_id', user?.id).maybeSingle();
            if (ws) { setWorkspace(ws); loadData(ws.id); }
    })();
  }, [user]);

  const loadData = useCallback(async (wsId) => {
    setLoading(true);
    const [membersRes, checkinsRes] = await Promise.all([
      supabase.from('business_members').select('id,name,role,department').eq('workspace_id', wsId).eq('status', 'active'),
      supabase.from('geo_checkins').select('*,business_members(name)').eq('workspace_id', wsId).order('checkin_at', { ascending: false }).limit(50),
    ]);
    setMembers(membersRes.data || []);
    setCheckins(checkinsRes.data || []);
    setLoading(false);
  }, []);

  async function checkIn() {
    if (!form.member_id || !workspace) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      setSaving(true);
      let locationName = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`);
        const d = await r.json();
        locationName = d.display_name?.split(',').slice(0,3).join(', ') || locationName;
      } catch {}

      await supabase.from('geo_checkins').insert({
        workspace_id: workspace.id, member_id: form.member_id,
        checkin_type: form.checkin_type,
        client_name: form.client_name || null,
        purpose: form.purpose || null,
        notes: form.notes || null,
        location_name: locationName,
        lat: pos.coords.latitude, lng: pos.coords.longitude,
        accuracy_meters: pos.coords.accuracy,
        checkin_at: new Date().toISOString(),
      });
      setSaving(false); setGeoLoading(false); setShowForm(false);
      setForm({ member_id:'', checkin_type:'field_visit', client_name:'', purpose:'', notes:'' });
      loadData(workspace.id);
    }, () => {
      setGeoLoading(false);
      alert('Could not get location. Please enable location access.');
    }, { enableHighAccuracy: true, timeout: 10000 });
  }

  const TYPES = { field_visit: '🗺️ Field Visit', client_visit: '🤝 Client Visit', delivery: '📦 Delivery', site_visit: '🏗️ Site Visit' };
  const today = new Date().toLocaleDateString('en-IN');
  const todayCheckins = checkins.filter(c => new Date(c.checkin_at).toLocaleDateString('en-IN') === today);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div><h1 className="qk-h1">🗺️ Field Tracking</h1><p className="qk-desc">Geo check-ins for field team visits</p></div>
          <button onClick={() => setShowForm(!showForm)} className="qk-btn qk-btn-primary qk-btn-sm">+ Check In</button>
        </div>

        <div className="qk-card" style={{ padding: 14, marginBottom: 14, background: `${G}10`, border: `1px solid ${G}30` }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: G }}>{todayCheckins.length}</div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Check-ins today</div>
        </div>

        {showForm && (
          <div className="qk-card" style={{ padding: 16, marginBottom: 14, borderColor: G }}>
            <div style={{ marginBottom: 10 }}>
              <label className="qk-lbl">Staff member *</label>
              <select value={form.member_id} onChange={e => setForm(p => ({...p, member_id: e.target.value}))} className="qk-input" style={{ marginTop: 4 }}>
                <option value="">Select...</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label className="qk-lbl">Visit type</label>
              <select value={form.checkin_type} onChange={e => setForm(p => ({...p, checkin_type: e.target.value}))} className="qk-input" style={{ marginTop: 4 }}>
                {Object.entries(TYPES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {[
              { label: 'Client name', key: 'client_name', ph: 'Who are they visiting?' },
              { label: 'Purpose', key: 'purpose', ph: 'Purpose of visit' },
              { label: 'Notes', key: 'notes', ph: 'Any additional notes' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 8 }}>
                <label className="qk-lbl">{f.label}</label>
                <input value={form[f.key]} onChange={e => setForm(p => ({...p, [f.key]: e.target.value}))} placeholder={f.ph} className="qk-input" style={{ marginTop: 4 }} />
              </div>
            ))}
            <button onClick={checkIn} disabled={geoLoading || saving || !form.member_id}
              className="qk-btn qk-btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
              {geoLoading ? '📍 Getting location...' : saving ? 'Saving...' : '📍 Check In with Location'}
            </button>
          </div>
        )}

        {loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="qk-spinner" /></div>
        : checkins.length === 0 ? (
          <div className="qk-empty"><div className="qk-empty-icon">🗺️</div><div className="qk-empty-title">No check-ins yet</div><div className="qk-empty-sub">Record field team visits with GPS location</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checkins.map(c => (
              <div key={c.id} className="qk-card" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>📍</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>
                      {c.business_members?.name || 'Staff'} · {TYPES[c.checkin_type] || c.checkin_type}
                    </div>
                    {c.client_name && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>👤 {c.client_name}{c.purpose ? ` — ${c.purpose}` : ''}</div>}
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                      📍 {c.location_name?.slice(0, 60) || 'Location recorded'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>
                      {new Date(c.checkin_at).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                      {c.accuracy_meters && ` · ±${Math.round(c.accuracy_meters)}m`}
                    </div>
                  </div>
                  <a href={`https://maps.google.com?q=${c.lat},${c.lng}`} target="_blank" rel="noopener noreferrer"
                    className="qk-btn qk-btn-ghost qk-btn-sm" style={{ flexShrink: 0, fontSize: 11 }}>
                    🗺️ Map
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
