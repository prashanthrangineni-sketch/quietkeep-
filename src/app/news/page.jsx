'use client';
import { useEffect, useState } from 'react';
import NavbarClient from '@/components/NavbarClient';

const CATEGORIES = ['India', 'Business', 'Tech', 'Health'];

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (isNaN(diff) || diff < 0) return '';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NewsPage() {
  const [cat, setCat] = useState('India');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => { load(cat); }, [cat]);

  async function load(category) {
    setLoading(true); setMsg(''); setItems([]);
    try {
      const res = await fetch(`/api/news?category=${encodeURIComponent(category)}`);
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        setItems(data.items);
      } else {
        setMsg(data.message || 'No stories found. Try another category.');
      }
    } catch {
      setMsg('Could not load news. Check your connection.');
    }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0d1117', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '6rem 16px 6rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>📰 News</h1>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>Top stories — tap to read</p>

        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCat(c)} style={{
              padding: '6px 16px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${cat === c ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
              background: cat === c ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: cat === c ? '#a5b4fc' : '#64748b', fontWeight: cat === c ? 700 : 400,
            }}>{c}</button>
          ))}
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading…</div>}

        {!loading && msg && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#f87171' }}>
            {msg}
          </div>
        )}

        {!loading && items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item, i) => (
              <a key={i} href={item.link || '#'} target="_blank" rel="noopener noreferrer"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '14px 16px', textDecoration: 'none', display: 'block' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.45, marginBottom: 6 }}>{item.title}</div>
                <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#475569' }}>
                  {item.source && <span style={{ color: '#6366f1' }}>{item.source}</span>}
                  {item.pubDate && <span>· {timeAgo(item.pubDate)}</span>}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
