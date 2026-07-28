'use client';
// src/app/b/scan/page.jsx — "Scan & Pay" surface (mounts the ScanPay component)
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import ScanPay from '@/components/biz/ScanPay';

export default function ScanPage() {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);
  const [last, setLast] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setToken(session?.access_token || null);
      setReady(true);
    })();
  }, []);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 4px' }}>Scan &amp; Pay</h1>
      <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 16px' }}>
        Scan a product barcode or a customer’s UPI QR — or generate a QR to collect a payment and hear it confirmed aloud.
      </p>

      {!ready ? (
        <p style={{ color: '#64748b' }}>Loading…</p>
      ) : !token ? (
        <p style={{ color: '#dc2626' }}>Please sign in to your business workspace first.</p>
      ) : (
        <ScanPay
          token={token}
          onProduct={(code) => setLast(`Barcode: ${code}`)}
          onUpi={(u) => setLast(`UPI: ${u.name || u.vpa || ''} ₹${u.amount || ''}`)}
          onText={(t) => setLast(`Scanned: ${t}`)}
        />
      )}

      {last && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: '#ecfdf5', color: '#065f46', fontSize: 14, fontWeight: 600 }}>
          {last}
        </div>
      )}
    </div>
  );
}
