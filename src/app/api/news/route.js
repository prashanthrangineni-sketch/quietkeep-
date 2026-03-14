'use client';
import { useEffect, useState } from 'react';
import NavbarClient from '@/components/NavbarClient';

const FEEDS = ['India', 'Business', 'Tech', 'Health'];

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (isNaN(diff)) return '';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NewsPage() {
  const [feed, setFeed] = useState('India');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadFeed(feed); }, [feed]);

  async function loadFeed(category) {
    setLoading(true); setError(''); setItems([]);
    try {
      const res = await fetch(`/api/news?category=${encodeURIComponent(category)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setItems(data.items || []);
    } catch (e) {
      setError('Could not load news. Try again.');
    }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0d1117', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '6rem 16px 6rem' }}>

        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>📰 News Feed</h1>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>Top stories — tap to read</p>

        {/* Feed selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {FEEDS.map(f => (
            <button key={f} onClick={() => setFeed(f)} style={{
              padding: '6px 16px', borderRadius: 20, border: `1px solid ${feed === f ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
              background: feed === f ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: feed === f ? '#a5b4fc' : '#64748b', fontSize: 13,
              cursor: 'pointer', fontWeight: feed === f ? 700 : 400,
            }}>{f}</button>
          ))}
        </div>

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3,4,5].map(i => (
              <div key={i} className="qk-shimmer" style={{ height: 72, borderRadius: 12 }} />
            ))}
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#f87171' }}>
            ⚠️ {error}
          </div>
        )}

        {!loading && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item, i) => (
              <a key={i} href={item.link} target="_blank" rel="noopener noreferrer" style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 12, padding: '14px 16px', textDecoration: 'none', display: 'block',
                transition: 'background 0.15s',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.4, marginBottom: 6 }}>
                  {item.title}
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#475569' }}>
                  {item.source && <span style={{ color: '#6366f1' }}>{item.source}</span>}
                  {item.pubDate && <span>· {timeAgo(item.pubDate)}</span>}
                </div>
              </a>
            ))}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#475569', fontSize: 13 }}>
            No stories found for {feed}
          </div>
        )}
      </div>
    </div>
  );
            }
