'use client';
// ContextCards — drop this component into dashboard/page.jsx
// Usage: import ContextCards from '@/components/ContextCards'
// Then place <ContextCards userId={user?.id} /> above the stats section in BLOCK2

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function ContextCards({ userId }) {
  const [cards, setCards] = useState([]);

  useEffect(() => {
    if (!userId) return;
    loadCards(userId);
  }, [userId]);

  async function loadCards(uid) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const in24 = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const newCards = [];

    // 1. Reminders due in next 24h
    const { data: dueReminders } = await supabase
      .from('reminders')
      .select('id, reminder_text, scheduled_for')
      .eq('user_id', uid).eq('is_active', true)
      .gte('scheduled_for', now.toISOString())
      .lte('scheduled_for', in24)
      .order('scheduled_for', { ascending: true })
      .limit(3);

    if (dueReminders?.length > 0) {
      newCards.push({
        key: 'reminders',
        icon: '⏰',
        color: '#fbbf24',
        bg: 'rgba(251,191,36,0.06)',
        border: 'rgba(251,191,36,0.2)',
        title: `${dueReminders.length} reminder${dueReminders.length > 1 ? 's' : ''} due today`,
        lines: dueReminders.map(r => ({
          text: r.reminder_text,
          sub: new Date(r.scheduled_for).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        })),
        href: '/reminders',
      });
    }

    // 2. Upcoming trips in 7 days
    const { data: trips } = await supabase
      .from('trip_plans')
      .select('id, destination, travel_date, status')
      .eq('user_id', uid)
      .in('status', ['planning', 'confirmed'])
      .gte('travel_date', todayStr)
      .lte('travel_date', in7days)
      .order('travel_date', { ascending: true })
      .limit(2);

    if (trips?.length > 0) {
      const daysUntil = d => {
        const diff = Math.round((new Date(d) - new Date(todayStr)) / (1000 * 60 * 60 * 24));
        return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `In ${diff} days`;
      };
      newCards.push({
        key: 'trips',
        icon: '✈️',
        color: '#60a5fa',
        bg: 'rgba(96,165,250,0.06)',
        border: 'rgba(96,165,250,0.2)',
        title: 'Upcoming trip',
        lines: trips.map(t => ({ text: t.destination, sub: daysUntil(t.travel_date) })),
        href: '/trips',
      });
    }

    // 3. Documents expiring in 30 days
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: docs } = await supabase
      .from('documents')
      .select('id, doc_name, expiry_date')
      .eq('user_id', uid)
      .not('expiry_date', 'is', null)
      .gte('expiry_date', todayStr)
      .lte('expiry_date', in30)
      .order('expiry_date', { ascending: true })
      .limit(2);

    if (docs?.length > 0) {
      const daysLeft = d => {
        const diff = Math.round((new Date(d) - new Date(todayStr)) / (1000 * 60 * 60 * 24));
        return diff <= 7 ? `⚠️ ${diff}d left` : `${diff}d left`;
      };
      newCards.push({
        key: 'docs',
        icon: '📄',
        color: '#f87171',
        bg: 'rgba(248,113,113,0.06)',
        border: 'rgba(248,113,113,0.2)',
        title: `${docs.length} document${docs.length > 1 ? 's' : ''} expiring soon`,
        lines: docs.map(d => ({ text: d.doc_name, sub: daysLeft(d.expiry_date) })),
        href: '/documents',
      });
    }

    // 4. Mood nudge — if no mood logged today
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const { data: moodToday } = await supabase
      .from('mood_logs')
      .select('id')
      .eq('user_id', uid)
      .gte('logged_at', todayStart.toISOString())
      .limit(1)
      .maybeSingle();

    if (!moodToday) {
      newCards.push({
        key: 'mood',
        icon: '🌊',
        color: '#a78bfa',
        bg: 'rgba(167,139,250,0.06)',
        border: 'rgba(167,139,250,0.2)',
        title: 'How are you feeling today?',
        lines: [{ text: 'Log your mood', sub: 'Takes 5 seconds' }],
        href: '/mood',
        cta: 'Log mood →',
      });
    }

    // 5. Subscriptions renewing in 3 days
    const { data: renewals } = await supabase.rpc('get_upcoming_renewals', {
      p_user_id: uid,
      p_days: 3,
    });

    if (renewals?.length > 0) {
      newCards.push({
        key: 'subscriptions',
        icon: '🔄',
        color: '#34d399',
        bg: 'rgba(52,211,153,0.06)',
        border: 'rgba(52,211,153,0.2)',
        title: `${renewals.length} subscription${renewals.length > 1 ? 's' : ''} renewing soon`,
        lines: renewals.map(r => ({
          text: r.service_name,
          sub: `\u20b9${Number(r.amount).toLocaleString('en-IN')} · ${r.days_until === 0 ? 'today' : `in ${r.days_until}d`}`,
        })),
        href: '/finance',
      });
    }

    setCards(newCards);
  }

  if (cards.length === 0) return null;

  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
        At a glance
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {cards.map(card => (
          <Link key={card.key} href={card.href} style={{ textDecoration: 'none', display: 'block', background: card.bg, border: `1px solid ${card.border}`, borderRadius: '12px', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: card.lines.length > 0 ? '6px' : '0' }}>
              <span style={{ fontSize: '16px' }}>{card.icon}</span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: card.color }}>{card.title}</span>
              {card.cta && (
                <span style={{ marginLeft: 'auto', fontSize: '11px', color: card.color, fontWeight: 600 }}>{card.cta}</span>
              )}
            </div>
            {card.lines.map((line, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0 2px 24px' }}>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>{line.text}</span>
                <span style={{ fontSize: '11px', color: card.color, flexShrink: 0 }}>{line.sub}</span>
              </div>
            ))}
          </Link>
        ))}
      </div>
    </div>
  );
}
