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
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [saved, setSaved]       = useState('');

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    supabase.from('business_workspaces')
      .select('id,name,business_type,gstin,phone')
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
          setStep(1);
        }
      });
  }, [user, router]);

  async function finish() {
    if (!bizName.trim()) { setError('Business name is required'); return; }
    setSaving(true); setError(''); setSaved('');
    try {
      if (editMode && wsId) {
        // FIX: UPDATE existing workspace
        const { error: e } = await supabase.from('business_workspaces').update({
          name: bizName.trim(), business_type: bizType,
          gstin: gstin.trim() || null, phone: phone.trim() || null,
          updated_at: new Date().toISOString(),
        }).eq('id', wsId);
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
        const { error: e } = await supabase.from('business_workspaces').insert({
          owner_user_id: user.id, name: bizName.trim(), business_type: bizType,
          gstin: gstin.trim() || null, phone: phone.trim() || null,
        });
        if (e) throw e;
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
    width: '100%', background: 'rgba(255,255,255,0.06)',
    border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 12,
    padding: '12px 16px', color: '#f1f5f9', fontSize: 14,
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };

  return (
    <div style={{
      minHeight: '100dvh', background: '#0a1628', color: '#f1f5f9',
      fontFamily: "'Inter',-apple-system,sans-serif",
      paddingTop: editMode ? 56 : 0, paddingBottom: 40,
    }}>
      {/* Show BizNavbar only in edit mode (user is already onboarded) */}
      {editMode && <BizNavbar />}

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 38, marginBottom: 8 }}>{editMode ? '⚙️' : '🏢'}</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>
            {editMode ? 'Workspace Settings' : 'Set Up Your Business'}
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
            {editMode ? 'Update your business details' : 'Get started with QuietKeep Business'}
          </p>
        </div>

        {/* Step 0: Type selection (new workspaces only) */}
        {step === 0 && !editMode && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Type of Business
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              {BIZ_TYPES.map(bt => (
                <button key={bt.value} onClick={() => setBizType(bt.value)}
                  style={{ padding: '12px', borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                    border: `1.5px solid ${bizType === bt.value ? G : 'rgba(255,255,255,0.1)'}`,
                    background: bizType === bt.value ? `${G}18` : 'rgba(255,255,255,0.03)',
                    color: '#f1f5f9', fontFamily: 'inherit' }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{bt.emoji}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{bt.label}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{bt.desc}</div>
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
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8',
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Business Type
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 4 }}>
                  {BIZ_TYPES.map(bt => (
                    <button key={bt.value} onClick={() => setBizType(bt.value)}
                      style={{ padding: '7px 6px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                        border: `1px solid ${bizType === bt.value ? G : 'rgba(255,255,255,0.1)'}`,
                        background: bizType === bt.value ? `${G}18` : 'rgba(255,255,255,0.03)',
                        color: '#f1f5f9', fontFamily: 'inherit' }}>
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
                <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8',
                  display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {f.label}
                </label>
                <input type={f.type} value={f.value}
                  onChange={e => f.set(e.target.value)}
                  placeholder={f.ph} maxLength={f.max} style={inp} />
              </div>
            ))}

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
                    border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8',
                    fontFamily: 'inherit', cursor: 'pointer', fontSize: 14 }}>
                  ← Back
                </button>
              )}
              <button onClick={finish} disabled={saving || !bizName.trim()}
                style={{ flex: 1, padding: '14px', borderRadius: 12, border: 'none',
                  background: bizName.trim()
                    ? `linear-gradient(135deg,${G},#059669)`
                    : 'rgba(255,255,255,0.06)',
                  color: bizName.trim() ? '#fff' : '#475569',
                  fontSize: 15, fontWeight: 700,
                  cursor: bizName.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                {saving ? 'Saving…' : editMode ? 'Save Changes ✓' : 'Launch Business ✓'}
              </button>
            </div>

            {editMode && (
              <button onClick={() => router.replace('/b/dashboard')}
                style={{ width: '100%', padding: '10px', borderRadius: 10, background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.08)', color: '#64748b',
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
