'use client';
// src/app/b/collections/page.jsx
// COLLECTIONS COCKPIT — the UI for automated WhatsApp dunning (SOT P3).
//
// The dunning API (#48) had no surface, so a shopkeeper couldn't actually use it.
// This is that surface, and it deliberately mirrors the API's safety model:
//   1. it PREVIEWS first (GET) — nothing is sent on load
//   2. the merchant picks who to remind
//   3. sending is an explicit button press
// Customers who can't be reached are shown WITH the reason rather than hidden,
// because "why is nobody being reminded?" is the question this screen must answer.
//
// Also the first real business screen on the Aurora kit (SOT P5), so it doubles
// as the adoption reference for the rest of /b/*.
import { useState, useEffect, useCallback } from 'react';
import { resolveWorkspace } from '@/lib/resolve-workspace';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { supabase } from '@/lib/supabase';
import { apiGet, apiPost } from '@/lib/safeFetch';
import BizNavbar from '@/components/biz/BizNavbar';
import {
  AuroraPage, PageHeader, SectionTitle, Grid, GlassCard,
  StatTile, NudgeCard, Pill, EmptyState, SkeletonCard,
} from '@/components/aurora';

const SKIP_LABEL = {
  already_reminded_at_this_stage: 'Already reminded at this stage',
  no_customer_record: 'No customer record — add them to Customers',
  no_phone_number: 'No phone number saved',
  not_opted_in_to_whatsapp: 'Not opted in to WhatsApp',
};
const STAGE_TONE = { 15: 'danger', 7: 'warn', 3: 'default' };

