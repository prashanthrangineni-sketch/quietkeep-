'use client';
/**
 * DashboardHero — top zone of the dashboard.
 * Shows: greeting, today's top reminder, voice capture area.
 * Extracted from dashboard/page.jsx to reduce main file complexity.
 */
import { useState, useEffect } from 'react';

function getGreeting(name) {
  const h = new Date().getHours();
  const n = name ? `, ${name.split(' ')[0]}` : '';
  if (h >= 5 && h < 12) return `Good morning${n}`;
  if (h >= 12 && h < 17) return `Good afternoon${n}`;
  if (h >= 17 && h < 21) return `Good evening${n}`;
  return `Good night${n}`;
}

export default function DashboardHero({ userName, topReminder, onReminderTap }) {
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    setGreeting(getGreeting(userName));
    const interval = setInterval(() => setGreeting(getGreeting(userName)), 60000);
    return () => clearInterval(interval);
  }, [userName]);

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Greeting */}
      <h1 style={{
        fontSize: 22, fontWeight: 800, color: 'var(--text)',
        letterSpacing: '-0.02em', marginBottom: 4,
      }}>
        {greeting}
      </h1>
      <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 14 }}>
        {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>

      {/* Top reminder card */}
      {topReminder && (
        <div
          onClick={onReminderTap}
          style={{
            padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.2)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
          <span style={{ fontSize: 20 }}>⏰</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {topReminder.reminder_text || topReminder.content || 'Reminder'}
            </div>
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
              {topReminder.scheduled_for && !isNaN(new Date(topReminder.scheduled_for).getTime())
                ? new Date(topReminder.scheduled_for).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
                : topReminder.reminder_at && !isNaN(new Date(topReminder.reminder_at).getTime())
                  ? new Date(topReminder.reminder_at).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
                  : 'No time set'}
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>→</span>
        </div>
      )}
    </div>
  );
}
