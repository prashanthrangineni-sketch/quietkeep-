const createNextIntlPlugin = require('next-intl/plugin');
const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

// ARCHITECTURE DECISION:
// This project has TWO different build targets that need different configs:
//
//   1. VERCEL (web deployment): Must NOT use output:'export'.
//      Reason: The app has 56 API routes (/api/*) that must run as
//      serverless functions on Vercel. output:'export' would kill all of them.
//      The web app at quietkeep.com needs these routes for all features.
//
//   2. APK BUILD (Capacitor): MUST use output:'export'.
//      Reason: Capacitor needs a static bundle in out/ to embed in the APK.
//      The APK calls the 56 API routes over HTTPS to quietkeep.com — they
//      are NOT embedded in the APK, only the UI pages are.
//
// The CI workflow (android-build.yml) sets CAPACITOR_BUILD=1 before
// running npm run build. This switches next.config.js into static export mode.
// Vercel does NOT set CAPACITOR_BUILD, so it stays in server mode.
//
// This is the correct production pattern. Same code, different build output.

const isCapacitorBuild = process.env.CAPACITOR_BUILD === '1';

const nextConfig = {
  // Conditionally add output: 'export' ONLY for Capacitor/APK builds.
  // Vercel builds have no CAPACITOR_BUILD env var so this is undefined (normal SSR mode).
  ...(isCapacitorBuild ? {
    output: 'export',
    trailingSlash: true,
    images: { unoptimized: true },
  } : {}),

  reactStrictMode: true,

  env: {
    NEXT_PUBLIC_APP_TYPE: process.env.NEXT_PUBLIC_APP_TYPE || 'personal',
    // Propagate CAPACITOR_BUILD into build workers so layout.jsx guards work during prerendering.
    CAPACITOR_BUILD: process.env.CAPACITOR_BUILD || '',
  },
};

// CAPACITOR_BUILD guard: withNextIntl registers i18n.ts which calls
// cookies() at build time — crashes during output:'export' static generation.
// APK language is handled client-side by LanguageProvider (localStorage).
// Vercel builds use withNextIntl normally — zero change to web behaviour.
// withNextIntl must ALWAYS be applied — NavbarClient.jsx uses useTranslations,
// getMessages() is called in layout.jsx, and both require i18n.ts to be registered.
// The i18n.ts has try/catch around cookies() which handles static export gracefully.
module.exports = withNextIntl(nextConfig);
