'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function SharePage({ params }) {
  const [content, setContent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadShared(); }, []);

  async function loadShared() {
    const token = params?.token;
    if (!token) { setError('Invalid link — no token found.'); setLoading(false); return; }

    const { data: tokenRow, error: tokenErr } = await supabase
      .from('share_tokens')
      .select('*')
      .eq('token', token)
      .eq('is_active', true)
      .single();

    if (tokenErr || !tokenRow) { setError('This link is invalid or has been deactivated.'); setLoading(false); return; }
    if (new Date(tokenRow.expires_at) < new Date()) { setError('This share link has expired. Ask the sender to share a new one.'); setLoading(false); return; }

    // Increment view count silently
    supabase.from('share_tokens').update({ view_count: (tokenRow.view_count || 0) + 1 }).eq('id', tokenRow.id).then(() => {});

    if (tokenRow.share_type === 'keep') {
      const { data: keep } = await supabase
        .from('keeps')
        .select('content, category, color, created_at, reminder_at, intent_type')
        .eq('id', tokenRow.resource_id)
        .single();
      if (!keep) { setError('This keep no longer exists.'); setLoading(false); return; }
      setContent({ type: 'keep', keep });
    }

    else if (tokenRow.share_type === 'daily_brief') {
      const uid = tokenRow.user_id;
      const today = new Date().toISOString().split('T')[0];
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

      const [
        { data: keeps },
        { data: reminders },
        { data: subs },
        { data: profile },
      ] = await Promise.all([
        supabase.from('keeps').select('content, category, intent_type').eq('user_id', uid).eq('show_on_brief', true).eq('status', 'pending').order('created_at', { ascending: false }).limit(8),
        supabase.from('keeps').select('content, reminder_at').eq('user_id', uid).eq('status', 'pending').not('reminder_at', 'is', null).gte('reminder_at', today).lte('reminder_at', in7).order('reminder_at').limit(5),
        supabase.from('subscriptions').select('name, amount, currency, next_due').eq('user_id', uid).eq('is_active', true).lte('next_due', in7).gte('next_due', today).order('next_due').limit(3),
        supabase.from('profiles').select('full_name').eq('user_id', uid).single(),
      ]);

      setContent({ type: 'daily_brief', keeps: keeps || [], reminders: reminders || [], subs: subs || [], name: profile?.full_name || '' });
    }

    setLoading(false);
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ color: '#64748b', fontSize: 15 }}>Loading shared content...</div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', padding: 24 }}>
      <div style={{ background: '#1e293b', borderRadius: 14, padding: 32, maxWidth: 400, width: '100%', border: '1px solid #334155', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ color: '#f87171', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Link unavailable</div>
        <div style={{ color: '#64748b', fontSize: 14 }}>{error}</div>
        <a href="https://quietkeep.com" style={{ display: 'inline-block', marginTop: 20, color: '#6366f1', fontSize: 13, textDecoration: 'none' }}>Learn about QuietKeep →</a>
      </div>
    </div>
  );

  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', padding: '32px 16px', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        {/* KEEP VIEW */}
        {content?.type === 'keep' && (
          <div style={{ background: '#1e293b', borderRadius: 14, padding: 24, border: '1px solid #334155' }}>
            <span style={{ display: 'inline-block', background: '#6366f1', color: '#fff', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, marginBottom: 20 }}>Shared Keep</span>
            <div style={{ color: '#f1f5f9', fontSize: 17, lineHeight: 1.65, marginBottom: 16 }}>{content.keep.content}</div>
            {content.keep.reminder_at && (
              <div style={{ color: '#f59e0b', fontSize: 13, marginBottom: 8 }}>
                Reminder: {new Date(content.keep.reminder_at).toLocaleString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            {content.keep.category && <div style={{ color: '#64748b', fontSize: 12 }}>Category: {content.keep.category}</div>}
            <div style={{ color: '#334155', fontSize: 12, marginTop: 24, textAlign: 'center' }}>Shared via QuietKeep · quietkeep.com</div>
          </div>
        )}

        {/* DAILY BRIEF VIEW */}
        {content?.type === 'daily_brief' && (
          <div style={{ background: '#1e293b', borderRadius: 14, padding: 24, border: '1px solid #334155' }}>
            <span style={{ display: 'inline-block', background: '#0ea5e9', color: '#fff', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, marginBottom: 16 }}>Daily Brief</span>
            <div style={{ color: '#f1f5f9', fontSize: 19, fontWeight: 700, marginBottom: 4 }}>{content.name ? `${content.name}'s Brief` : 'Daily Brief'}</div>
            <div style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>{dateStr}</div>

            {content.keeps?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>On Brief</div>
                {content.keeps.map((k, i) => (
                  <div key={i} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px', marginBottom: 8, color: '#cbd5e1', fontSize: 14 }}>{k.content}</div>
                ))}
              </div>
            )}

            {content.reminders?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Reminders This Week</div>
                {content.reminders.map((r, i) => (
                  <div key={i} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
                    <div style={{ color: '#cbd5e1', fontSize: 14 }}>{r.content}</div>
                    <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 4 }}>
                      {new Date(r.reminder_at).toLocaleString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {content.subs?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Renewals This Week</div>
                {content.subs.map((s, i) => (
                  <div key={i} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px', marginBottom: 8, color: '#cbd5e1', fontSize: 14 }}>
                    {s.name} — {s.currency} {s.amount} · due {s.next_due}
                  </div>
                ))}
              </div>
            )}

            <div style={{ color: '#334155', fontSize: 12, marginTop: 8, textAlign: 'center' }}>Shared via QuietKeep · quietkeep.com</div>
          </div>
        )}
      </div>
    </div>
  );
            }
