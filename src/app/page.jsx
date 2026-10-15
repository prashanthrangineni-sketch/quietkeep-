// src/app/page.jsx — the public home page.
//
// A server component on purpose: it only carries the metadata for "/" and
// hands the page to home-client.jsx. Everything a visitor, Google or a link
// preview needs is in the HTML the server sends; the sign-in check runs in the
// browser afterwards and only redirects signed-in users of the native app.
import HomeClient from './home-client';

const BASE_URL = 'https://quietkeep.com';
const TITLE = 'QuietKeep — Meet Aaria. Your voice does the work now.';
const DESCRIPTION =
  'Aaria is the voice assistant inside QuietKeep. Say it in Telugu, Hindi or English and she sets the reminder, logs the money or books the meeting — for your home and your business. Free on Android and the web.';
// An image that already ships in /public. A real PNG, so WhatsApp and other
// link previews can show it (the /api/og image is SVG, which most of them skip).
const IMAGE = { url: `${BASE_URL}/icon-512.png`, width: 512, height: 512, alt: 'QuietKeep app icon' };

export const metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  authors: [{ name: 'Pranix AI Labs Private Limited', url: 'https://pranixailabs.com' }],
  alternates: { canonical: BASE_URL },
  openGraph: {
    type: 'website', locale: 'en_IN', url: BASE_URL, siteName: 'QuietKeep',
    title: TITLE,
    description: DESCRIPTION,
    images: [IMAGE],
  },
  twitter: {
    card: 'summary', site: '@quietkeepapp',
    title: TITLE,
    description: DESCRIPTION,
    images: [IMAGE.url],
  },
};

export default function HomePage() {
  return <HomeClient />;
}
