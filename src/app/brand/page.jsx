// src/app/brand/page.jsx — Brand Kit (server component, no auth)
import Link from 'next/link';

export const metadata = {
  title: 'Brand Kit — QuietKeep',
  description: 'QuietKeep brand assets — logos, colors, typeface, and usage guidelines for press, partners, and developers.',
};

const COLORS = [
  { name: 'Primary Indigo',  light: '#5b5ef4', dark: '#6366f1', cssVar: '--primary',    use: 'CTAs, links, active states' },
  { name: 'Deep Violet',     light: '#8b5cf6', dark: '#818cf8', cssVar: null,           use: 'Gradient pair with Primary' },
  { name: 'Accent Green',    light: '#059669', dark: '#10b981', cssVar: '--accent',     use: 'Success, WhatsApp actions' },
  { name: 'Amber',           light: '#d97706', dark: '#f59e0b', cssVar: '--amber',      use: 'Warnings, reminders, premium' },
  { name: 'Alert Red',       light: '#dc2626', dark: '#ef4444', cssVar: '--red',        use: 'Errors, SOS, emergency' },
  { name: 'Surface Light',   light: '#ffffff', dark: 'rgba(255,255,255,0.05)', cssVar: '--surface', use: 'Cards, modals' },
  { name: 'Background',      light: '#f4f6fb', dark: '#0d1117', cssVar: '--bg',         use: 'Page background' },
  { name: 'Text Primary',    light: '#1e293b', dark: '#e2e8f0', cssVar: '--text',       use: 'Body, headings' },
  { name: 'Text Muted',      light: '#64748b', dark: '#8892a4', cssVar: '--text-muted', use: 'Secondary labels' },
];

const ICON_SIZES = [
  { size: '16×16',   file: 'favicon.ico',           use: 'Browser tab' },
  { size: '192×192', file: 'icon-192.png',           use: 'PWA home screen, Android' },
  { size: '512×512', file: 'icon-512.png',           use: 'PWA splash, high-DPI' },
  { size: '180×180', file: 'apple-touch-icon.png',   use: 'iOS home screen' },
  { size: 'SVG',     file: 'qk-logo.svg',            use: 'Web, print, all sizes' },
];

