// src/app/dashboard/engine-health/page.jsx
// Engine health dashboard — realtime stats, nudge breakdown, delivery status
// Server-rendered. Reads from get_system_health() via Supabase.

import { createSupabaseServerClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function getData() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: health } = await supabase.rpc('get_system_health', { p_hours_back: 24 });
  const { data: recentNudges } = await supabase
    .from('nudge_queue')
    .select('id,title,nudge_type,delivery_status,delivered,failed_at,retry_count,domain_type,created_at,delivered_at')
    .order('created_at', { ascending: false })
    .limit(20);
  const { data: recentErrors } = await supabase
    .from('nudge_queue')
    .select('id,title,last_error,retry_count,failed_at,domain_type')
    .not('failed_at', 'is', null)
    .order('failed_at', { ascending: false })
    .limit(10);

  return { health, recentNudges: recentNudges || [], recentErrors: recentErrors || [] };
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12,
      padding:'16px 20px', minWidth:140,
    }}>
      <p style={{ fontSize:28, fontWeight:700, color: color || 'var(--foreground)', margin:0 }}>{value ?? '—'}</p>
      <p style={{ fontSize:12, color:'var(--muted)', margin:'4px 0 0' }}>{label}</p>
      {sub && <p style={{ fontSize:11, color:'var(--muted)', opacity:0.7, marginTop:2 }}>{sub}</p>}
    </div>
  );
}

function Badge({ text, color }) {
  const bg = { green:'rgba(34,197,94,0.15)', red:'rgba(239,68,68,0.15)', amber:'rgba(245,158,11,0.15)', blue:'rgba(99,102,241,0.15)' };
  const fg = { green:'#22c55e', red:'#ef4444', amber:'#f59e0b', blue:'#6366f1' };
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600,
      background: bg[color] || bg.blue, color: fg[color] || fg.blue }}>
      {text}
    </span>
  );
}

export default async function EngineHealthPage() {
  const { health, recentNudges, recentErrors } = await getData();
  const h = health || {};
  const nudges  = h.nudges  || {};
  const evals   = h.evaluations || {};
  const signals = h.signals || {};
  const keeps   = h.keeps   || {};

  return (
    <div style={{ maxWidth:900, margin:'0 auto', padding:'32px 16px', fontFamily:'inherit' }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:20, fontWeight:700, color:'var(--foreground)', margin:0 }}>Engine Health</h1>
        <p style={{ fontSize:12, color:'var(--muted)', marginTop:4 }}>
          Last 24 hours · refreshes on page load · {h.generated_at ? new Date(h.generated_at).toLocaleTimeString() : ''}
        </p>
      </div>

      {/* Nudge stats */}
      <p style={{ fontSize:13, fontWeight:600, color:'var(--muted)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}>DELIVERY</p>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:28 }}>
        <StatCard label="Nudges Sent"    value={nudges.sent}        color="#22c55e" />
        <StatCard label="Pending"        value={nudges.pending}     color="#f59e0b" />
        <StatCard label="Failed"         value={nudges.failed}      color="#ef4444" />
        <StatCard label="Skipped"        value={nudges.skipped ?? (nudges.total - nudges.sent - nudges.failed)} />
        <StatCard label="Success Rate"   value={`${nudges.success_rate ?? 0}%`} color="#6366f1" />
      </div>

      {/* Channel breakdown */}
      <p style={{ fontSize:13, fontWeight:600, color:'var(--muted)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}>CHANNELS</p>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:28 }}>
        <StatCard label="Push"      value={nudges.push_sent    ?? 0} sub="OneSignal" />
        <StatCard label="WhatsApp"  value={nudges.wa_sent      ?? 0} sub="Twilio" />
        <StatCard label="Email"     value={nudges.email_sent   ?? 0} sub="Resend" />
        <StatCard label="In-App"    value={nudges.inapp_sent   ?? 0} sub="Realtime" />
      </div>

      {/* Evaluation + Signal stats */}
      <p style={{ fontSize:13, fontWeight:600, color:'var(--muted)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}>ENGINE</p>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:28 }}>
        <StatCard label="Keeps Created"    value={keeps.total} />
        <StatCard label="Evals Processed"  value={evals.total} />
        <StatCard label="Nudges Queued"    value={evals.nudged} />
        <StatCard label="Skip Rate"        value={`${evals.skip_rate ?? 0}%`} sub="context mismatch / dedup" />
        <StatCard label="Signals Ingested" value={signals.total} />
      </div>

      {/* Recent nudge log */}
      <p style={{ fontSize:13, fontWeight:600, color:'var(--muted)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}>RECENT NUDGES</p>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', marginBottom:28 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ background:'var(--background)' }}>
              {['Title','Type','Domain','Status','Retries','Created'].map(h => (
                <th key={h} style={{ padding:'10px 12px', textAlign:'left', color:'var(--muted)', fontWeight:600, borderBottom:'1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentNudges.length === 0 ? (
              <tr><td colSpan={6} style={{ padding:'20px', textAlign:'center', color:'var(--muted)' }}>No nudges yet</td></tr>
            ) : recentNudges.map(n => (
              <tr key={n.id} style={{ borderBottom:'1px solid var(--border)' }}>
                <td style={{ padding:'10px 12px', color:'var(--foreground)' }}>{(n.title || '—').slice(0, 40)}</td>
                <td style={{ padding:'10px 12px', color:'var(--muted)' }}>{n.nudge_type}</td>
                <td style={{ padding:'10px 12px' }}>
                  <Badge text={n.domain_type || 'personal'} color={n.domain_type === 'business' ? 'blue' : 'green'} />
                </td>
                <td style={{ padding:'10px 12px' }}>
                  {n.failed_at ? <Badge text="failed" color="red" />
                    : n.delivered ? <Badge text="delivered" color="green" />
                    : <Badge text="pending" color="amber" />}
                </td>
                <td style={{ padding:'10px 12px', color:'var(--muted)' }}>{n.retry_count || 0}</td>
                <td style={{ padding:'10px 12px', color:'var(--muted)' }}>{new Date(n.created_at).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Errors */}
      {recentErrors.length > 0 && (
        <>
          <p style={{ fontSize:13, fontWeight:600, color:'#ef4444', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}>RECENT ERRORS</p>
          <div style={{ background:'var(--surface)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:12, overflow:'hidden', marginBottom:28 }}>
            {recentErrors.map(e => (
              <div key={e.id} style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                <p style={{ color:'var(--foreground)', margin:0 }}>{e.title}</p>
                <p style={{ color:'#ef4444', margin:'4px 0 0' }}>{e.last_error}</p>
                <p style={{ color:'var(--muted)', margin:'2px 0 0' }}>Retries: {e.retry_count} · {e.failed_at && new Date(e.failed_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <p style={{ fontSize:11, color:'var(--muted)', textAlign:'center' }}>
        Engine: 8 cron jobs · 4 realtime tables · 10 engine functions · proactive-nudges v8
      </p>
    </div>
  );
}
