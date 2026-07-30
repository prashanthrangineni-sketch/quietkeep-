'use client';
// src/app/contacts/page.jsx — Contacts hub (Truecaller-style utility, your data only)
//
// WHY THIS PAGE EXISTS
// matchContactByName() already resolves "call Ravi" / "message amma" against the
// contacts table — but nothing bulk-populated it, so voice actions had an empty
// phonebook for every real user. This page fills it, with explicit consent.
//
// SYNC PATHS (best available wins):
//   1. NATIVE BRIDGE — window.__QK_CONTACTS__.getAll() -> [{name, phones[], emails[]}]
//      Implemented by the Android app (Capacitor Contacts + READ_CONTACTS with
//      Play-compliant disclosure). Full phonebook, re-syncable.
//   2. WEB CONTACT PICKER — navigator.contacts.select (Chrome Android/PWA).
//      User multi-selects; no permission persists. Honest partial sync.
//   3. Neither -> explain, point at the Android app.
//
// SMS/call-log sync is deliberately ABSENT: Play restricts those permission
// groups to default-handler apps. Messages reach QuietKeep via the share sheet
// (/finance/import) and, later, the opt-in native notification listener.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { supabase } from '@/lib/supabase';
import {
  AuroraPage, PageHeader, SectionTitle, Grid, GlassCard,
  StatTile, NudgeCard, Pill, EmptyState, SkeletonCard,
} from '@/components/aurora';

