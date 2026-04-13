'use client';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/b/dashboard/page.jsx
 * CHANGE: Added /b/chat to quick action grid (replaced /b/geo with /b/team,
 * added Chat and Team to the grid, now 3×3).
 * FIX: Added push registration so business APK users receive reminders + nudges.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
// FIX BUG-2: Import push registration — was missing, causing 0 business device tokens
import { registerNativePush } from '@/lib/capacitor/voice';
import BizNavbar from '@/components/biz/BizNavbar';
import Link from 'next/link';
import { apiPost } from '@/lib/safeFetch';

const G      = '#10b981';
const G_DIM  = 'rgba(16,185,129,0.1)';
const G_GLOW = 'rgba(16,185,129,0.25)';

export default function BizDashboardPage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const router = useRouter();
  const [workspace, setWorkspace]     = useState(null);
  const [loading, setLoading]         = useState(true);
  const [stats, setStats]             = useState({
    todayCredit: 0, todayDebit: 0, pendingDues: 0,
    presentToday: 0, totalStaff: 0, lowStockCount: 0, complianceUrgent: 0,
  });
  const [recentLedger, setRecentLedger] = useState([]);
  const [voiceText, setVoiceText]     = useState('');
  const [listening, setListening]     = useState(false);
  const [savingVoice, setSavingVoice] = useState(false);
  const [voiceMsg, setVoiceMsg]       = useState('');
  const [openLoopCount, setOpenLoopCount] = useState(0);

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    if (user?.id) loadWorkspace(user.id);
  }, [user, authLoading, router]);

  const loadWorkspace = useCallback(async (uid) => {
    const { data: ws } = await supabase
      .from('business_workspaces').select('*')
      .eq('owner_user_id', uid).maybeSingle();
    if (!ws) { router.replace('/b/onboarding'); return; }
    setWorkspace(ws);
    await loadStats(ws.id);
    fetch('/api/keeps/loop-count')
      .then(r => r.json()).then(d => setOpenLoopCount(d.count || 0)).catch(() => {});
    setLoading(false);
    // FIX BUG-2: Register push token for business APK.
    // getAppType() in voice.ts reads window.__QK_APP_TYPE__ which MainActivity
    // injects as 'business' for com.pranix.quietkeep.business — so app_type
    // will be correctly sent as 'business' to the push/register API.
    if (accessToken) registerNativePush(accessToken, '').catch(() => {});
  }, [router]);

  async function loadStats(wsId) {
    const today = new Date().toISOString().split('T')[0];
    const [ledger, attendance, members, inventory, compliance] = await Promise.all([
      supabase.from('business_ledger').select('entry_type,amount,payment_status,amount_pending')
        .eq('workspace_id', wsId).eq('transaction_date', today),
      supabase.from('attendance_logs').select('status')
        .eq('workspace_id', wsId).eq('log_date', today),
      supabase.from('business_members').select('id')
        .eq('workspace_id', wsId).eq('status', 'active'),
      supabase.from('inventory_items').select('id,current_stock,min_stock_alert')
        .eq('workspace_id', wsId).eq('status', 'active'),
      supabase.from('compliance_reminders').select('id')
        .eq('workspace_id', wsId).eq('status', 'pending')
        .lte('due_date', new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]),
    ]);
    const ld = ledger.data || [];
    setStats({
      todayCredit:       ld.filter(l => l.entry_type === 'credit').reduce((s, l) => s + parseFloat(l.amount), 0),
      todayDebit:        ld.filter(l => l.entry_type === 'debit').reduce((s, l) => s + parseFloat(l.amount), 0),
      pendingDues:       ld.filter(l => l.payment_status === 'pending').reduce((s, l) => s + parseFloat(l.amount_pending || 0), 0),
      presentToday:      (attendance.data || []).filter(a => a.status === 'present').length,
      totalStaff:        (members.data || []).length,
      lowStockCount:     (inventory.data || []).filter(i => parseFloat(i.current_stock) <= parseFloat(i.min_stock_alert)).length,
      complianceUrgent:  compliance.count || (compliance.data || []).length,
    });
    const { data: recent } = await supabase.from('business_ledger')
      .select('entry_type,party_name,amount,description,transaction_date,payment_method')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false }).limit(5);
    setRecentLedger(recent || []);
  }

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Voice not supported on this browser'); return; }
    const rec = new SR();
    rec.lang = 'en-IN'; rec.continuous = false; rec.interimResults = false;
    rec.onresult = e => { setVoiceText(e.results[0][0].transcript); };
    rec.onerror = () => setListening(false);
    rec.onend   = () => setListening(false);
    rec.start(); setListening(true);
  }

  async function saveLedgerEntry() {
    if (!voiceText.trim() || !workspace) return;
    setSavingVoice(true);
    try {
      if (!accessToken) throw new Error('no session');
      const { data, error } = await apiPost('/api/voice/capture', {
        transcript: voiceText.trim(), source: 'voice',
        workspace_id: workspace.id, language: 'en-IN',
      }, accessToken);
      if (!error && data) {
        const biz  = data.biz_entry;
        let msg    = data.tts_response || '✓ Entry saved';
        if (biz?.amount) {
          msg = `${biz.entry_type === 'credit' ? '✓ Income' : '✓ Expense'} \u20b9${biz.amount.toLocaleString('en-IN')} recorded`;
        }
        setVoiceMsg(msg); setVoiceText(''); loadStats(workspace.id);
      } else {
        setVoiceMsg('⚠ ' + (error || 'Could not save. Try again.'));
      }
    } catch (e) {
      try {
        const text  = voiceText.toLowerCase();
        const type  = /received|paid me|collected|sale/.test(text) ? 'credit' : 'debit';
        const amtM  = voiceText.match(/[₹]?\s*(\d+[\d,]*)/);
        const amount = amtM ? parseFloat(amtM[1].replace(',', '')) : 0;
        const partyM = voiceText.match(/(?:from|to|by|for)\s+([A-Za-z]+)/i);
        await supabase.from('business_ledger').insert({
          workspace_id: workspace.id, entry_type: type, amount: amount || 1,
          description: voiceText, party_name: partyM ? partyM[1] : null,
          payment_method: 'cash', payment_status: 'paid',
          source: 'voice', voice_transcript: voiceText, created_by: user.id,
        });
        setVoiceMsg(type === 'credit' ? `✓ Income \u20b9${amount} recorded` : `✓ Expense \u20b9${amount} recorded`);
        setVoiceText(''); loadStats(workspace.id);
      } catch { setVoiceMsg('⚠ Error saving entry'); }
    } finally {
      setSavingVoice(false);
      setTimeout(() => setVoiceMsg(''), 4000);
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex',
      alignItems: 'center', justifyContent: 'center' }}>
      <div className="qk-spinner" />
    </div>
  );

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

  // CHANGE: added /b/chat and /b/team, now 9 items in 3×3 grid
  const QUICK_ACTIONS = [
    { href: '/b/attendance', icon: '👥', label: 'Attend' },
    { href: '/b/invoices',   icon: '🧾', label: 'Invoice' },
    { href: '/b/chat',       icon: '💬', label: 'Chat' },    // ← NEW
    { href: '/b/payroll',    icon: '💳', label: 'Payroll' },
    { href: '/b/inventory',  icon: '📦', label: 'Stock' },
    { href: '/b/team',       icon: '👨‍💼', label: 'Team' },    // ← NEW
    { href: '/b/customers',  icon: '🤝', label: 'Clients' },
    { href: '/b/tasks',      icon: '✅', label: 'Tasks' },
    { href: '/b/compliance', icon: '⚖️', label: 'Comply' },
  ];

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56,
      paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px) + 16px)',
      color: 'var(--text)' }}>
      <BizNavbar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)',
                letterSpacing: '-0.5px', margin: 0 }}>
                {workspace?.name}
              </h1>
              <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 3 }}>{today}</p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Link href="/b/invoices" className="qk-btn qk-btn-sm"
                style={{ background: G_DIM, border: `1px solid ${G_GLOW}`, color: G,
                  textDecoration: 'none', fontSize: 11, padding: '6px 12px' }}>
                + Invoice
              </Link>
            </div>
          </div>
        </div>

        {openLoopCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
            borderRadius: 8, padding: '8px 12px', marginBottom: 14,
            fontSize: 13, color: '#d97706' }}>
            <span style={{ fontWeight: 700 }}>⚠ {openLoopCount}</span>
            <span>open {openLoopCount === 1 ? 'loop' : 'loops'} — unresolved</span>
          </div>
        )}

        {/* Today P&L */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[
            { label: "Today's Income",  value: ('₹' + (stats.todayCredit.toLocaleString('en-IN'))),  icon: '📈', color: G,        bg: G_DIM },
            { label: "Today's Expense", value: ('₹' + (stats.todayDebit.toLocaleString('en-IN'))),   icon: '📉', color: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
            { label: 'Pending Dues',    value: ('₹' + (stats.pendingDues.toLocaleString('en-IN'))),  icon: '⏳', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
            { label: 'Net Today',
              value: ('₹' + ((stats.todayCredit - stats.todayDebit).toLocaleString('en-IN'))),
              icon: '💰',
              color: stats.todayCredit >= stats.todayDebit ? G : '#ef4444',
              bg: 'var(--surface)' },
          ].map(s => (
            <div key={s.label} className="qk-card"
              style={{ padding: '14px', background: s.bg, border: `1px solid ${s.color}20` }}>
              <div style={{ fontSize: 16, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: s.color,
                letterSpacing: '-0.5px' }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-subtle)',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Staff + alerts */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 20 }}>
          {[
            { icon: '👥', label: 'Present',   value: `${stats.presentToday}/${stats.totalStaff}`, href: '/b/attendance', color: G },
            { icon: '📦', label: 'Low Stock',  value: stats.lowStockCount, href: '/b/inventory', color: stats.lowStockCount > 0 ? '#f59e0b' : 'var(--text-subtle)' },
            { icon: '⚖️', label: 'Due Soon',   value: stats.complianceUrgent, href: '/b/compliance', color: stats.complianceUrgent > 0 ? '#ef4444' : 'var(--text-subtle)' },
          ].map(s => (
            <Link key={s.label} href={s.href} style={{ textDecoration: 'none' }}>
              <div className="qk-card" style={{ padding: '12px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)',
                  textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Voice ledger */}
        <div className="qk-card"
          style={{ padding: 16, marginBottom: 20, border: `1px solid ${G_GLOW}`, background: G_DIM }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: G, marginBottom: 10 }}>
            🎙️ Voice Ledger Entry
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 10 }}>
            Say: "Raju paid ₹500" or "Paid electricity ₹2000"
          </div>
          {voiceText && (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--text)',
              marginBottom: 10, fontStyle: 'italic' }}>
              "{voiceText}"
            </div>
          )}
          {voiceMsg && (
            <div style={{ color: G, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              {voiceMsg}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={startVoice} disabled={listening} className="qk-btn qk-btn-sm"
              style={{ flex: 1, justifyContent: 'center',
                background: listening ? G : 'transparent',
                border: `1.5px solid ${G}`, color: listening ? '#fff' : G }}>
              {listening ? '🔴 Listening...' : '🎙️ Speak'}
            </button>
            {voiceText && (
              <button onClick={saveLedgerEntry} disabled={savingVoice} className="qk-btn qk-btn-sm"
                style={{ flex: 1, justifyContent: 'center', background: G, color: '#fff', border: 'none' }}>
                {savingVoice ? 'Saving...' : '✓ Save'}
              </button>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <input value={voiceText} onChange={e => setVoiceText(e.target.value)}
              placeholder="Or type here..." className="qk-input" style={{ fontSize: 13 }} />
          </div>
        </div>

        {/* Recent ledger */}
        {recentLedger.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                Recent Transactions
              </div>
              <Link href="/b/ledger" style={{ fontSize: 12, color: G, textDecoration: 'none' }}>
                View all →
              </Link>
            </div>
            {recentLedger.map((l, i) => (
              <div key={i} className="qk-card"
                style={{ padding: '12px 14px', marginBottom: 6,
                  display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>
                  {l.entry_type === 'credit' ? '📈' : '📉'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.party_name || l.description || 'Entry'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                    {l.payment_method} · {l.transaction_date}
                  </div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, flexShrink: 0,
                  color: l.entry_type === 'credit' ? G : '#ef4444' }}>
                  {l.entry_type === 'credit' ? '+' : '-'}₹{parseFloat(l.amount).toLocaleString('en-IN')}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick actions — 3×3 grid with Chat + Team added */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {QUICK_ACTIONS.map(q => (
            <Link key={q.href} href={q.href} style={{ textDecoration: 'none' }}>
              <div className="qk-card"
                style={{ padding: '12px 6px', textAlign: 'center', transition: 'all 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = G_GLOW}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{q.icon}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                  letterSpacing: '0.02em' }}>{q.label}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
        }