export default function CollectionsPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet('/api/business/dunning', accessToken);
      if (res?.error) setError(res.error);
      else {
        setData(res);
        // Pre-select everyone we can actually reach — the common case is
        // "remind all of them", but it stays visible and editable.
        setSelected(new Set((res.candidates || []).filter(c => c.reachable).map(c => c.ledger_id)));
      }
    } catch (e) {
      setError(e?.message || 'Could not load collections');
    }
    setLoading(false);
  }, [accessToken]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
      const ws = await resolveWorkspace(supabase, user.id, 'id,name');
      if (!ws) { router.replace('/b/onboarding'); return; }
      setWorkspace(ws);
      load();
    })();
  }, [user, authLoading, router, load]);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function sendReminders() {
    if (!selected.size || sending) return;
    setSending(true);
    setResult(null);
    setError(null);
    try {
      const res = await apiPost('/api/business/dunning',
        { ledger_ids: Array.from(selected), include_pay_link: true }, accessToken);
      if (res?.error) setError(res.error);
      else { setResult(res); await load(); }
    } catch (e) {
      setError(e?.message || 'Could not send reminders');
    }
    setSending(false);
  }

  const candidates = data?.candidates || [];
  const reachable = candidates.filter(c => c.reachable);
  const blocked = candidates.filter(c => !c.reachable);

  return (
    <AuroraPage mode="business">
      <BizNavbar />

      <PageHeader
        title="Collections"
        subtitle="Overdue parties, and a WhatsApp reminder with a pay link. Nothing is sent until you press send."
        action={
          <button type="button" className="qk-btn-ghost" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {error && (
        <NudgeCard
          title="Couldn't load collections"
          body={error}
          icon="⚠️"
          tone="amber"
          onDismiss={() => setError(null)}
        />
      )}

      {result && (
        <NudgeCard
          title={`${result.sent} reminder${result.sent === 1 ? '' : 's'} sent`}
          body={
            (result.failed ? `${result.failed} failed. ` : '') +
            'Paid reminders post to the ledger and clear the khata automatically.'
          }
          icon="✅"
          tone="emerald"
          onDismiss={() => setResult(null)}
        />
      )}

      <Grid min={168}>
        <StatTile label="Overdue parties" value={candidates.length} hue="#0ea5e9" />
        <StatTile label="Can remind now"  value={reachable.length}  hue="#10b981"
                  hint={blocked.length ? `${blocked.length} unreachable` : undefined} />
        <StatTile label="Total overdue"   value={Math.round(data?.total_due || 0)} prefix="₹" hue="#f59e0b" />
      </Grid>

      <SectionTitle hint={selected.size ? `${selected.size} selected` : 'select who to remind'}>
        Ready to remind
      </SectionTitle>

      {loading ? (
        <Grid min={260}><SkeletonCard lines={3} /><SkeletonCard lines={3} /></Grid>
      ) : reachable.length === 0 ? (
        <EmptyState
          icon="🎉"
          title="Nobody to chase"
          body={
            blocked.length
              ? 'No one can be reminded right now — see the list below for why.'
              : 'No overdue payments. Everything is settled.'
          }
        />
      ) : (
        <div className="qk-stack">
          {reachable.map(c => (
            <GlassCard key={c.ledger_id} interactive className="qk-row">
              <label className="qk-row-main">
                <input
                  type="checkbox"
                  checked={selected.has(c.ledger_id)}
                  onChange={() => toggle(c.ledger_id)}
                  aria-label={`Remind ${c.party_name}`}
                />
                <span>
                  <strong>{c.party_name}</strong>
                  <span className="qk-row-sub">{c.phone}</span>
                </span>
              </label>
              <div className="qk-row-end">
                <Pill tone={STAGE_TONE[c.stage] || 'default'}>{c.days_overdue}d overdue</Pill>
                <strong className="qk-amt">₹{Number(c.due_amount).toLocaleString('en-IN')}</strong>
              </div>
            </GlassCard>
          ))}

          <button
            type="button"
            className="qk-btn-primary"
            onClick={sendReminders}
            disabled={!selected.size || sending}
          >
            {sending
              ? 'Sending…'
              : `Send ${selected.size} WhatsApp reminder${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {blocked.length > 0 && (
        <>
          <SectionTitle hint="fix these to reach them">Can't remind yet</SectionTitle>
          <div className="qk-stack">
            {blocked.map(c => (
              <GlassCard key={c.ledger_id} className="qk-row qk-row-muted">
                <span>
                  <strong>{c.party_name}</strong>
                  <span className="qk-row-sub">{SKIP_LABEL[c.skip_reason] || c.skip_reason}</span>
                </span>
                <div className="qk-row-end">
                  <Pill tone="warn">{c.days_overdue}d</Pill>
                  <strong className="qk-amt">₹{Number(c.due_amount).toLocaleString('en-IN')}</strong>
                </div>
              </GlassCard>
            ))}
          </div>
        </>
      )}

      <style jsx global>{`
        .qk-stack { display: flex; flex-direction: column; gap: 10px; }
        .qk-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .qk-row-muted { opacity: 0.72; }
        .qk-row-main { display: flex; align-items: center; gap: 11px; cursor: pointer; min-width: 0; }
        .qk-row-main input { width: 18px; height: 18px; accent-color: var(--a1); flex: none; }
        .qk-row-sub { display: block; font-size: 12.5px; color: var(--muted); margin-top: 2px; }
        .qk-row-end { display: flex; align-items: center; gap: 10px; flex: none; }
        .qk-amt { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .qk-btn-primary {
          margin-top: 4px; border: 0; border-radius: 13px; padding: 13px 18px;
          font-size: 14.5px; font-weight: 700; color: #fff; cursor: pointer;
          background: linear-gradient(92deg, var(--a1), var(--a2));
          box-shadow: 0 8px 22px rgba(14,165,233,0.3);
        }
        .qk-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
        .qk-btn-primary:focus-visible { outline: 3px solid var(--a2); outline-offset: 3px; }
        .qk-btn-ghost {
          border: 1px solid rgba(255,255,255,0.9); background: rgba(255,255,255,0.7);
          border-radius: 999px; padding: 8px 15px; font-size: 13px; font-weight: 600;
          color: var(--ink); cursor: pointer;
        }
        .qk-btn-ghost:disabled { opacity: 0.6; cursor: not-allowed; }
        .qk-btn-ghost:focus-visible { outline: 2px solid var(--a1); outline-offset: 2px; }
      `}</style>
    </AuroraPage>
  );
}
