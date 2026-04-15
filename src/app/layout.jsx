import localFont from 'next/font/local';
import BiometricGate from '@/components/BiometricGate'; // Step 9: biometric lock gate
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { cookies } from 'next/headers';
import { LanguageProvider } from '@/lib/context/language';
import { AuthProvider } from '@/lib/context/auth';
import './globals.css';

// Use local font for both APK and Vercel builds.
// Local font: zero network call during static export (APK build).
// The APK WebView loads live Vercel CSS at runtime — fonts display correctly.
const inter = localFont({
  src: '../../public/fonts/inter-fallback.woff2',
  variable: '--font-inter',
  display: 'swap',
});

const BASE_URL = 'https://quietkeep.com';

export const metadata = {
  metadataBase: new URL(BASE_URL),
  title: { default: 'QuietKeep — Your Personal Life OS', template: '%s | QuietKeep' },
  description: 'Voice-first personal keeper. Reminders, finance, family, documents, driving mode and more — all in one private, offline-ready app.',
  keywords: ['personal organiser', 'voice notes', 'reminders app', 'family app India', 'life OS', 'QuietKeep', 'Pranix AI'],
  authors: [{ name: 'Pranix AI Labs', url: 'https://pranix.in' }],
  creator: 'Pranix AI Labs',
  publisher: 'Pranix AI Labs',
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
  openGraph: {
    type: 'website', locale: 'en_IN', url: BASE_URL, siteName: 'QuietKeep',
    title: 'QuietKeep — Your Personal Life OS',
    description: 'Voice-first personal keeper. Reminders, finance, family, documents and more.',
    images: [{ url: `${BASE_URL}/api/og`, width: 1200, height: 630, alt: 'QuietKeep — Your Personal Life OS' }],
  },
  twitter: {
    card: 'summary_large_image', site: '@quietkeepapp', creator: '@pranixai',
    title: 'QuietKeep — Your Personal Life OS',
    description: 'Voice-first personal keeper. Reminders, finance, family, documents and more.',
    images: [`${BASE_URL}/api/og`],
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'QuietKeep' },
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { url: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
    apple: [{ url: '/icon-192.png', sizes: '192x192' }],
  },
  manifest: '/manifest.json',
  alternates: { canonical: BASE_URL },
};

export const viewport = {
  themeColor: '#5b5ef4', width: 'device-width',
  initialScale: 1, maximumScale: 1, userScalable: false,
};

export default async function RootLayout({ children }) {
  // Read the qk_display_lang cookie set by LanguageProvider on language change.
  // Falls back to 'en' so SSR always has a valid locale.
  // CAPACITOR_BUILD guard: cookies() is server-only and crashes during
  // output:'export' static generation. Skip it for APK builds — the APK
  // uses localStorage (LanguageProvider) for language, not cookies.
  let displayLocale = 'en';
  if (process.env.CAPACITOR_BUILD !== '1') {
    try {
      const cookieStore = await cookies();
      const lang = cookieStore.get('qk_display_lang')?.value;
      if (lang && ['en', 'hi', 'te'].includes(lang)) displayLocale = lang;
    } catch {}
  }

  let messages = {};
  if (process.env.CAPACITOR_BUILD !== '1') {
    try { messages = await getMessages(); } catch {}
  } else {
    // Static export (APK build): load English messages directly, no server calls.
    try { messages = (await import('../messages/en.json')).default; } catch {}
  }

  // Map display locale back to full voice lang code for LanguageProvider
  const initialLang =
    displayLocale === 'hi' ? 'hi-IN' :
    displayLocale === 'te' ? 'te-IN' : 'en-IN';

  return (
    <html lang={displayLocale}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="QuietKeep" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="apple-touch-startup-image" href="/icon-512.png" />
        <script dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('qk_theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`
        }} />
        <script dangerouslySetInnerHTML={{
          __html: `(function(){
            if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) { return; }
            var s = document.createElement('script');
            s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
            s.defer = true;
            document.head.appendChild(s);
            window.OneSignalDeferred = window.OneSignalDeferred || [];
            OneSignalDeferred.push(async function(OneSignal) {
              try {
                await OneSignal.init({ appId: "b93dd23f-ca74-4210-822f-1e7604a7d02f", notifyButton: { enable: false }, welcomeNotification: { disable: true } });
              } catch(e) {}
            });
          })();`
        }} />
      </head>
      <body className={inter.className} style={{ margin: 0, padding: 0 }}>
        <NextIntlClientProvider messages={messages} locale={displayLocale}>
          <LanguageProvider initialLang={initialLang}>
            <AuthProvider>
              <BiometricGate>{children}</BiometricGate>
            </AuthProvider>
          </LanguageProvider>
        </NextIntlClientProvider>
        <script dangerouslySetInnerHTML={{
          __html: `if('serviceWorker'in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}`
        }} />
      </body>
    </html>
  );
}
