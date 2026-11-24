'use client';
// src/app/b/counter/page.jsx
// ─────────────────────────────────────────────────────────────────────────────
// TASK B2: Quick Counter Screen in Business (/b/counter)
// - Big picture tiles of shop top items (one tap = one sale)
// - Cash / UPI mode toggle switch
// - 10-second Undo banner with countdown
// - Offline support: saves to localStorage, syncs later with idempotency
// - Text command sale parser (English, Hindi, Telugu) with confirmation card
//   and unknown word item pickers
// - Unmatched UPI payment matching ('What was this for?')
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { resolveWorkspace } from '@/lib/resolve-workspace';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';

const G = '#10b981';
const G_DIM = 'rgba(16, 185, 129, 0.12)';
const OFFLINE_STORAGE_KEY = 'quietkeep_offline_counter_sales';

// Helper emoji picker for common retail items
function getItemEmoji(name = '') {
  const n = name.toLowerCase();
  if (n.includes('chai') || n.includes('tea') || n.includes('టీ') || n.includes('चाय')) return '☕';
  if (n.includes('coffee') || n.includes('काफी') || n.includes('కాఫీ')) return '☕';
  if (n.includes('samosa') || n.includes('సమోసా') || n.includes('समोसा')) return '🥟';
  if (n.includes('biscuit') || n.includes('cookie') || n.includes('బిస్కెట్')) return '🍪';
  if (n.includes('bun') || n.includes('bread') || n.includes('बన్')) return '🍞';
  if (n.includes('milk') || n.includes('दूध') || n.includes('పాలు')) return '🥛';
  if (n.includes('water') || n.includes('నీళ్ళు') || n.includes('पानी')) return '💧';
  if (n.includes('dosa') || n.includes('దోశ') || n.includes('डोसा')) return '🥞';
  if (n.includes('idli') || n.includes('ఇడ్లీ') || n.includes('इडली')) return '⚪';
  if (n.includes('vada') || n.includes('వడ') || n.includes('वड़ा')) return '🍩';
  if (n.includes('cigarette') || n.includes('sutta') || n.includes('సిగరెట్')) return '🚬';
  if (n.includes('maggi') || n.includes('noodles') || n.includes('మ్యాగీ')) return '🍜';
  return '📦';
}

function generateUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'sale_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

