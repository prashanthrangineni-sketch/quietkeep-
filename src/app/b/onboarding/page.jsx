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
      .select('id,name,business_type,gstin,phone,upi_id')
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
          setUpiId(data.upi_id || '');
          setStep(1);
        }
      });
  }, [user, router, authLoading]);

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
      if (editMode && wsId) {
        // UPDATE existing workspace
        const { error: e } = await supabase.from('business_workspaces').update({
          name: bizName.trim(),
          business_type: bizType,
          gstin: gstin.trim() || null,
          phone: phone.trim() || null,
          upi_id: cleanUpi || null,
          updated_at: new Date().toISOString(),
        }).eq('id', wsId);
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
        const { data: ws, error: e } = await supabase.from('business_workspaces').insert({
          owner_user_id: user.id,
          name: bizName.trim(),
          business_type: bizType,
          gstin: gstin.trim() || null,
          phone: phone.trim() || null,
          upi_id: cleanUpi || null,
        }).select('id').single();
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
