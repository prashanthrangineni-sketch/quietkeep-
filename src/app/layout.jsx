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
        <nav style={{
          position: 'sticky', top: 0, zIndex: 1000,
          backgroundColor: '#0a0a0f',
          borderBottom: '1px solid #1e1e2e',
        }}>
          <div style={{
            maxWidth: '1200px', margin: '0 auto', padding: '0 20px',
            height: '56px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
              <div style={{
                width: '34px', height: '34px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                borderRadius: '8px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontWeight: '800', fontSize: '14px', color: '#fff',
              }}>QK</div>
              <span style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9' }}>QuietKeep</span>
            </a>
            <div style={{ display: 'flex', gap: '12px' }}>
              <a href="/dashboard" style={{
                color: '#94a3b8', textDecoration: 'none', fontSize: '14px', fontWeight: '500',
                padding: '6px 12px',
              }}>Dashboard</a>
              <a href="/login" id="nav-signin" style={{
                backgroundColor: '#6366f1', color: '#fff', textDecoration: 'none',
                padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
              }}>Sign In</a>
            </div>
          </div>
        </nav>
        {children}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var s = localStorage.getItem('sb-ofnhwpzzxthdvvunxsfs-auth-token');
              if (s) {
                var el = document.getElementById('nav-signin');
                if (el) el.style.display = 'none';
              }
            } catch(e) {}
          })();
        `}} />
      </body>
    </html>
  );
}
