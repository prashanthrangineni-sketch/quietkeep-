import './globals.css';
import Navbar from './components/Navbar';

export const metadata = {
  title: 'QuietKeep — Voice-First Personal Keeper',
  description: 'Capture notes, tasks, and memories with your voice. Private, secure, instant.',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        padding: 0,
        backgroundColor: '#0a0a0f',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <Navbar />
        {children}
      </body>
    </html>
  );
}