export default function BrandPage() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Inter',-apple-system,sans-serif" }}>

      {/* Sticky nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--nav-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--nav-border)', padding: '0 24px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" style={{ fontWeight: 800, fontSize: 18, color: 'var(--primary)', textDecoration: 'none' }}>QuietKeep</Link>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <Link href="/pricing" style={{ fontSize: 14, color: 'var(--text-muted)', textDecoration: 'none' }}>Pricing</Link>
          <Link href="/login" style={{ fontSize: 14, fontWeight: 700, color: '#fff', background: 'var(--primary)', padding: '8px 18px', borderRadius: 8, textDecoration: 'none' }}>Sign In</Link>
        </div>
      </nav>

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '56px 24px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 52 }}>
          <div style={{ display: 'inline-block', background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 999, padding: '4px 14px', fontSize: 11, color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>Brand Kit</div>
          <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-1.5px', margin: '0 0 12px', color: 'var(--text)' }}>QuietKeep Brand</h1>
          <p style={{ fontSize: 16, color: 'var(--text-muted)', maxWidth: 500, lineHeight: 1.7 }}>
            Assets and guidelines for press, partners, and developers. Please follow the usage rules to represent QuietKeep correctly.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 8 }}>
            Questions? <a href="mailto:hello@quietkeep.com" style={{ color: 'var(--primary)' }}>hello@quietkeep.com</a>
          </p>
        </div>

        {/* Logo */}
        <section style={{ marginBottom: 52 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: 'var(--text)' }}>Logo Variants</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Full — Light bg', bg: '#f4f6fb', iconBg: 'linear-gradient(135deg,#5b5ef4,#8b5cf6)', text: '#1e293b', showText: true },
              { label: 'Full — Dark bg',  bg: '#0d1117', iconBg: 'linear-gradient(135deg,#6366f1,#818cf8)', text: '#e2e8f0', showText: true },
              { label: 'Icon only',       bg: '#f4f6fb', iconBg: 'linear-gradient(135deg,#5b5ef4,#8b5cf6)', text: '#1e293b', showText: false },
              { label: 'Mono on brand',   bg: '#5b5ef4', iconBg: 'rgba(255,255,255,0.2)',                   text: '#fff',     showText: true },
            ].map(v => (
              <div key={v.label} style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ background: v.bg, padding: '30px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 90 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: v.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>QK</span>
                    </div>
                    {v.showText && <span style={{ fontWeight: 800, fontSize: 15, color: v.text, letterSpacing: '-0.3px' }}>QuietKeep</span>}
                  </div>
                </div>
                <div style={{ padding: '10px 14px', background: 'var(--surface)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{v.label}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: 'var(--primary-dim)', border: '1px solid var(--primary-glow)', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--primary)' }}>Download files:</strong>{' '}
            <a href="/qk-logo.svg" download style={{ color: 'var(--primary)', marginRight: 16 }}>qk-logo.svg</a>
            <a href="/icon-192.png" download style={{ color: 'var(--primary)', marginRight: 16 }}>icon-192.png</a>
            <a href="/icon-512.png" download style={{ color: 'var(--primary)' }}>icon-512.png</a>
          </div>
        </section>

        {/* PWA icons */}
        <section style={{ marginBottom: 52 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: 'var(--text)' }}>PWA &amp; Platform Icons</h2>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            {ICON_SIZES.map((ic, i) => (
              <div key={ic.size} style={{ display: 'flex', alignItems: 'center', padding: '13px 18px', borderBottom: i < ICON_SIZES.length - 1 ? '1px solid var(--border)' : 'none', gap: 16 }}>
                <code style={{ fontSize: 12, color: 'var(--primary)', background: 'var(--primary-dim)', padding: '3px 9px', borderRadius: 5, flexShrink: 0, minWidth: 72 }}>{ic.size}</code>
                <code style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>{ic.file}</code>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{ic.use}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 10 }}>
            Apple splash screen: link rel="apple-touch-startup-image" in layout.jsx. Manifest.json references 192 and 512 PNG.
          </p>
        </section>

        {/* Colors */}
        <section style={{ marginBottom: 52 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: 'var(--text)' }}>Color Palette</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
            {COLORS.map(c => (
              <div key={c.name} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 7, background: c.light, border: '1px solid var(--border)', flexShrink: 0 }} title="Light theme" />
                  <div style={{ width: 30, height: 30, borderRadius: 7, background: typeof c.dark === 'string' && c.dark.startsWith('rgba') ? c.dark : c.dark, border: '1px solid var(--border)', flexShrink: 0 }} title="Dark theme" />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{c.name}</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-subtle)', marginBottom: 3 }}>{c.light} · {c.dark}</div>
                {c.cssVar && <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--primary)', marginBottom: 3 }}>{c.cssVar}</div>}
                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.use}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Typography */}
        <section style={{ marginBottom: 52 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: 'var(--text)' }}>Typography</h2>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 28 }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Primary typeface</div>
              <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', color: 'var(--text)' }}>Inter</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Google Fonts · Variable weight 300–800 · <a href="https://fonts.google.com/specimen/Inter" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>fonts.google.com/specimen/Inter</a></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[
                { label: 'Display / H1', css: 'font-size:52px; font-weight:800; letter-spacing:-1.5px', sample: 'Keep Everything.' },
                { label: 'Heading / H2', css: 'font-size:22px; font-weight:800', sample: 'Daily Brief' },
                { label: 'Body',         css: 'font-size:15px; font-weight:400', sample: 'Organised, quietly.' },
                { label: 'Caption',      css: 'font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase', sample: 'SECTION LABEL' },
              ].map(t => (
                <div key={t.label} style={{ paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{t.label}</div>
                  <div style={Object.fromEntries(t.css.split(';').filter(Boolean).map(s => { const [k,v] = s.trim().split(':'); return [k.trim().replace(/-([a-z])/g, (_,c) => c.toUpperCase()), v.trim()]; }))}>{t.sample}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Usage rules */}
        <section style={{ marginBottom: 52 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: 'var(--text)' }}>Usage Guidelines</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[
              { title: '✅ Do', items: ['Use on backgrounds with sufficient contrast','Maintain aspect ratio — never stretch','Leave clear space equal to icon height on all sides','Use SVG for digital, PNG 512 for print','Reference as "QuietKeep" (one word, camelcase)'] },
              { title: '❌ Do not', items: ['Alter the gradient colors in the icon','Add drop shadows or extra effects','Place wordmark below 120 px width','Combine with competing logo marks','Use logo to imply endorsement without permission'] },
            ].map(u => (
              <div key={u.title} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>{u.title}</div>
                {u.items.map((item, i) => (
                  <div key={i} style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', gap: 8 }}>
                    <span style={{ flexShrink: 0 }}>·</span>{item}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* OG image preview */}
        <section style={{ marginBottom: 52 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>OG / Share Image</h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
            Dynamic OG images are generated at <code style={{ background: 'var(--primary-dim)', color: 'var(--primary)', padding: '2px 7px', borderRadius: 5 }}>/api/og</code> with optional <code style={{ background: 'var(--primary-dim)', color: 'var(--primary)', padding: '2px 7px', borderRadius: 5 }}>?title=</code>, <code style={{ background: 'var(--primary-dim)', color: 'var(--primary)', padding: '2px 7px', borderRadius: 5 }}>?sub=</code>, and <code style={{ background: 'var(--primary-dim)', color: 'var(--primary)', padding: '2px 7px', borderRadius: 5 }}>?emoji=</code> params.
          </p>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', maxWidth: 480 }}>
            <img src="/api/og" alt="QuietKeep OG image preview" style={{ width: '100%', display: 'block' }} loading="lazy" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 8 }}>
            <a href="/api/og?title=Daily Brief&sub=Your personalised morning summary&emoji=☀️" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>Preview with custom params →</a>
          </div>
        </section>

        {/* Contact */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📬</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Press &amp; Media</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>Interview requests, editorial features, or partnership assets</div>
          <a href="mailto:hello@quietkeep.com" style={{ display: 'inline-block', background: 'var(--primary)', color: '#fff', padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            hello@quietkeep.com
          </a>
        </div>
      </div>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '24px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
        © {new Date().getFullYear()} QuietKeep · Pranix AI Labs Private Limited
      </footer>
    </main>
  );
          }
