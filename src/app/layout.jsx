import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'QuietKeep — Your Personal Intelligence OS',
  description: 'Voice-first personal keeper. Reminders, finance, family, driving mode.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'QuietKeep',
  },
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
};

export const viewport = {
  themeColor: '#6366f1',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="QuietKeep" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className={inter.className} style={{ margin: 0, padding: 0, backgroundColor: '#0a0a0f' }}>
        {children}
        <script dangerouslySetInnerHTML={{
          __html: `
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function() {
                navigator.serviceWorker.register('/sw.js').then(function(reg) {
                  console.log('SW registered:', reg.scope);
                }).catch(function(err) {
                  console.log('SW registration failed:', err);
                });
              });
            }
          `
        }} />
      </body>
    </html>
  );
}
