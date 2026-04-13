// src/app/api/og/route.js
// OG Image generator — returns a 1200×630 SVG rendered as PNG-compatible image
// Used by layout.jsx metadata and share cards
// No canvas/puppeteer needed — pure SVG served as image/svg+xml
// Social crawlers accept SVG OG images. For PNG, Next.js ImageResponse would need @vercel/og

export const runtime = 'edge';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get('title') || 'QuietKeep — Your Personal Life OS';
  const sub = searchParams.get('sub') || 'Voice-first keeps, reminders, finance & family. All private.';
  const emoji = searchParams.get('emoji') || '🔒';

  // Escape for SVG
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Word-wrap title for SVG (max ~40 chars per line)
  function wrapText(text, maxLen = 38) {
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length <= maxLen) {
        cur = (cur + ' ' + w).trim();
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 2); // max 2 lines
  }

  const titleLines = wrapText(esc(title), 36);
  const subText = esc(sub).slice(0, 90);
  const titleY1 = titleLines.length === 1 ? 280 : 250;
  const titleY2 = 305;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0d1117"/>
      <stop offset="100%" style="stop-color:#0f0f2e"/>
    </linearGradient>
    <linearGradient id="brand" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#8b5cf6"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="20" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Glow orb -->
  <circle cx="600" cy="200" r="280" fill="rgba(99,102,241,0.08)" filter="url(#glow)"/>

  <!-- Top bar accent -->
  <rect x="0" y="0" width="1200" height="4" fill="url(#brand)"/>

  <!-- Logo mark -->
  <rect x="80" y="60" width="52" height="52" rx="14" fill="url(#brand)"/>
  <text x="106" y="95" font-family="system-ui,sans-serif" font-size="26" font-weight="800" fill="white" text-anchor="middle">QK</text>

  <!-- Brand name -->
  <text x="148" y="93" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="white">QuietKeep</text>
  <text x="148" y="112" font-family="system-ui,sans-serif" font-size="13" fill="#64748b">by Pranix AI Labs</text>

  <!-- Emoji -->
  <text x="600" y="210" font-family="system-ui,sans-serif" font-size="72" text-anchor="middle">${esc(emoji)}</text>

  <!-- Title lines -->
  <text x="600" y="${titleY1}" font-family="system-ui,-apple-system,sans-serif" font-size="52" font-weight="800" fill="white" text-anchor="middle" letter-spacing="-1">${titleLines[0] || ''}</text>
  ${titleLines[1] ? `<text x="600" y="${titleY2}" font-family="system-ui,-apple-system,sans-serif" font-size="52" font-weight="800" fill="white" text-anchor="middle" letter-spacing="-1">${titleLines[1]}</text>` : ''}

  <!-- Subtitle -->
  <text x="600" y="360" font-family="system-ui,sans-serif" font-size="22" fill="#64748b" text-anchor="middle">${subText}</text>

  <!-- Feature pills -->
  <rect x="200" y="420" width="160" height="36" rx="18" fill="rgba(99,102,241,0.15)" stroke="rgba(99,102,241,0.4)" stroke-width="1"/>
  <text x="280" y="443" font-family="system-ui,sans-serif" font-size="14" fill="#a5b4fc" text-anchor="middle">🎙️ Voice-First</text>

  <rect x="380" y="420" width="160" height="36" rx="18" fill="rgba(99,102,241,0.15)" stroke="rgba(99,102,241,0.4)" stroke-width="1"/>
  <text x="460" y="443" font-family="system-ui,sans-serif" font-size="14" fill="#a5b4fc" text-anchor="middle">🔒 Private</text>

  <rect x="560" y="420" width="160" height="36" rx="18" fill="rgba(99,102,241,0.15)" stroke="rgba(99,102,241,0.4)" stroke-width="1"/>
  <text x="640" y="443" font-family="system-ui,sans-serif" font-size="14" fill="#a5b4fc" text-anchor="middle">📱 PWA</text>

  <rect x="740" y="420" width="160" height="36" rx="18" fill="rgba(99,102,241,0.15)" stroke="rgba(99,102,241,0.4)" stroke-width="1"/>
  <text x="820" y="443" font-family="system-ui,sans-serif" font-size="14" fill="#a5b4fc" text-anchor="middle">🇮🇳 Made in India</text>

  <!-- URL -->
  <text x="600" y="575" font-family="system-ui,sans-serif" font-size="18" fill="#334155" text-anchor="middle">quietkeep.com</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    },
  });
}
