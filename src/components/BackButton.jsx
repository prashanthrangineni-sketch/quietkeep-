'use client';
// src/components/BackButton.jsx
// The back arrow that belongs INSIDE a screen's header, in the layout flow,
// next to the title — not floating on top of it. Screens place it; it never
// places itself.

import { usePathname, useRouter } from 'next/navigation';
import { appBack, isRootPath } from '@/lib/app-back';

export default function BackButton({ size = 36, tone = 'light', style = {} }) {
  const pathname = usePathname();
  const router = useRouter();

  if (!pathname || isRootPath(pathname)) return null;

  const dark = tone === 'dark';

  return (
    <button
      type="button"
      aria-label="Go back"
      onClick={() => appBack({ router, pathname })}
      style={{
        flex: 'none',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        border: 'none',
        background: 'transparent',
        color: dark ? '#fff' : 'var(--text, #111827)',
        cursor: 'pointer',
        padding: 0,
        marginLeft: -6,
        ...style,
      }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M15 5l-7 7 7 7"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
