'use client';
// src/components/QkIcon.jsx
//
// QuietKeep's icon set — one consistent family, drawn as stroked vectors.
//
// WHY
// Navigation used system emoji (🏠 ⏰ 📅 💰 📄 ❤️ 👨‍👩‍👧 🧠 🧘 🛡️). Three problems:
//   1. They are Apple/Google/Microsoft artwork, not QuietKeep's.
//   2. They render differently on every device — and some, like 👨‍👩‍👧, break
//      into separate glyphs on older Android.
//   3. Next to the homepage's crafted illustration they read as placeholders.
//
// DESIGN RULES (keep these if you add icons)
//   - 24x24 viewBox, 1.75 stroke, round caps and joins
//   - stroke="currentColor" and fill="none" — the icon inherits the text
//     colour, so active/inactive/hover states need no extra code
//   - geometry only; no gradients, no text glyphs
//
// USAGE
//   <QkIcon name="home" />            // 22px, inherits colour
//   <QkIcon name="calendar" size={18} />
//
// An unknown name renders the neutral dot rather than throwing, so a typo
// degrades to a placeholder instead of a blank screen.

const PATHS = {
  // ── Personal ──────────────────────────────────────────────────────────
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" /><path d="M9.5 21v-6h5v6" /></>,
  reminders: <><circle cx="12" cy="13" r="8" /><path d="M12 9.5V13l2.5 1.5" /><path d="M5 3.5 2.5 6" /><path d="M19 3.5 21.5 6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" /></>,
  brief: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5" /><path d="M12 19.5V22" /><path d="M2 12h2.5" /><path d="M19.5 12H22" /><path d="m4.9 4.9 1.8 1.8" /><path d="m17.3 17.3 1.8 1.8" /><path d="m19.1 4.9-1.8 1.8" /><path d="m6.7 17.3-1.8 1.8" /></>,
  finance: <><path d="M6 5h9a4 4 0 0 1 0 8H6" /><path d="M6 9h11" /><path d="M6 13h4l7 7" /></>,
  documents: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></>,
  health: <><path d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.6c0 5-7 9.4-7 9.4z" /></>,
  family: <><circle cx="8" cy="9" r="2.8" /><circle cx="16.5" cy="10" r="2.2" /><path d="M3 19c0-2.8 2.2-4.6 5-4.6s5 1.8 5 4.6" /><path d="M14.5 19c0-2.2 1.4-3.6 3.5-3.6S21 16.8 21 19" /></>,
  memories: <><path d="M12 4.5a3.5 3.5 0 0 0-3.5 3.5 3 3 0 0 0-1 5.8A3.2 3.2 0 0 0 12 19.5a3.2 3.2 0 0 0 4.5-5.7 3 3 0 0 0-1-5.8A3.5 3.5 0 0 0 12 4.5z" /><path d="M12 4.5v15" /></>,
  mood: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><path d="M9 9.5h.01" /><path d="M15 9.5h.01" /></>,
  warranty: <><path d="M12 3 5 6v6c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6z" /><path d="m9.5 12 1.8 1.8 3.4-3.6" /></>,
  more: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
  voice: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" /><path d="M12 18v3" /></>,

  // ── Business ──────────────────────────────────────────────────────────
  dashboard: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M3 20h18" /></>,
  ledger: <><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 18.5z" /><path d="M5 17h14" /><path d="M9 7.5h6" /><path d="M9 11h6" /></>,
  attendance: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="m16 12.5 1.8 1.8 3.7-3.8" /></>,
  invoice: <><path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.4z" /><path d="M9 8h6" /><path d="M9 12h6" /></>,
  inventory: <><path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2z" /><path d="m4 7.2 8 4.2 8-4.2" /><path d="M12 11.4V21" /></>,
  team: <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c0-3.4 2.9-5.6 6.5-5.6s6.5 2.2 6.5 5.6" /></>,
  payroll: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M2.5 10h19" /><path d="M6 14.5h3.5" /></>,
  compliance: <><path d="M12 4v16" /><path d="M7 20h10" /><path d="M4 8h16" /><path d="m4 8-2 4.5a3.2 3.2 0 0 0 4 0z" /><path d="m20 8 2 4.5a3.2 3.2 0 0 1-4 0z" /></>,
  reports: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 17v-3" /><path d="M12 17v-5" /><path d="M15 17v-2" /></>,
  customers: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M16.5 8.5h4.5" /><path d="M18.75 6.25v4.5" /></>,
  collections: <><circle cx="12" cy="12" r="9" /><path d="M9 8.5h6" /><path d="M9 11.5h6" /><path d="M9.5 8.5c2.5 0 3.5 1.2 3.5 2.6S12 14 9.5 14l4 3.5" /></>,
  tasks: <><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="m8.5 12.2 2.3 2.3 4.7-5" /></>,
  geo: <><path d="M12 21s6.5-5.6 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.4 12 21 12 21z" /><circle cx="12" cy="10.6" r="2.4" /></>,
  scan: <><path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" /><path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" /><path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" /><path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" /><path d="M3 12h18" /></>,
  chat: <><path d="M20 12a7.5 7.5 0 0 1-10.9 6.7L4 20l1.4-4.2A7.5 7.5 0 1 1 20 12z" /></>,
  invite: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></>,

  dot: <circle cx="12" cy="12" r="3" />,
};

export default function QkIcon({ name, size = 22, strokeWidth = 1.75, style, className }) {
  const d = PATHS[name] || PATHS.dot;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {d}
    </svg>
  );
}
