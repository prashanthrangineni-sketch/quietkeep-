import './globals.css';
import NavbarClient from './components/NavbarClient';

export const metadata = {
  title: 'QuietKeep — Voice-First Personal Keeper',
  description: 'Capture notes, tasks, and memories. Private, secure, instant.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, padding: 0,
        backgroundColor: '#0a0a0f',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <NavbarClient />
        {children}
      </body>
    </html>
  );
}
