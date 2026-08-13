'use client';
// src/components/AariaMark.jsx
//
// Aaria's face — the same rounded violet orb the marketing homepage leads with.
//
// WHY THIS EXISTS
// quietkeep.com opens with the Aaria orb beside the wordmark. Every screen
// inside the app showed only gradient text, so the product a user pays for
// looked plainer than the page that sold it to them. One shared mark keeps
// the two in step.
//
// Drawn as real vector shapes, never as a text glyph. An earlier version used
// the character (◕‿◕), which rendered as tofu boxes on build machines without
// that font — the launcher icons shipped broken because of it.
//
// <AariaMark />                 violet, 28px — Personal
// <AariaMark variant="business" /> green — Business
// <AariaMark size={44} />       any size; everything scales from it

const THEMES = {
  personal: { from: '#6366f1', to: '#8b5cf6' },
  business: { from: '#10b981', to: '#059669' },
};

export default function AariaMark({ size = 28, variant = 'personal', style, title = 'Aaria' }) {
  const theme = THEMES[variant] || THEMES.personal;
  const id = `aaria-${variant}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={title}
      style={{ display: 'block', flexShrink: 0, borderRadius: size * 0.29, ...style }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={theme.from} />
          <stop offset="100%" stopColor={theme.to} />
        </linearGradient>
      </defs>

      {/* Orb */}
      <rect x="0" y="0" width="48" height="48" rx="14" fill={`url(#${id})`} />

      {/* Eyes — ovals, slightly wide, like the homepage orb */}
      <ellipse cx="17.5" cy="20" rx="3.6" ry="4.4" fill="#ffffff" />
      <ellipse cx="30.5" cy="20" rx="3.6" ry="4.4" fill="#ffffff" />

      {/* Smile — an open curve, not a filled shape */}
      <path
        d="M15.5 29.5 Q24 37.5 32.5 29.5"
        stroke="#ffffff"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
