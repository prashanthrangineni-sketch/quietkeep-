'use client';
// src/app/caller-context/page.jsx — Track A1 Caller Context Moat Screen
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import {
  AuroraPage, PageHeader, GlassCard, StatTile,
  NudgeCard, Pill, SectionTitle, SkeletonCard
} from '@/components/aurora';

export default function CallerContextPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const phone = searchParams.get('phone');
  const { user, accessToken, loading: authLoading } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!phone) {
      setError('No phone number provided');
      setLoading(false);
      return;
    }

    async function fetchCallerContext() {
      try {
        const res = await fetch(`/api/caller-context?phone=${encodeURIComponent(phone)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          throw new Error(`Failed to load caller context (${res.status})`);
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err.message || 'Error loading caller data');
      } finally {
        setLoading(false);
      }
    }

    fetchCallerContext();
  }, [phone, user, accessToken, authLoading, router]);

  if (loading) {
    return (
      <AuroraPage mode="business">
        <PageHeader title="Incoming Call Context" subtitle="Fetching caller notes and khata..." />
        <SkeletonCard />
      </AuroraPage>
    );
  }

  if (error || !data) {
    return (
      <AuroraPage mode="business">
        <PageHeader title="Incoming Call Context" subtitle={`Phone: ${phone || 'Unknown'}`} />
        <GlassCard>
          <p className="text-red-500 font-medium">{error || 'Caller context not found'}</p>
        </GlassCard>
      </AuroraPage>
    );
  }

  const { name, avatar_emoji, khata, notes, keeps } = data;
  const isOverdue = khata?.days_overdue > 0;
  const hasKhata = khata?.outstanding > 0;

  return (
    <AuroraPage mode="business">
      <PageHeader
        title={`${avatar_emoji || '👤'} ${name}`}
        subtitle={`Incoming Call · ${phone}`}
        action={<Pill variant={hasKhata ? 'warning' : 'success'}>{hasKhata ? 'Khata Active' : 'Clean Slate'}</Pill>}
      />

      {hasKhata && (
        <NudgeCard
          title={`₹${khata.outstanding.toLocaleString('en-IN')} Outstanding`}
          subtitle={
            isOverdue
              ? `${khata.days_overdue} days overdue · Last promise: ${khata.last_promise || 'None'}`
              : `Payment due soon · Last promise: ${khata.last_promise || 'None'}`
          }
          variant={isOverdue ? 'alert' : 'info'}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
        <StatTile
          label="Outstanding Balance"
          value={`₹${(khata?.outstanding || 0).toLocaleString('en-IN')}`}
          trend={isOverdue ? `${khata.days_overdue} days overdue` : 'On track'}
        />
        <StatTile
          label="Linked Notes & Keeps"
          value={(notes?.length || 0) + (keeps?.length || 0)}
          trend="Caller history"
        />
      </div>

      {notes && notes.length > 0 && (
        <div className="mb-6">
          <SectionTitle>Caller Notes</SectionTitle>
          <GlassCard>
            <ul className="space-y-2">
              {notes.map((note, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <span className="text-amber-500 font-bold">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </GlassCard>
        </div>
      )}

      {keeps && keeps.length > 0 && (
        <div className="mb-6">
          <SectionTitle>Related Keeps & Reminders</SectionTitle>
          <div className="space-y-3">
            {keeps.map(k => (
              <GlassCard key={k.id}>
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-sm">{k.content}</span>
                  <Pill>{k.intent_type || 'keep'}</Pill>
                </div>
                {k.reminder_at && (
                  <p className="text-xs text-gray-500">
                    Reminder: {new Date(k.reminder_at).toLocaleString()}
                  </p>
                )}
              </GlassCard>
            ))}
          </div>
        </div>
      )}
    </AuroraPage>
  );
}
