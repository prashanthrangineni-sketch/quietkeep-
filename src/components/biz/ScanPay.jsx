'use client';
// src/components/biz/ScanPay.jsx
// ─────────────────────────────────────────────────────────────────────────────
// The "single scanner": camera surface that reads barcodes and UPI QRs.
//   • UPI QR (upi://pay?...)   → emits onUpi(parsed)
//   • product barcode (EAN/UPC) → emits onProduct(code)
//   • any other text           → emits onText(text)
//
// Collect mode:
// SHOP PAYMENTS GO STRAIGHT TO THE SHOP'S OWN UPI ID. Pranix never holds shop money.
// The old Razorpay create-qr route is subscription-only and NOT shown on counter screens.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { parseUpiUri, buildUpiPayUri } from '@/lib/upi';

function parseScan(raw) {
  const text = (raw || '').trim();
  const parsedUpi = parseUpiUri(text);
  if (parsedUpi.valid && parsedUpi.pa) {
    return {
      kind: 'upi',
      vpa: parsedUpi.pa,
      name: parsedUpi.pn,
      amount: parsedUpi.am,
      raw: text,
    };
  }
  if (/^\d{8,14}$/.test(text)) return { kind: 'barcode', code: text, raw: text };
  return { kind: 'text', raw: text };
}

export default function ScanPay({ token, onProduct, onText, onUpi }) {
  const videoRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const [supported, setSupported] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Collect mode (shop's own direct UPI QR)
  const [collectAmount, setCollectAmount] = useState('');
  const [collectName, setCollectName] = useState('');
  const [collectQr, setCollectQr] = useState(null);
  const [collecting, setCollecting] = useState(false);
  const [workspace, setWorkspace] = useState(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !('BarcodeDetector' in window)) setSupported(false);

    // Load workspace UPI ID
    if (token) {
      fetch('/api/business/workspace', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => res.json())
        .then(d => {
          if (d.data && d.data[0]) {
            setWorkspace(d.data[0]);
          }
        })
        .catch(() => {});
    }

    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function start() {
    setError(''); setResult(null);
    if (!('BarcodeDetector' in window)) { setSupported(false); return; }
    try {
      const detector = new window.BarcodeDetector({
        formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
      });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      const tick = async () => {
        if (!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length) {
            const parsed = parseScan(codes[0].rawValue);
            handleResult(parsed);
            return;
          }
        } catch { /* frame not ready */ }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e?.message || 'Camera unavailable');
      setScanning(false);
    }
  }

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  function handleResult(parsed) {
    stop();
    setResult(parsed);
    if (parsed.kind === 'barcode') onProduct && onProduct(parsed.code);
    else if (parsed.kind === 'upi') onUpi && onUpi(parsed);
    else onText && onText(parsed.raw);
  }

  // Generate direct shop UPI QR (NOT Razorpay)
  async function createCollectQr() {
    setError(''); setCollectQr(null);
    const amount = Number(collectAmount);
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return; }

    if (!workspace?.upi_id) {
      setError('Please add your shop UPI ID in Workspace Settings before collecting UPI payments.');
      return;
    }

    setCollecting(true);
    try {
      const orderRef = `Bill-${Date.now().toString(36).toUpperCase()}`;
      const uri = buildUpiPayUri({
        pa: workspace.upi_id,
        pn: workspace.name || 'Shop',
        am: amount,
        tn: collectName ? `${collectName}-${orderRef}` : orderRef,
        cu: 'INR',
      });

      // Render standard QR via QR service or canvas
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(uri)}`;

      setCollectQr({
        uri,
        qr_image_url: qrImageUrl,
        amount,
        upi_id: workspace.upi_id,
        shop_name: workspace.name,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setCollecting(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Scan */}
      <div style={{ borderRadius: 16, overflow: 'hidden', background: '#000', position: 'relative', aspectRatio: '3/4' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {!scanning && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff' }}>
            {supported
              ? <button onClick={start} style={btn}>📷 Scan barcode / UPI QR</button>
              : <p style={{ padding: 20, textAlign: 'center', opacity: 0.85 }}>Scanning needs the app or a Chromium browser. Use "Collect" below to receive a payment.</p>}
          </div>
        )}
      </div>
      {scanning && <button onClick={stop} style={{ ...btn, background: '#ef4444' }}>Stop</button>}
      {error && <p style={{ color: '#dc2626', fontSize: 14 }}>{error}</p>}
      {result && (
        <div style={card}>
          {result.kind === 'upi' && <>Pay <b>₹{result.amount || '?'}</b> to <b>{result.name || result.vpa}</b></>}
          {result.kind === 'barcode' && <>Product barcode: <b>{result.code}</b></>}
          {result.kind === 'text' && <>Scanned: <span>{result.raw}</span></>}
        </div>
      )}

      {/* Collect (Shop's Own Direct UPI) */}
      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Collect Direct to Shop UPI</strong>
          {workspace?.upi_id ? (
            <span style={{ fontSize: 11, color: '#0e9f6e', fontWeight: 600 }}>
              ✓ {workspace.upi_id}
            </span>
          ) : (
            <a href="/b/onboarding" style={{ fontSize: 11, color: '#ef4444', textDecoration: 'none', fontWeight: 600 }}>
              ⚠️ Set UPI ID
            </a>
          )}
        </div>
        <input value={collectAmount} onChange={e => setCollectAmount(e.target.value)}
          inputMode="decimal" placeholder="Amount (₹)" style={input} />
        <input value={collectName} onChange={e => setCollectName(e.target.value)}
          placeholder="Customer name (optional)" style={input} />
        <button onClick={createCollectQr} disabled={collecting} style={btn}>
          {collecting ? 'Generating…' : 'Show Shop UPI QR'}
        </button>

        {collectQr && (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={collectQr.qr_image_url} alt="Shop UPI QR" style={{ width: 220, height: 220, borderRadius: 12 }} />
            <p style={{ fontSize: 13, color: '#0e9f6e', fontWeight: 700, margin: '8px 0 2px' }}>
              Direct UPI Payment: ₹{collectQr.amount.toFixed(2)}
            </p>
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
              Money goes straight to {collectQr.upi_id}. Pranix holds no customer money.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const btn = { padding: '12px 18px', border: 0, borderRadius: 12, background: '#0e9f6e', color: '#fff', fontWeight: 700, cursor: 'pointer' };
const card = { background: '#fff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 14, padding: 16, fontSize: 15 };
const input = { padding: '11px 14px', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 10, fontSize: 15, outline: 'none' };
