'use client';
/**
 * DailyBriefCard — collapsible daily brief summary on dashboard.
 * Shows: brief preview, expand to full, festival highlight.
 */
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function DailyBriefCard({ userId }) {
  const [brief, setBrief] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [festival, setFestival] = useState(null);

  useEffect(() => {
    if (!userId) return;
    loadBrief();
  }, [userId]);

  async function loadBrief() {
    try {
      // Check today's festival
      const today = new Date().toISOString().split('T')[0];
      const { data: events } = await supabase
        .from('calendar_events')
        .select('title, event_type, tradition')
        .eq('event_date', today)
        .in('event_type', ['festival', 'national_holiday', 'religious'])
        .limit(1);
      if (events?.length) setFestival(events[0]);

      // Get brief summary counts
      const { count: remCount } = await supabase.from('reminders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('is_active', true);
      const { count: keepCount } = await supabase.from('keeps')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('status', 'open');
      setBrief({ reminders: remCount || 0, openKeeps: keepCount || 0 });
    } catch {}
  }

  if (!brief) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
          background: 'var(--surface)', border: '1px solid var(--border)',
          transition: 'all 0.2s',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>📋</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Today's Brief</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-subtle)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
        </div>

        {/* Quick stats always visible */}
        <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>⏰ {brief.reminders} reminders</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>📝 {brief.openKeeps} open keeps</span>
        </div>

        {/* Festival highlight */}
        {festival && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.15)',
            fontSize: 12, color: '#f59e0b', fontWeight: 600,
          }}>
            🎉 {festival.title}
            {festival.tradition && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>({festival.tradition})</span>}
          </div>
        )}

        {/* Expanded content */}
        {expanded && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <a href="/daily-brief" style={{
              display: 'block', padding: '10px 14px', borderRadius: 8,
              background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
              color: 'var(--primary)', fontSize: 13, fontWeight: 600,
              textDecoration: 'none', textAlign: 'center',
            }}>
              Open Full Daily Brief →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
