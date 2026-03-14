'use client';
import { useEffect, useState } from 'react';
import NavbarClient from '@/components/NavbarClient';

const FEEDS = [
  { label: 'India', url: 'https://news.google.com/rss/headlines/section/geo/IN?hl=en-IN&gl=IN&ceid=IN:en' },
  { label: 'Business', url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en' },
  { label: 'Tech', url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-IN&gl=IN&ceid=IN:en' },
  { label: 'Health', url: 'https://news.google.com/rss/headlines/section/topic/HEALTH?hl=en-IN&gl=IN&ceid=IN:en' },
];

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

export default function NewsPage() {
  const [feed, setFeed] = useState('India');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadFeed(); }, [feed]);

  async function loadFeed() {
    setLoading(true); setError(''); setItems([]);
    const src = FEEDS.find(f => f.label === feed)?.url;
    if (!src) return;
    try {
      const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(src)}`;
      const res = await fetch(proxy);
      const json = await res.json();
      const parser = new DOMParser();
      const doc = parser.parseFromString(json.contents, 'text/xml');
      const parsed = Array.from(doc.querySelectorAll('item')).slice(0, 20).map(item => ({
        title: item.querySelector('title')?.textContent || '',
        link: item.querySelector('link')?.textContent || '',
        pubDate: item.querySelector('pubDate')?.textContent || '',
        source: item.querySelector('source')?.textContent || '',
      }));
      setItems(parsed);
    } catch { setError('Could not load news. Check your connection.'); }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0d1117', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '6rem 16px 6rem' }}>

        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>📰 News Feed</h1>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>Stay informed — optional reading</p>

        {/* Feed selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {FEEDS.map(f => (
            <button key={f.label} onClick={() => setFeed(f.label)}
              style={{ padding: '6px 14px', borderRadius: 20, border: `1px solid ${feed === f.label ? '#6366f1' : 'rgba(255,255,255,0.08)'}`, background: feed === f.label ? 'rgba(99,102,241,0.15)' : 'transparent', color: feed === f.label ? '#a5b4fc' : '#64748b', fontSize: 13, cursor: 'pointer', fontWeight: feed === f.label ? 700 : 400 }}>
              {f.label}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontSize: 13 }}>Loading news…</div>
        )}
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#f87171' }}>{error}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item, i) => (
            <a key={i} href={item.link} target="_blank" rel="noopener noreferrer"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '14px', textDecoration: 'none', display: 'block' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.4, marginBottom: 6 }}>{item.title}</div>
              <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#475569' }}>
                {item.source && <span>{item.source}</span>}
                {item.pubDate && <span>· {timeAgo(item.pubDate)}</span>}
              </div>
            </a>
          ))}
        </div>

        {!loading && items.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#475569', fontSize: 13 }}>No news loaded yet</div>
        )}
      </div>
    </div>
  );
}
