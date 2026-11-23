'use client';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/b/onboarding/page.jsx
 *
 * ROOT CAUSE OF "Workspace Settings → dashboard" BUG:
 * Line 35: .then(({ data }) => { if (data) router.replace('/b/dashboard'); })
 * When a workspace already exists, this IMMEDIATELY redirected to /b/dashboard,
 * making the Workspace Settings page completely unreachable from the More menu.
 *
 * FIX: Detect existing workspace → enter editMode → load existing data into form.
 * In editMode, the page shows "Edit Workspace" UI instead of redirecting.
 * On save, it UPDATEs instead of INSERTs and then navigates to /b/dashboard.
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';

const BIZ_TYPES = [
  { value: 'retail',        emoji: '🏪', label: 'Retail / Kirana',       desc: 'Shop, store, supermarket' },
  { value: 'restaurant',    emoji: '🍽️', label: 'Restaurant / Food',     desc: 'Restaurant, cloud kitchen, cafe' },
  { value: 'services',      emoji: '✂️', label: 'Services',               desc: 'Salon, repair, consultancy' },
  { value: 'construction',  emoji: '🏗️', label: 'Construction',           desc: 'Builder, contractor, real estate' },
  { value: 'education',     emoji: '📚', label: 'Education / Coaching',   desc: 'Coaching, school, tutor' },
  { value: 'healthcare',    emoji: '🏥', label: 'Healthcare',             desc: 'Clinic, pharmacy, diagnostic' },
  { value: 'logistics',     emoji: '🚚', label: 'Logistics / Transport',  desc: 'Fleet, delivery, courier' },
  { value: 'manufacturing', emoji: '🧵', label: 'Manufacturing',          desc: 'Factory, workshop, production' },
  { value: 'other',         emoji: '🏢', label: 'Other Business',         desc: 'Any other type' },
];
const G = '#10b981';

