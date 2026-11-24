'use client';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/b/onboarding/page.jsx
 *
 * Workspace Settings & Onboarding
 * - Business Name, Type, GSTIN, Phone
 * - Your shop's UPI ID with real-time format validation
 * - Scan your existing shop QR (decodes UPI ID from QR image or camera)
 */
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';
import { validateUpiId, parseUpiUri } from '@/lib/upi';
import { decodeQrFromImageFile } from '@/lib/qr-decoder';

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
  const [upiId, setUpiId]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [saved, setSaved]       = useState('');

  // QR Scanning state
  const [qrScanning, setQrScanning] = useState(false);
  const [qrMessage, setQrMessage]   = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/biz-login'); return; }
    supabase.from('business_workspaces')
      .select('id,name,business_type,gstin,phone,lat,lng,location_set_at,show_on_cart2save,address,upi_id')
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
          setUpiId(data.upi_id || '');
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

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  // ── UPI Format Check ────────────────────────────────────────────────────────
  const upiValidation = upiId.trim() ? validateUpiId(upiId.trim()) : null;

  // ── QR Image Upload & Decode ────────────────────────────────────────────────
  async function handleQrImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setQrScanning(true);
    setQrMessage('Reading QR image...');
    setError('');

    try {
      const result = await decodeQrFromImageFile(file);
      if (!result.ok) {
        setQrMessage(`⚠️ ${result.error}`);
        return;
      }

      const parsed = parseUpiUri(result.text);
      if (parsed.valid && parsed.pa) {
        setUpiId(parsed.pa);
        setQrMessage(`✓ Read UPI ID: ${parsed.pa} from your shop QR!`);
      } else {
        setQrMessage(`⚠️ Found QR with text "${result.text.slice(0, 30)}..." but it does not contain a valid UPI ID.`);
      }
    } catch (err) {
      setQrMessage(`⚠️ Failed to scan QR image: ${err.message}`);
    } finally {
      setQrScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ── Live Camera QR Scan ─────────────────────────────────────────────────────
  async function startCameraScan() {
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
      setQrMessage('Live camera QR detector not supported in this browser. Please use "Upload QR photo".');
      return;
    }

    setQrMessage('Starting camera...');
    setCameraActive(true);
    setError('');

    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setQrMessage('Point your camera at your printed shop QR card...');

      const tick = async () => {
        if (!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length > 0 && codes[0].rawValue) {
            const raw = codes[0].rawValue;
            const parsed = parseUpiUri(raw);
            if (parsed.valid && parsed.pa) {
              setUpiId(parsed.pa);
              setQrMessage(`✓ Detected UPI ID: ${parsed.pa} from your shop QR!`);
              stopCamera();
              return;
            }
          }
        } catch (_) {}
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      stopCamera();
      setQrMessage(`Camera unavailable: ${err.message}`);
    }
  }

  async function finish() {
    if (!bizName.trim()) { setError('Business name is required'); return; }

    const cleanUpi = upiId.trim().toLowerCase();
    if (cleanUpi) {
      const check = validateUpiId(cleanUpi);
      if (!check.valid) {
        setError(`Shop UPI ID error: ${check.error}`);
        return;
      }
    }

    setSaving(true); setError(''); setSaved('');
    try {
      const locationPayload = {
        lat: lat !== null && lat !== '' && !isNaN(lat) ? Number(lat) : null,
        lng: lng !== null && lng !== '' && !isNaN(lng) ? Number(lng) : null,
        location_set_at: (lat !== null && lng !== null) ? (locationSetAt || new Date().toISOString()) : null,
        show_on_cart2save: showOnCart2Save,
        address: address.trim() || null,
        upi_id: cleanUpi || null,
      };

      if (editMode && wsId) {
        // FIX: UPDATE existing workspace
        const updateBody = {
          name: bizName.trim(),
          business_type: bizType,
          gstin: gstin.trim() || null,
          phone: phone.trim() || null,
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
          user_id: user.id,
          business_type: bizType,
          business_name: bizName.trim(),
          business_gstin: gstin.trim() || null,
          workspace_type: 'business',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        document.cookie = 'qk_app_mode=business; path=/; max-age=86400; SameSite=Lax';
        setSaved('Workspace updated ✓');
        setTimeout(() => router.replace('/b/dashboard'), 1200);
      } else {
        // INSERT new workspace
        const insertBody = {
          owner_user_id: user.id,
          name: bizName.trim(),
          business_type: bizType,
          gstin: gstin.trim() || null,
          phone: phone.trim() || null,
          ...locationPayload,
        };
        const { data: ws, error: e } = await supabase.from('business_workspaces').insert(insertBody).select('id').single();
        if (e) throw e;

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
          if (memberErr) console.error('[b/onboarding] owner member insert failed', memberErr);
        }

        await supabase.from('profiles').upsert({
          user_id: user.id,
          workspace_type: 'business',
          business_type: bizType,
          business_name: bizName.trim(),
          business_gstin: gstin.trim() || null,
          business_onboarding_done: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        document.cookie = 'qk_app_mode=business; path=/; max-age=86400; SameSite=Lax';
        setSaved('Workspace created ✓');
        setTimeout(() => router.replace('/b/dashboard'), 1200);
      }
    } catch (e) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const inp = {
    width: '100%', padding: '12px 14px', borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text)', fontSize: 14, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <BizNavbar title={editMode ? 'Workspace Settings' : 'Setup Business'} />
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 16px 80px' }}>

        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text)' }}>
            {editMode ? 'Workspace Settings' : 'Setup Your Business'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: '6px 0 0' }}>
            {editMode ? 'Manage your business details, phone, and shop UPI ID' : 'Tell us about your business in 60 seconds'}
          </p>
        </div>

        {/* Step 0: Pick type */}
        {step === 0 && !editMode && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              What type of business do you run?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
              {BIZ_TYPES.map(bt => (
                <button key={bt.value} onClick={() => setBizType(bt.value)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    padding: '14px 12px', borderRadius: 12, border: `1.5px solid ${bizType === bt.value ? G : 'var(--border)'}`,
                    background: bizType === bt.value ? `${G}14` : 'var(--surface)',
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                  <span style={{ fontSize: 24, marginBottom: 6 }}>{bt.emoji}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{bt.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{bt.desc}</span>
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
        {(step === 1 || editMode) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Business Type selector in edit mode */}
            {editMode && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)',
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
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
              </div>
            )}

            {/* Business Name */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)',
                display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Business Name *
              </label>
              <input type="text" value={bizName}
                onChange={e => setBizName(e.target.value)}
                placeholder="e.g. Ramu Kirana Store" style={inp} />
            </div>

            {/* Phone */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)',
                display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Business Phone
              </label>
              <input type="tel" value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91 98765 43210" style={inp} />
            </div>

            {/* GSTIN */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)',
                display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                GSTIN (optional)
              </label>
              <input type="text" value={gstin}
                onChange={e => setGstin(e.target.value.toUpperCase())}
                placeholder="22AAAAA0000A1Z5" maxLength={15} style={inp} />
            </div>

            {/* ── Shop UPI ID Settings & QR Scanner (TASK B3) ── */}
            <div style={{
              background: 'var(--surface)',
              border: `1.5px solid ${upiValidation?.valid ? G : 'var(--border)'}`,
              borderRadius: 14,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Your shop's UPI ID
                  </label>
                  {upiValidation && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: upiValidation.valid ? G : '#f87171' }}>
                      {upiValidation.valid ? '✓ Valid UPI format' : '⚠️ Invalid format'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2, marginBottom: 8 }}>
                  Customer payments go directly to your shop bank account. Pranix never touches shop money.
                </div>
                <input
                  type="text"
                  value={upiId}
                  onChange={e => setUpiId(e.target.value)}
                  placeholder="e.g. shopname@okhdfcbank or 9876543210@paytm"
                  style={{
                    ...inp,
                    borderColor: upiId.trim() ? (upiValidation?.valid ? G : '#ef4444') : 'var(--border)',
                  }}
                />
                {upiId.trim() && !upiValidation?.valid && (
                  <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>
                    {upiValidation?.error || 'Invalid format: must be username@bank'}
                  </div>
                )}
              </div>

              {/* Scan your existing shop QR */}
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleQrImageUpload}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={qrScanning}
                    style={{
                      flex: 1,
                      minWidth: 160,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-hover, rgba(255,255,255,0.06))',
                      color: 'var(--text)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: qrScanning ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <span>📷</span>
                    <span>{qrScanning ? 'Scanning...' : 'Scan your existing shop QR'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => cameraActive ? stopCamera() : startCameraScan()}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: cameraActive ? 'rgba(239,68,68,0.1)' : 'var(--surface-hover, rgba(255,255,255,0.06))',
                      color: cameraActive ? '#f87171' : 'var(--text)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {cameraActive ? 'Close Camera' : 'Live Camera'}
                  </button>
                </div>

                {/* Camera live preview */}
                {cameraActive && (
                  <div style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', background: '#000', position: 'relative' }}>
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }}
                    />
                    <div style={{
                      position: 'absolute', bottom: 8, left: 8, right: 8,
                      background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 11,
                      padding: '4px 8px', borderRadius: 6, textAlign: 'center',
                    }}>
                      Point camera at your printed shop UPI QR
                    </div>
                  </div>
                )}

                {qrMessage && (
                  <div style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: qrMessage.startsWith('✓') ? G : qrMessage.startsWith('⚠️') ? '#f87171' : 'var(--text-subtle)',
                  }}>
                    {qrMessage}
                  </div>
                )}
              </div>
            </div>

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

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
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