export default function CounterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const matchUpiId = searchParams.get('match_upi');
  const matchUpiAmount = searchParams.get('amount');

  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paymentMode, setPaymentMode] = useState('cash'); // 'cash' | 'upi'

  // Offline queue state
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [isOnline, setIsOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Undo banner state (10 seconds)
  const [activeUndo, setActiveUndo] = useState(null); // { saleId, item, timerId, secondsLeft, totalSeconds: 10 }
  const [undoProgress, setUndoProgress] = useState(100);

  // Text command state
  const [commandText, setCommandText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [confirmCard, setConfirmCard] = useState(null); // parsed command waiting for confirmation
  const [disambiguations, setDisambiguations] = useState({}); // { [unknownRaw]: selectedItemId }

  // Unmatched UPI banner state
  const [unmatchedCard, setUnmatchedCard] = useState(null);
  const [matchedSelectedItems, setMatchedSelectedItems] = useState([]);

  // Load offline queue from localStorage
  const loadOfflineQueue = useCallback(() => {
    try {
      const saved = localStorage.getItem(OFFLINE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setOfflineQueue(Array.isArray(parsed) ? parsed : []);
      }
    } catch (_) {}
  }, []);

  const saveOfflineQueue = (queue) => {
    setOfflineQueue(queue);
    try {
      localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(queue));
    } catch (_) {}
  };

  // Sync offline queue to server with idempotency
  const syncOfflineQueue = useCallback(async (token, wsId) => {
    try {
      const saved = localStorage.getItem(OFFLINE_STORAGE_KEY);
      if (!saved) return;
      const queue = JSON.parse(saved);
      if (!Array.isArray(queue) || queue.length === 0) return;

      setSyncing(true);
      const res = await fetch('/api/business/counter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ batch: queue }),
      });

      if (res.ok) {
        // Clear synced items
        saveOfflineQueue([]);
      }
    } catch (e) {
      console.warn('[COUNTER SYNC ERROR]', e.message);
    } finally {
      setSyncing(false);
    }
  }, []);

  // Monitor network status
  useEffect(() => {
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const handleOnline = () => {
      setIsOnline(true);
      if (accessToken && workspace?.id) syncOfflineQueue(accessToken, workspace.id);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [accessToken, workspace?.id, syncOfflineQueue]);

  // Auth & initial data load
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/biz-login');
      return;
    }

    (async () => {
      loadOfflineQueue();
      const ws = await resolveWorkspace(supabase, user.id, 'id');
      if (ws) {
        setWorkspace(ws);
        await loadCounterData(accessToken, ws.id);
        if (navigator.onLine && accessToken) {
          syncOfflineQueue(accessToken, ws.id);
        }
      }
    })();
  }, [user, authLoading, accessToken]);

  const loadCounterData = async (token, wsId) => {
    setLoading(true);
    try {
      const res = await fetch('/api/business/counter', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.items)) {
        setItems(data.items);
      }

      // Check for unmatched UPI card if passed in URL or from API
      if (matchUpiId) {
        setUnmatchedCard({
          id: matchUpiId,
          amount: matchUpiAmount || '0',
          snippet: `₹${matchUpiAmount || '0'} received via UPI. Tap items below to match.`,
        });
      } else {
        const upiRes = await fetch('/api/business/counter/unmatched-payments', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const upiData = await upiRes.json();
        if (upiData.ok && upiData.cards && upiData.cards.length > 0) {
          const first = upiData.cards[0];
          setUnmatchedCard({
            id: first.id,
            amount: first.payload?.amount || '0',
            snippet: first.payload?.snippet || `₹${first.payload?.amount || 0} received via UPI.`,
          });
        }
      }
    } catch (e) {
      console.error('[COUNTER LOAD ERROR]', e.message);
    } finally {
      setLoading(false);
    }
  };

  // Undo Timer countdown effect
  useEffect(() => {
    if (!activeUndo) return;
    const interval = setInterval(() => {
      setActiveUndo((prev) => {
        if (!prev) return null;
        const nextSeconds = prev.secondsLeft - 0.1;
        if (nextSeconds <= 0) {
          return null; // timer expired, sale stays permanent
        }
        setUndoProgress((nextSeconds / prev.totalSeconds) * 100);
        return { ...prev, secondsLeft: nextSeconds };
      });
    }, 100);

    return () => clearInterval(interval);
  }, [activeUndo]);

  // One Tap = One Sale
  const handleTileTap = async (item) => {
    if (!workspace) return;

    // If in unmatched UPI matching mode, add to matched list
    if (unmatchedCard) {
      setMatchedSelectedItems((prev) => {
        const existing = prev.find((i) => i.id === item.id);
        if (existing) {
          return prev.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
        }
        return [...prev, { ...item, quantity: 1 }];
      });
      return;
    }

    const clientSaleId = generateUuid();
    const qty = 1;
    const price = Number(item.selling_price || 0);
    const salePayload = {
      client_sale_id: clientSaleId,
      items: [{ item_id: item.id, name: item.name, quantity: qty, unit_price: price }],
      payment_mode: paymentMode,
      total_amount: price * qty,
      source: 'counter',
      created_at: new Date().toISOString(),
    };

    // Optimistic stock decrement locally
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === item.id) {
          return { ...it, current_stock: Math.max(0, Number(it.current_stock || 0) - qty) };
        }
        return it;
      })
    );

    // Set 10-second undo banner
    setActiveUndo({
      clientSaleId,
      item,
      qty,
      price,
      paymentMode,
      secondsLeft: 10,
      totalSeconds: 10,
    });
    setUndoProgress(100);

    // Save offline or send online
    if (!isOnline) {
      const updated = [...offlineQueue, salePayload];
      saveOfflineQueue(updated);
    } else {
      try {
        const res = await fetch('/api/business/counter', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(salePayload),
        });
        const json = await res.json();
        if (json.sale?.id) {
          setActiveUndo((prev) => (prev ? { ...prev, serverSaleId: json.sale.id } : null));
        }
      } catch (err) {
        // Fallback to offline queue
        const updated = [...offlineQueue, salePayload];
        saveOfflineQueue(updated);
      }
    }
  };

  // Trigger Undo
  const handleUndo = async () => {
    if (!activeUndo) return;
    const { serverSaleId, clientSaleId, item, qty } = activeUndo;

    // Restore stock locally
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === item.id) {
          return { ...it, current_stock: Number(it.current_stock || 0) + qty };
        }
        return it;
      })
    );

    // Remove from offline queue if queued
    const filteredQueue = offlineQueue.filter((s) => s.client_sale_id !== clientSaleId);
    saveOfflineQueue(filteredQueue);

    // If already posted to server, call undo endpoint
    if (serverSaleId && isOnline) {
      try {
        await fetch('/api/business/counter/undo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ sale_id: serverSaleId }),
        });
      } catch (_) {}
    }

    setActiveUndo(null);
  };

  // Text Command Parse
  const handleParseCommand = async (e) => {
    if (e) e.preventDefault();
    if (!commandText.trim()) return;

    setParsing(true);
    try {
      const res = await fetch('/api/business/counter/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ command: commandText }),
      });
      const data = await res.json();
      if (data.ok) {
        setConfirmCard(data);
        setDisambiguations({});
      }
    } catch (err) {
      alert('Error parsing command: ' + err.message);
    } finally {
      setParsing(false);
    }
  };

  // Confirm Text Command Sale
  const handleConfirmTextSale = async () => {
    if (!confirmCard) return;

    // Resolve any unknown items from disambiguation picker
    const resolvedItems = [];
    for (const item of confirmCard.items) {
      if (item.matched) {
        resolvedItems.push(item);
      } else {
        const pickedId = disambiguations[item.raw_name];
        if (pickedId) {
          const matchedShopItem = items.find((si) => si.id === pickedId);
          if (matchedShopItem) {
            resolvedItems.push({
              item_id: matchedShopItem.id,
              name: matchedShopItem.name,
              quantity: item.quantity,
              unit_price: Number(matchedShopItem.selling_price || 0),
              total_price: item.quantity * Number(matchedShopItem.selling_price || 0),
            });
          }
        }
      }
    }

    if (resolvedItems.length === 0) {
      alert('Please pick valid items from the shop.');
      return;
    }

    const total = resolvedItems.reduce((acc, i) => acc + (i.total_price || 0), 0);
    const clientSaleId = generateUuid();
    const payload = {
      client_sale_id: clientSaleId,
      items: resolvedItems,
      payment_mode: confirmCard.payment_mode || paymentMode,
      total_amount: total,
      source: 'text_command',
      created_at: new Date().toISOString(),
    };

    // Save offline or online
    if (!isOnline) {
      saveOfflineQueue([...offlineQueue, payload]);
    } else {
      await fetch('/api/business/counter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
    }

    // Refresh inventory
    loadCounterData(accessToken, workspace.id);
    setConfirmCard(null);
    setCommandText('');
  };

  // Resolve Unmatched UPI Payment
  const handleResolveUnmatchedUpi = async (action) => {
    if (!unmatchedCard) return;
    try {
      await fetch('/api/business/counter/unmatched-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          approval_id: unmatchedCard.id,
          action,
          items: matchedSelectedItems,
        }),
      });
      setUnmatchedCard(null);
      setMatchedSelectedItems([]);
      loadCounterData(accessToken, workspace.id);
    } catch (e) {
      alert('Error updating UPI payment: ' + e.message);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="qk-spinner" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 120, color: 'var(--text)' }}>
      <BizNavbar />

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '16px' }}>
        {/* Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-0.5px' }}>
              ⚡ Quick Counter
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '2px 0 0 0' }}>
              One tap = one sale • Lowers stock instantly
            </p>
          </div>

          {/* Offline / Online indicator & sync button */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {!isOnline ? (
              <span style={{ fontSize: 11, background: '#ef4444', color: '#fff', padding: '3px 8px', borderRadius: 12, fontWeight: 700 }}>
                Offline
              </span>
            ) : offlineQueue.length > 0 ? (
              <button
                onClick={() => syncOfflineQueue(accessToken, workspace.id)}
                disabled={syncing}
                className="qk-btn qk-btn-sm"
                style={{ background: '#f59e0b', color: '#000', fontSize: 11, padding: '4px 8px', border: 'none', fontWeight: 700 }}>
                {syncing ? 'Syncing...' : `Sync (${offlineQueue.length})`}
              </button>
            ) : (
              <span style={{ fontSize: 11, background: G_DIM, color: G, padding: '3px 8px', borderRadius: 12, fontWeight: 700 }}>
                ● Online
              </span>
            )}
          </div>
        </div>

        {/* Unmatched UPI Card Banner (What was this for?) */}
        {unmatchedCard && (
          <div className="qk-card" style={{ marginBottom: 16, border: '1.5px solid #f59e0b', background: 'rgba(245, 158, 11, 0.08)', padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#d97706', marginBottom: 4 }}>
                  💰 Unmatched UPI Payment ({'₹' + unmatchedCard.amount})
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)' }}>
                  {unmatchedCard.snippet}
                </div>
              </div>
              <button
                onClick={() => handleResolveUnmatchedUpi('skip')}
                className="qk-btn qk-btn-sm"
                style={{ background: 'transparent', border: '1px solid var(--border)', fontSize: 11, padding: '2px 8px' }}>
                Skip
              </button>
            </div>

            {matchedSelectedItems.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed rgba(245, 158, 11, 0.3)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                  Selected Items to Lower Stock:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {matchedSelectedItems.map((mi) => (
                    <span key={mi.id} style={{ fontSize: 11, background: 'var(--surface)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
                      {mi.quantity}× {mi.name}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => handleResolveUnmatchedUpi('pick_items')}
                  className="qk-btn qk-btn-sm"
                  style={{ marginTop: 8, background: G, color: '#fff', border: 'none', width: '100%', fontWeight: 700 }}>
                  ✓ Confirm Items & Lower Stock
                </button>
              </div>
            )}
          </div>
        )}

        {/* Text Command Sale Bar */}
        <div className="qk-card" style={{ marginBottom: 16, padding: '10px 12px' }}>
          <form onSubmit={handleParseCommand} style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={commandText}
              onChange={(e) => setCommandText(e.target.value)}
              placeholder="Quick sale: '3 chai 2 samosa cash' or 'రెండు టీ ఒక కాఫీ'..."
              className="qk-input"
              style={{ fontSize: 13, flex: 1 }}
            />
            <button
              type="submit"
              disabled={parsing || !commandText.trim()}
              className="qk-btn qk-btn-sm"
              style={{ background: G, color: '#fff', border: 'none', fontWeight: 700, padding: '0 14px' }}>
              {parsing ? '...' : 'Parse'}
            </button>
          </form>

          {/* Text Command Confirmation Card */}
          {confirmCard && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: G }}>
                  Confirm Command Sale
                </span>
                <span style={{ fontSize: 11, background: confirmCard.payment_mode === 'upi' ? '#3b82f6' : G, color: '#fff', padding: '2px 8px', borderRadius: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                  {confirmCard.payment_mode}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {confirmCard.items.map((it, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <span>
                      {it.quantity}× {it.name}
                      {it.is_made_on_spot && <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 4 }}>(Recipe)</span>}
                    </span>
                    {it.matched ? (
                      <span style={{ fontWeight: 700 }}>₹{it.total_price}</span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#ef4444', fontSize: 11 }}>Unknown</span>
                        <select
                          className="qk-input"
                          style={{ fontSize: 11, padding: '2px 4px' }}
                          value={disambiguations[it.raw_name] || ''}
                          onChange={(e) =>
                            setDisambiguations({ ...disambiguations, [it.raw_name]: e.target.value })
                          }>
                          <option value="">Pick shop item...</option>
                          {items.map((si) => (
                            <option key={si.id} value={si.id}>
                              {si.name} (₹{si.selling_price || 0})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border)', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Total</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: G }}>
                  ₹{confirmCard.total_amount}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleConfirmTextSale}
                  className="qk-btn qk-btn-sm"
                  style={{ flex: 1, background: G, color: '#fff', border: 'none', fontWeight: 700 }}>
                  ✓ Record Sale & Lower Stock
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCard(null)}
                  className="qk-btn qk-btn-sm"
                  style={{ background: 'transparent', border: '1px solid var(--border)' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Payment Mode Switch (Cash vs UPI) */}
        <div style={{ display: 'flex', background: 'var(--surface)', padding: 4, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setPaymentMode('cash')}
            style={{
              flex: 1,
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              fontWeight: 800,
              fontSize: 14,
              cursor: 'pointer',
              background: paymentMode === 'cash' ? G : 'transparent',
              color: paymentMode === 'cash' ? '#fff' : 'var(--text-subtle)',
              transition: 'all 0.15s ease',
            }}>
            💵 Cash Mode
          </button>
          <button
            type="button"
            onClick={() => setPaymentMode('upi')}
            style={{
              flex: 1,
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              fontWeight: 800,
              fontSize: 14,
              cursor: 'pointer',
              background: paymentMode === 'upi' ? '#3b82f6' : 'transparent',
              color: paymentMode === 'upi' ? '#fff' : 'var(--text-subtle)',
              transition: 'all 0.15s ease',
            }}>
            📱 UPI Mode
          </button>
        </div>

        {/* Big Picture Tiles Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
          {items.map((item) => {
            const stock = Number(item.current_stock || 0);
            const isOutOfStock = !item.is_made_on_spot && stock <= 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleTileTap(item)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--surface)',
                  border: `1.5px solid ${isOutOfStock ? 'rgba(239, 68, 68, 0.3)' : 'var(--border)'}`,
                  borderRadius: 14,
                  padding: '16px 10px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  position: 'relative',
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent',
                  opacity: isOutOfStock ? 0.6 : 1,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                }}>
                {/* Item Image or Emoji */}
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt={item.name}
                    style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }}
                  />
                ) : (
                  <div style={{ fontSize: 36, marginBottom: 6 }}>
                    {getItemEmoji(item.name)}
                  </div>
                )}

                {/* Name */}
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2, marginBottom: 4 }}>
                  {item.name}
                </div>

                {/* Price */}
                <div style={{ fontSize: 14, fontWeight: 800, color: G }}>
                  ₹{item.selling_price || 0}
                </div>

                {/* Stock or Recipe badge */}
                <div style={{ marginTop: 4 }}>
                  {item.is_made_on_spot ? (
                    <span style={{ fontSize: 10, background: 'rgba(245, 158, 11, 0.15)', color: '#d97706', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                      Recipe
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, background: isOutOfStock ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: isOutOfStock ? '#ef4444' : G, padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                      {stock} left
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Floating 10-Second Undo Banner */}
      {activeUndo && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: 16,
            right: 16,
            maxWidth: 500,
            margin: '0 auto',
            background: '#1e293b',
            color: '#fff',
            borderRadius: 12,
            boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
            zIndex: 1000,
            overflow: 'hidden',
          }}>
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                Sold 1× {activeUndo.item.name} (₹{activeUndo.price}, {activeUndo.paymentMode.toUpperCase()})
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Stock lowered. Tap undo within {Math.ceil(activeUndo.secondsLeft)}s to cancel.
              </div>
            </div>

            <button
              type="button"
              onClick={handleUndo}
              style={{
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}>
              Undo ({Math.ceil(activeUndo.secondsLeft)}s)
            </button>
          </div>

          {/* Progress bar countdown */}
          <div
            style={{
              height: 4,
              background: G,
              width: `${undoProgress}%`,
              transition: 'width 0.1s linear',
            }}
          />
        </div>
      )}
    </div>
  );
}