export default function ContactsPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [consent, setConsent] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const hasNativeBridge = typeof window !== 'undefined' && !!window.__QK_CONTACTS__?.getAll;
  const hasWebPicker = typeof window !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from('contacts')
      .select('id,name,phone,email,relation,avatar_emoji,is_favorite,source')
      .eq('user_id', user.id).order('is_favorite', { ascending: false }).order('name');
    setContacts(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    load();
  }, [user, authLoading, router, load]);

  async function pullDeviceContacts() {
    // Native bridge first — full phonebook.
    if (hasNativeBridge) {
      const raw = await window.__QK_CONTACTS__.getAll();
      return (raw || []).map(c => ({
        name: c.name, phone: c.phones?.[0] || c.phone || null, email: c.emails?.[0] || c.email || null,
      }));
    }
    // Web picker — user multi-selects.
    const picked = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true });
    return (picked || []).map(p => ({
      name: p.name?.[0] || null, phone: p.tel?.[0] || null, email: p.email?.[0] || null,
    }));
  }

  async function syncNow() {
    if (!consent || syncing) return;
    setSyncing(true); setError(null); setResult(null);
    try {
      const device = await pullDeviceContacts();
      if (!device.length) { setError('No contacts selected.'); setSyncing(false); return; }
      const res = await fetch('/api/contacts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ contacts: device, consent: true, source: hasNativeBridge ? 'native' : 'web' }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) setError(j?.error || `Sync failed (${res.status})`);
      else { setResult(j); await load(); }
    } catch (e) {
      setError(e?.message || 'Could not read device contacts');
    }
    setSyncing(false);
  }

  async function toggleFavorite(c) {
    const next = !c.is_favorite;
    setContacts(prev => prev.map(x => x.id === c.id ? { ...x, is_favorite: next } : x));
    const { error } = await supabase.from('contacts').update({ is_favorite: next }).eq('id', c.id).eq('user_id', user.id);
    if (error) { // revert — the UI must tell the truth
      setContacts(prev => prev.map(x => x.id === c.id ? { ...x, is_favorite: !next } : x));
    }
  }

  const filtered = contacts.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search));
  const voiceReady = contacts.filter(c => c.phone).length;

  return (
    <AuroraPage mode="personal">
      <PageHeader
        title="Contacts"
        subtitle='Sync your phonebook so "call Ravi" and "message amma" just work.'
      />

      {result && (
        <NudgeCard
          title={`${result.synced} contact${result.synced === 1 ? '' : 's'} synced`}
          body={
            `Say "call ${contacts[0]?.name?.split(' ')[0] || 'anyone'}" to try it.` +
            (result.linked_customers ? ` ${result.linked_customers} khata customer${result.linked_customers === 1 ? '' : 's'} became reachable for payment reminders.` : '')
          }
          icon="✅" tone="emerald" onDismiss={() => setResult(null)}
        />
      )}
      {error && (
        <NudgeCard title="Sync problem" body={error} icon="⚠️" tone="amber" onDismiss={() => setError(null)} />
      )}

      <Grid min={150}>
        <StatTile label="Contacts" value={contacts.length} hue="#6366f1" />
        <StatTile label="Voice-ready" value={voiceReady} hue="#10b981" hint="have a phone number" />
        <StatTile label="Favorites" value={contacts.filter(c => c.is_favorite).length} hue="#ec4899" />
      </Grid>

      <SectionTitle hint={hasNativeBridge ? 'full phonebook (app)' : hasWebPicker ? 'pick from phonebook' : 'not available here'}>
        Sync your phonebook
      </SectionTitle>
      <GlassCard>
        {(hasNativeBridge || hasWebPicker) ? (
          <>
            <label className="qk-consent">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
              <span>
                I agree to store my selected contacts (names, numbers, emails) in my QuietKeep
                account so voice actions can reach them. Only I can see them, and I can delete
                them anytime. Nothing is shared with other users.
              </span>
            </label>
            <button type="button" className="qk-btn-primary" onClick={syncNow} disabled={!consent || syncing}>
              {syncing ? 'Syncing…' : hasNativeBridge ? 'Sync full phonebook' : 'Pick contacts to sync'}
            </button>
          </>
        ) : (
          <p className="qk-note">
            Phonebook sync needs the QuietKeep Android app, or Chrome on Android.
            You can still add contacts from the reminder and message screens.
          </p>
        )}
      </GlassCard>

      <SectionTitle hint={`${filtered.length} shown`}>Your people</SectionTitle>
      <input
        className="qk-search" placeholder="Search name or number…"
        value={search} onChange={e => setSearch(e.target.value)}
      />

      {loading ? (
        <Grid min={240}><SkeletonCard lines={2} /><SkeletonCard lines={2} /></Grid>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📇"
          title={contacts.length ? 'No matches' : 'No contacts yet'}
          body={contacts.length ? 'Try a different search.' : 'Sync your phonebook above — voice actions get much smarter with it.'}
        />
      ) : (
        <div className="qk-stack">
          {filtered.map(c => (
            <GlassCard key={c.id} className="qk-crow">
              <span className="qk-cavatar" aria-hidden="true">{c.avatar_emoji || '👤'}</span>
              <span className="qk-cmain">
                <strong>{c.name}</strong>
                <span className="qk-csub">{c.phone || 'no number'}{c.relation ? ` · ${c.relation}` : ''}</span>
              </span>
              <span className="qk-cend">
                {c.source?.startsWith('device_sync') && <Pill>synced</Pill>}
                <button
                  type="button" className="qk-star" onClick={() => toggleFavorite(c)}
                  aria-label={c.is_favorite ? `Unfavorite ${c.name}` : `Favorite ${c.name}`}
                  aria-pressed={!!c.is_favorite}
                >{c.is_favorite ? '★' : '☆'}</button>
              </span>
            </GlassCard>
          ))}
        </div>
      )}

      <style jsx global>{`
        .qk-stack { display: flex; flex-direction: column; gap: 9px; }
        .qk-consent { display: flex; gap: 10px; align-items: flex-start; font-size: 13px;
          color: var(--muted); line-height: 1.55; margin-bottom: 12px; cursor: pointer; }
        .qk-consent input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--a1); flex: none; }
        .qk-btn-primary { border: 0; border-radius: 13px; padding: 12px 18px; font-size: 14.5px;
          font-weight: 700; color: #fff; cursor: pointer;
          background: linear-gradient(92deg, var(--a1), var(--a2));
          box-shadow: 0 8px 22px rgba(99,102,241,0.3); }
        .qk-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
        .qk-btn-primary:focus-visible { outline: 3px solid var(--a2); outline-offset: 3px; }
        .qk-search { width: 100%; padding: 12px 15px; border-radius: 13px; font-size: 14px;
          border: 1px solid rgba(255,255,255,0.9); background: rgba(255,255,255,0.8);
          margin-bottom: 10px; color: var(--ink); }
        .qk-search:focus-visible { outline: 2px solid var(--a1); outline-offset: 1px; }
        .qk-crow { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
        .qk-cavatar { font-size: 22px; flex: none; }
        .qk-cmain { flex: 1; min-width: 0; }
        .qk-cmain strong { display: block; font-size: 14.5px; }
        .qk-csub { font-size: 12.5px; color: var(--muted); }
        .qk-cend { display: flex; align-items: center; gap: 8px; flex: none; }
        .qk-star { border: 0; background: transparent; font-size: 20px; cursor: pointer;
          color: #f59e0b; line-height: 1; padding: 2px 4px; }
        .qk-star:focus-visible { outline: 2px solid var(--a1); outline-offset: 2px; border-radius: 6px; }
        .qk-note { margin: 0; font-size: 13.5px; color: var(--muted); line-height: 1.6; }
      `}</style>
    </AuroraPage>
  );
}
