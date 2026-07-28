'use client';
// src/components/biz/ScanPay.jsx
// ─────────────────────────────────────────────────────────────────────────────
// The "single scanner": one camera surface that reads by content and routes.
//   • UPI QR  (upi://pay?...)      → shows the payee/amount to pay
//   • product barcode (EAN/UPC)    → emits onProduct(code) for inventory/billing
//   • any other QR/text            → emits onText(text)
// Plus a "Collect" mode that calls /api/business/payments/create-qr to generate
// a dynamic UPI QR for a bill amount (the software soundbox front end).
//
// Dependency-free: uses the native BarcodeDetector API (available in Android
// WebView / Chromium). Degrades honestly with a clear message where absent
// (e.g. iOS Safari) instead of pretending to scan.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';

function parseScan(raw) {
  const text = (raw || '').trim();
  if (/^upi:\/\//i.test(text)) {
    // upi://pay?pa=vpa&pn=Name&am=100&...
    try {
      const q = new URLSearchParams(text.split('?')[1] || '');
      return { kind: 'upi', vpa: q.get('pa'), name: q.get('pn'), amount: q.get('am'), raw: text };
    } catch { return { kind: 'upi', raw: text }; }
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

  // Collect mode (generate a QR to receive money)
  const [collectAmount, setCollectAmount] = useState('');
  const [collectName, setCollectName] = useState('');
  const [collectQr, setCollectQr] = useState(null);
  const [collecting, setCollecting] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && !('BarcodeDetector' in window)) setSupported(false);
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            return; // stop after first hit
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

  async function createCollectQr() {
    setError(''); setCollectQr(null);
    const amount = Number(collectAmount);
    if (!amount || amount <= 0) { setError('Enter an amount'); return; }
    setCollecting(true);
    try {
      const res = await fetch('/api/business/payments/create-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount, customer_name: collectName || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create QR');
      setCollectQr(data);
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
              : <p style={{ padding: 20, textAlign: 'center', opacity: 0.85 }}>Scanning needs the app or a Chromium browser. Use “Collect” below to receive a payment.</p>}
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

      {/* Collect (software soundbox) */}
      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <strong>Collect a payment</strong>
        <input value={collectAmount} onChange={e => setCollectAmount(e.target.value)}
          inputMode="decimal" placeholder="Amount (₹)" style={input} />
        <input value={collectName} onChange={e => setCollectName(e.target.value)}
          placeholder="Customer name (optional)" style={input} />
        <button onClick={createCollectQr} disabled={collecting} style={btn}>
          {collecting ? 'Generating…' : 'Show UPI QR'}
        </button>
        {collectQr?.qr_image_url && (
          <div style={{ textAlign: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={collectQr.qr_image_url} alt="Scan to pay" style={{ width: 220, height: 220 }} />
            <p style={{ fontSize: 13, color: '#64748b' }}>Ask the customer to scan. You’ll hear the confirmation when it’s paid.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const btn = { padding: '12px 18px', border: 0, borderRadius: 12, background: '#0e9f6e', color: '#fff', fontWeight: 700, cursor: 'pointer' };
const card = { background: '#fff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 14, padding: 16, fontSize: 15 };
const input = { padding: '11px 14px', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 10, fontSize: 15, outline: 'none' };