export default function BizOnboardingPage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const router  = useRouter();
  const [step, setStep]         = useState(0);
  // FIX: edit mode state
  const [editMode, setEditMode] = useState(false);
  const [wsId, setWsId]         = useState(null);
  // Form state
  const [bizName, setBizName]   = useState('');
  const [bizType, setBizType]   = useState('retail');
  const [gstin, setGstin]       = useState('');
  const [phone, setPhone]       = useState('');
  const [address, setAddress]   = useState('');
  const [lat, setLat]           = useState(null);
  const [lng, setLng]           = useState(null);
  const [locationSetAt, setLocationSetAt] = useState(null);
  const [showOnCart2Save, setShowOnCart2Save] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geoMessage, setGeoMessage] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [saved, setSaved]       = useState('');

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    supabase.from('business_workspaces')
      .select('id,name,business_type,gstin,phone,lat,lng,location_set_at,show_on_cart2save,address')
      .eq('owner_user_id', user?.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setEditMode(true);
          setWsId(data.id);
          setBizName(data.name || '');
          setBizType(data.business_type || 'retail');
          setGstin(data.gstin || '');
          setPhone(data.phone || '');
          setAddress(data.address || '');
          setLat(data.lat !== null && data.lat !== undefined ? Number(data.lat) : null);
          setLng(data.lng !== null && data.lng !== undefined ? Number(data.lng) : null);
          setLocationSetAt(data.location_set_at || null);
          setShowOnCart2Save(Boolean(data.show_on_cart2save));
          setStep(1);
        }
      });
  }, [user, router, authLoading]);

  // ── Shop Location Handlers ────────────────────────────────────────────────
  function handleUseCurrentLocation() {
    if (typeof window === 'undefined' || !navigator?.geolocation) {
      setGeoMessage('Geolocation is not supported by your browser.');
      return;
    }
    setLocating(true);
    setGeoMessage('Detecting your shop location...');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const latitude = Number(pos.coords.latitude.toFixed(6));
        const longitude = Number(pos.coords.longitude.toFixed(6));
        setLat(latitude);
        setLng(longitude);
        const nowIso = new Date().toISOString();
        setLocationSetAt(nowIso);
        setLocating(false);
        setGeoMessage(`Location pinned: ${latitude}, ${longitude}`);

        // Reverse-geocode to auto-populate address if blank
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
          if (res.ok) {
            const data = await res.json();
            if (data.display_name && !address) {
              setAddress(data.display_name);
            }
          }
        } catch {}
      },
      (err) => {
        setLocating(false);
        setGeoMessage(`Could not detect location: ${err.message || 'Permission denied'}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function handleGeocodeAddress() {
    if (!address || !address.trim()) {
      setGeoMessage('Please type an address or landmark first.');
      return;
    }
    setGeocoding(true);
    setGeoMessage('Searching address on map...');
    try {
      const q = encodeURIComponent(address.trim());
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&countrycodes=in&limit=1`);
      if (res.ok) {
        const results = await res.json();
        if (results && results.length > 0) {
          const latitude = Number(parseFloat(results[0].lat).toFixed(6));
          const longitude = Number(parseFloat(results[0].lon).toFixed(6));
          setLat(latitude);
          setLng(longitude);
          setLocationSetAt(new Date().toISOString());
          setGeoMessage(`Pinned: ${results[0].display_name.split(',').slice(0, 3).join(', ')}`);
        } else {
          setGeoMessage('No exact location found. You can adjust the pin on the map or enter coordinates.');
        }
      } else {
        setGeoMessage('Address search service unavailable. Please drag or set coordinates.');
      }
    } catch (e) {
      setGeoMessage('Address search failed. Please use current location or drag pin.');
    } finally {
      setGeocoding(false);
    }
  }

  function handleMapNudge(dLat, dLng) {
    const baseLat = lat !== null ? lat : 17.4435; // Default Hyderabad reference
    const baseLng = lng !== null ? lng : 78.3842;
    const newLat = Number((baseLat + dLat).toFixed(6));
    const newLng = Number((baseLng + dLng).toFixed(6));
    setLat(newLat);
    setLng(newLng);
    setLocationSetAt(new Date().toISOString());
    setGeoMessage(`Pin moved to: ${newLat}, ${newLng}`);
  }

  async function finish() {
    if (!bizName.trim()) { setError('Business name is required'); return; }
    setSaving(true); setError(''); setSaved('');
    try {
      const locationPayload = {
        lat: lat !== null && lat !== '' && !isNaN(lat) ? Number(lat) : null,
        lng: lng !== null && lng !== '' && !isNaN(lng) ? Number(lng) : null,
        location_set_at: (lat !== null && lng !== null) ? (locationSetAt || new Date().toISOString()) : null,
        show_on_cart2save: showOnCart2Save,
        address: address.trim() || null,
      };

      if (editMode && wsId) {
        // FIX: UPDATE existing workspace
        const updateBody = {
          name: bizName.trim(), business_type: bizType,
          gstin: gstin.trim() || null, phone: phone.trim() || null,
          ...locationPayload,
          updated_at: new Date().toISOString(),
        };

        // Call API endpoint to trigger server-side outbox queueing & RLS guards
        if (accessToken) {
          try {
            await fetch('/api/business/workspace', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify(updateBody),
            });
          } catch (apiErr) {
            console.error('[b/onboarding] API update error:', apiErr);
          }
        }

        const { error: e } = await supabase.from('business_workspaces').update(updateBody).eq('id', wsId);
        if (e) throw e;
        await supabase.from('profiles').upsert({
          user_id: user.id, business_type: bizType, business_name: bizName.trim(),
          business_gstin: gstin.trim() || null,
          workspace_type: 'business', // FIX: ensure workspace_type stays correct on edit
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        // Set cookie so middleware routes correctly on web
        document.cookie = 'qk_app_mode=business; path=/; max-age=86400; SameSite=Lax';
        setSaved('Workspace updated ✓');
        setTimeout(() => router.replace('/b/dashboard'), 1200);
      } else {
        // INSERT new workspace
        const insertBody = {
          owner_user_id: user.id, name: bizName.trim(), business_type: bizType,
          gstin: gstin.trim() || null, phone: phone.trim() || null,
          ...locationPayload,
        };
        const { data: ws, error: e } = await supabase.from('business_workspaces').insert(insertBody).select('id').single();
        if (e) throw e;

        // BUG FOUND 13 Aug 2026: a brand-new workspace was created with ZERO
        // members, so the person who just signed up was not on their own team.
        // Team, Attendance and Payroll all showed "No staff added" to the owner,
        // and payroll could never include them. Add the owner as member #1.
        if (ws?.id) {
          const ownerName =
            (user.user_metadata?.full_name || '').trim() ||
            bizName.trim() ||
            'Owner';
          const ownerPhone =
            (phone.trim() || user.phone || '').replace(/^\+?91/, '') || null;
          const { error: memberErr } = await supabase.from('business_members').insert({
            workspace_id: ws.id,
            user_id: user.id,
            name: ownerName,
            phone: ownerPhone,
            email: user.email || null,
            role: 'owner',
            access_role: 'owner',
            status: 'active',
            date_of_joining: new Date().toISOString().slice(0, 10),
          });
          // Never block signup on this — the workspace itself is created.
          if (memberErr) console.error('[b/onboarding] owner member insert failed', memberErr);
        }
        await supabase.from('profiles').upsert({
          user_id: user.id, workspace_type: 'business', business_type: bizType,
          business_name: bizName.trim(), business_gstin: gstin.trim() || null,
          business_onboarding_done: true, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        // Set cookie so middleware routes correctly on web
        document.cookie = 'qk_app_mode=business; path=/; max-age=86400; SameSite=Lax';
        router.replace('/b/dashboard');
      }
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    }
    setSaving(false);
  }

  const inp = {
    width: '100%', background: 'var(--surface)',
    border: '1.5px solid var(--border)', borderRadius: 12,
    padding: '12px 16px', color: 'var(--text)', fontSize: 14,
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };

  return (
    <div style={{
      minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)',
      fontFamily: "'Inter',-apple-system,sans-serif",
      paddingTop: editMode ? 56 : 0, paddingBottom: 40,
    }}>
      {/* Show BizNavbar only in edit mode (user is already onboarded) */}
      {editMode && <BizNavbar />}

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 38, marginBottom: 8 }}>{editMode ? '⚙️' : '🏢'}</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px' }}>
            {editMode ? 'Workspace Settings' : 'Set Up Your Business'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0 }}>
            {editMode ? 'Update your business details' : 'Get started with QuietKeep Business'}
          </p>
        </div>

        {/* Step 0: Type selection (new workspaces only) */}
        {step === 0 && !editMode && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Type of Business
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              {BIZ_TYPES.map(bt => (
                <button key={bt.value} onClick={() => setBizType(bt.value)}
                  style={{ padding: '12px', borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                    border: `1.5px solid ${bizType === bt.value ? G : 'var(--border)'}`,
                    background: bizType === bt.value ? `${G}18` : 'var(--surface)',
                    color: 'var(--text)', fontFamily: 'inherit' }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{bt.emoji}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{bt.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 2 }}>{bt.desc}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setStep(1)}
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                background: `linear-gradient(135deg,${G},#059669)`, color: '#fff',
                fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Continue →
            </button>
          </>
        )}

        {/* Step 1: Details form */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* In edit mode, show compact type-picker at top */}
            {editMode && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)',
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Business Type
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 4 }}>
                  {BIZ_TYPES.map(bt => (
                    <button key={bt.value} onClick={() => setBizType(bt.value)}
                      style={{ padding: '7px 6px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                        border: `1px solid ${bizType === bt.value ? G : 'var(--border)'}`,
                        background: bizType === bt.value ? `${G}18` : 'var(--surface)',
                        color: 'var(--text)', fontFamily: 'inherit' }}>
                      {bt.emoji} {bt.label.split('/')[0].trim()}
                    </button>
                  ))}
                </div>
              </>
            )}

            {[
              { label: 'Business Name *', value: bizName, set: setBizName, ph: 'e.g. Ramu Kirana Store', type: 'text' },
              { label: 'GSTIN (optional)', value: gstin, set: v => setGstin(v.toUpperCase()), ph: '22AAAAA0000A1Z5', type: 'text', max: 15 },
              { label: 'Business Phone',  value: phone, set: setPhone, ph: '+91 98765 43210', type: 'tel' },
            ].map(f => (
              <div key={f.label}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)',
                  display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {f.label}
                </label>
                <input type={f.type} value={f.value}
                  onChange={e => f.set(e.target.value)}
                  placeholder={f.ph} maxLength={f.max} style={inp} />
              </div>
            ))}

            {/* ── Shop Location: Pin my shop on the map ── */}
            <div style={{
              background: 'var(--surface)',
              border: '1.5px solid var(--border)',
              borderRadius: 14,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    📍 Pin my shop on the map
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                    Exact location for customer discovery & delivery on Cart2Save
                  </div>
                </div>
                {lat && lng && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, background: `${G}20`, color: G,
                    padding: '3px 8px', borderRadius: 6,
                  }}>
                    ✓ Pinned
                  </span>
                )}
              </div>

              {/* 1. Browser Location button */}
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={locating}
                style={{
                  padding: '10px 14px', borderRadius: 10,
                  border: `1.5px solid ${G}60`,
                  background: `${G}15`,
                  color: G,
                  fontSize: 13, fontWeight: 700,
                  cursor: locating ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {locating ? '⏳ Detecting Location...' : '📍 Use Browser Current Location'}
              </button>

              {/* 2. Typed Address Fallback */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', display: 'block', marginBottom: 4 }}>
                  Shop Address / Landmark (typed fallback)
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="e.g. Shop 4, Near Rythu Bazar, Kondapur"
                    style={{ ...inp, flex: 1, padding: '10px 12px' }}
                  />
                  <button
                    type="button"
                    onClick={handleGeocodeAddress}
                    disabled={geocoding || !address.trim()}
                    style={{
                      padding: '10px 14px', borderRadius: 10,
                      border: '1.5px solid var(--border)',
                      background: 'var(--surface-hover)',
                      color: 'var(--text)',
                      fontSize: 12, fontWeight: 600,
                      cursor: (geocoding || !address.trim()) ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {geocoding ? 'Searching...' : 'Find on Map'}
                  </button>
                </div>
              </div>

              {/* 3. Drag Pin & Map Box */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 6 }}>
                  Drag Pin / Tap Map to adjust location
                </div>
                <div
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
                    const y = (e.clientY - rect.top) / rect.height - 0.5; // -0.5 to 0.5
                    // Adjust by up to ~0.01 deg based on tap
                    handleMapNudge(-y * 0.01, x * 0.01);
                  }}
                  style={{
                    position: 'relative',
                    height: 140,
                    borderRadius: 10,
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    background: '#0f172a',
                    cursor: 'crosshair',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {/* Subtle map grid styling */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)',
                    backgroundSize: '20px 20px',
                  }} />
                  {lat && lng && (
                    <div style={{
                      position: 'absolute', inset: 0, opacity: 0.65, pointerEvents: 'none',
                    }}>
                      <iframe
                        title="OSM Preview"
                        width="100%"
                        height="100%"
                        style={{ border: 0 }}
                        loading="lazy"
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005}%2C${lat - 0.003}%2C${lng + 0.005}%2C${lat + 0.003}&layer=mapnik&marker=${lat}%2C${lng}`}
                      />
                    </div>
                  )}

                  {/* Centered draggable map pin */}
                  <div
                    draggable
                    onDragEnd={(e) => {
                      const rect = e.currentTarget.parentElement?.getBoundingClientRect();
                      if (rect) {
                        const x = (e.clientX - rect.left) / rect.width - 0.5;
                        const y = (e.clientY - rect.top) / rect.height - 0.5;
                        handleMapNudge(-y * 0.005, x * 0.005);
                      }
                    }}
                    style={{
                      position: 'relative',
                      zIndex: 2,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      pointerEvents: 'auto',
                    }}
                  >
                    <div style={{
                      fontSize: 28,
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                      cursor: 'grab',
                    }}>
                      📍
                    </div>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      background: 'rgba(0,0,0,0.8)',
                      color: '#fff',
                      padding: '2px 6px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                    }}>
                      {lat && lng ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Drag to Pin Shop'}
                    </span>
                  </div>
                </div>

                {/* Fine nudge buttons for drag-pin precision */}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'center' }}>
                  <button type="button" onClick={() => handleMapNudge(0.001, 0)} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-hover)', color: 'var(--text)', cursor: 'pointer' }}>↑ Nudge North</button>
                  <button type="button" onClick={() => handleMapNudge(-0.001, 0)} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-hover)', color: 'var(--text)', cursor: 'pointer' }}>↓ Nudge South</button>
                  <button type="button" onClick={() => handleMapNudge(0, -0.001)} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-hover)', color: 'var(--text)', cursor: 'pointer' }}>← Nudge West</button>
                  <button type="button" onClick={() => handleMapNudge(0, 0.001)} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-hover)', color: 'var(--text)', cursor: 'pointer' }}>→ Nudge East</button>
                </div>
              </div>

              {/* Direct Coordinate Inputs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)' }}>Latitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={lat !== null && lat !== undefined ? lat : ''}
                    onChange={e => {
                      const v = e.target.value === '' ? null : parseFloat(e.target.value);
                      setLat(v);
                      setLocationSetAt(new Date().toISOString());
                    }}
                    placeholder="17.443500"
                    style={{ ...inp, padding: '8px 10px', fontSize: 12, marginTop: 2 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)' }}>Longitude</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={lng !== null && lng !== undefined ? lng : ''}
                    onChange={e => {
                      const v = e.target.value === '' ? null : parseFloat(e.target.value);
                      setLng(v);
                      setLocationSetAt(new Date().toISOString());
                    }}
                    placeholder="78.384200"
                    style={{ ...inp, padding: '8px 10px', fontSize: 12, marginTop: 2 }}
                  />
                </div>
              </div>

              {geoMessage && (
                <div style={{ fontSize: 12, color: geoMessage.includes('Could not') || geoMessage.includes('failed') ? '#f87171' : G }}>
                  ℹ️ {geoMessage}
                </div>
              )}
            </div>

            {/* ── Cart2Save Switch: Show my shop on Cart2Save (default OFF) ── */}
            <div style={{
              background: 'var(--surface)',
              border: `1.5px solid ${showOnCart2Save ? G : 'var(--border)'}`,
              borderRadius: 14,
              padding: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  🛒 Show my shop on Cart2Save
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                  Default: OFF. Enable to publish your shop and public items on Cart2Save. Switching off automatically unpublishes your feed.
                </div>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: 46, height: 26, flexShrink: 0, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showOnCart2Save}
                  onChange={(e) => setShowOnCart2Save(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{
                  position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: showOnCart2Save ? G : '#475569',
                  borderRadius: 26, transition: '.3s',
                }}>
                  <span style={{
                    position: 'absolute', content: '""', height: 20, width: 20, left: showOnCart2Save ? 23 : 3, bottom: 3,
                    backgroundColor: 'white', borderRadius: '50%', transition: '.3s',
                  }} />
                </span>
              </label>
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10, padding: '9px 14px', fontSize: 13, color: '#f87171' }}>
                ⚠️ {error}
              </div>
            )}
            {saved && (
              <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
                borderRadius: 10, padding: '9px 14px', fontSize: 13, color: G }}>
                ✓ {saved}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              {!editMode && (
                <button onClick={() => setStep(0)}
                  style={{ padding: '12px 18px', borderRadius: 12, background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-subtle)',
                    fontFamily: 'inherit', cursor: 'pointer', fontSize: 14 }}>
                  ← Back
                </button>
              )}
              <button onClick={finish} disabled={saving || !bizName.trim()}
                style={{ flex: 1, padding: '14px', borderRadius: 12, border: 'none',
                  background: bizName.trim()
                    ? `linear-gradient(135deg,${G},#059669)`
                    : 'var(--surface)',
                  color: bizName.trim() ? '#fff' : '#475569',
                  fontSize: 15, fontWeight: 700,
                  cursor: bizName.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                {saving ? 'Saving…' : editMode ? 'Save Changes ✓' : 'Launch Business ✓'}
              </button>
            </div>

            {editMode && (
              <button onClick={() => router.replace('/b/dashboard')}
                style={{ width: '100%', padding: '10px', borderRadius: 10, background: 'transparent',
                  border: '1px solid var(--border)', color: '#64748b',
                  fontFamily: 'inherit', cursor: 'pointer', fontSize: 13 }}>
                Cancel — back to Dashboard
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
                         }
