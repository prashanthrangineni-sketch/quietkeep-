'use client';
// src/app/s/[shop]/page.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Public Shop Page (/s/[shop])
//
// 1. Live price list (public items only)
// 2. Interactive cart with quantity controls
// 3. Total calculation (INR)
// 4. "Pay with any UPI app" — opens upi://pay link with pa, pn, am, tn, cu=INR
// 5. "I have paid" button — records order as 'paid - awaiting shop confirmation'
//    Stock is lowered ONLY when the shopkeeper confirms the order.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { buildUpiPayUri, calculateCartTotal } from '@/lib/upi';

const G = '#10b981';
const DARK_BG = '#0f172a';
const SURFACE = '#1e293b';
const BORDER = '#334155';

export default function PublicShopPage() {
  const params = useParams();
  const shopParam = params?.shop;

  const [shop, setShop] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Cart state: { [itemId]: { item, quantity } }
  const [cart, setCart] = useState({});
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Customer info (optional)
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  // Order & Payment state
  const [orderRef, setOrderRef] = useState('');
  const [hasOpenedUpi, setHasOpenedUpi] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null); // { orderRef, total, status }

  // 1. Load shop and public items
  useEffect(() => {
    if (!shopParam) return;
    setLoading(true);
    setError('');

    // Generate a fresh unique order reference for this session
    const ref = `ORD-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    setOrderRef(ref);

    fetch(`/api/shop/${encodeURIComponent(shopParam)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load shop');
        setShop(data.shop);
        setItems(data.items || []);
      })
      .catch((err) => {
        setError(err.message || 'Could not find this shop');
      })
      .finally(() => setLoading(false));
  }, [shopParam]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set();
    items.forEach(it => {
      if (it.category) set.add(it.category);
    });
    return ['All', ...Array.from(set)];
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter(it => {
      const matchCat = selectedCategory === 'All' || it.category === selectedCategory;
      const matchSearch = !search.trim() || it.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [items, selectedCategory, search]);

  // Cart operations
  const cartList = useMemo(() => Object.values(cart), [cart]);
  const cartTotal = useMemo(() => {
    return calculateCartTotal(cartList.map(c => ({
      selling_price: c.item.selling_price,
      quantity: c.quantity,
    })));
  }, [cartList]);
  const cartCount = useMemo(() => {
    return cartList.reduce((sum, c) => sum + c.quantity, 0);
  }, [cartList]);

  function addToCart(item) {
    setCart(prev => {
      const current = prev[item.id]?.quantity || 0;
      return {
        ...prev,
        [item.id]: { item, quantity: current + 1 },
      };
    });
  }

  function decrementCart(itemId) {
    setCart(prev => {
      const current = prev[itemId]?.quantity || 0;
      if (current <= 1) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return {
        ...prev,
        [itemId]: { ...prev[itemId], quantity: current - 1 },
      };
    });
  }

  function removeFromCart(itemId) {
    setCart(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  // 2. Generate UPI Pay URI
  const upiPayUri = useMemo(() => {
    if (!shop?.upi_id || cartTotal <= 0) return '';
    try {
      return buildUpiPayUri({
        pa: shop.upi_id,
        pn: shop.name || 'Shop',
        am: cartTotal,
        tn: orderRef,
        cu: 'INR',
      });
    } catch (_) {
      return '';
    }
  }, [shop, cartTotal, orderRef]);

  // Handle Pay Click
  function handlePayClick() {
    setHasOpenedUpi(true);
  }

  // 3. Handle "I have paid"
  async function handleConfirmPaid() {
    if (cartList.length === 0 || cartTotal <= 0) return;
    setSubmittingOrder(true);
    setError('');

    try {
      const payload = {
        workspace_id: shop.id,
        client_sale_id: orderRef,
        items: cartList.map(c => ({
          item_id: c.item.id,
          name: c.item.name,
          selling_price: c.item.selling_price,
          quantity: c.quantity,
          unit: c.item.unit,
        })),
        total_amount: cartTotal,
        customer_name: customerName,
        customer_phone: customerPhone,
      };

      const res = await fetch('/api/shop/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit order');

      setPlacedOrder({
        orderRef: data.client_sale_id || orderRef,
        total: cartTotal,
        status: data.status,
        shopName: shop.name,
        shopUpi: shop.upi_id,
      });
      setCart({});
      setCartOpen(false);
    } catch (err) {
      setError(err.message || 'Error recording order');
    } finally {
      setSubmittingOrder(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: DARK_BG, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🛒</div>
          <div style={{ fontSize: 16, color: '#94a3b8' }}>Loading shop catalog...</div>
        </div>
      </div>
    );
  }

  if (error && !shop) {
    return (
      <div style={{ minHeight: '100vh', background: DARK_BG, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 400, textAlign: 'center', background: SURFACE, padding: 28, borderRadius: 16, border: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏪</div>
          <h2 style={{ fontSize: 20, margin: '0 0 8px' }}>Shop Not Found</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 20px' }}>
            {error || 'This shop link is invalid or may have closed.'}
          </p>
          <a href="/" style={{ color: G, textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
            ← Return to QuietKeep
          </a>
        </div>
      </div>
    );
  }

  // If order was successfully placed and awaiting confirmation
  if (placedOrder) {
    return (
      <div style={{ minHeight: '100vh', background: DARK_BG, color: '#fff', padding: '24px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 440, width: '100%', background: SURFACE, padding: 28, borderRadius: 20, border: `1.5px solid ${G}`, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <div style={{
            display: 'inline-block',
            background: 'rgba(16, 185, 129, 0.15)',
            color: G,
            padding: '4px 12px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 12,
          }}>
            Paid — Awaiting Shop Confirmation
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>Order Recorded!</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 20px', lineHeight: 1.5 }}>
            Thank you! Your payment of <strong style={{ color: '#fff' }}>₹{placedOrder.total.toFixed(2)}</strong> to{' '}
            <strong style={{ color: '#fff' }}>{placedOrder.shopName}</strong> has been recorded.
          </p>

          <div style={{ background: DARK_BG, borderRadius: 12, padding: 16, marginBottom: 20, textAlign: 'left', border: `1px solid ${BORDER}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Order Ref:</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{placedOrder.orderRef}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Shop UPI:</span>
              <span style={{ fontSize: 13, color: G, fontFamily: 'monospace' }}>{placedOrder.shopUpi}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Stock Status:</span>
              <span style={{ fontSize: 13, color: '#e2e8f0' }}>Reserved on shop approval</span>
            </div>
          </div>

          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 24, lineHeight: 1.5 }}>
            The shopkeeper will verify the UPI transfer on their counter and prepare your items.
          </div>

          <button
            onClick={() => {
              setPlacedOrder(null);
              setHasOpenedUpi(false);
              const ref = `ORD-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
              setOrderRef(ref);
            }}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: 12,
              border: 'none',
              background: `linear-gradient(135deg, ${G}, #059669)`,
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Order Again from {shop?.name}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: DARK_BG, color: '#fff', fontFamily: 'system-ui, -apple-system, sans-serif', paddingBottom: 120 }}>
      {/* ── Shop Header ── */}
      <header style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}`, padding: '20px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 24 }}>🏪</span>
              <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: '#fff' }}>{shop?.name}</h1>
            </div>
            {shop?.address && (
              <p style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 0' }}>{shop.address}</p>
            )}
            {shop?.upi_id && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, background: 'rgba(16,185,129,0.12)', color: G, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                <span>Direct Shop UPI:</span>
                <span style={{ fontFamily: 'monospace' }}>{shop.upi_id}</span>
              </div>
            )}
          </div>
          {shop?.phone && (
            <a
              href={`tel:${shop.phone}`}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${BORDER}`,
                color: '#fff',
                padding: '8px 12px',
                borderRadius: 10,
                fontSize: 12,
                textDecoration: 'none',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              📞 Call Shop
            </a>
          )}
        </div>
      </header>

      {/* ── Main Catalog Surface ── */}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '16px' }}>
        {/* UPI ID missing alert */}
        {!shop?.upi_id && (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 12, padding: 14, marginBottom: 16, color: '#f87171', fontSize: 13 }}>
            ⚠️ This shop has not configured its UPI ID yet. Orders cannot be paid online right now.
          </div>
        )}

        {/* Search bar */}
        <div style={{ marginBottom: 14 }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search live price list..."
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              background: SURFACE,
              color: '#fff',
              fontSize: 14,
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        {/* Categories scrollable pills */}
        {categories.length > 2 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 16, scrollbarWidth: 'none' }}>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: `1px solid ${selectedCategory === cat ? G : BORDER}`,
                  background: selectedCategory === cat ? G : SURFACE,
                  color: selectedCategory === cat ? '#fff' : '#94a3b8',
                  whiteSpace: 'nowrap',
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Live Items Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <div>No public items found matching your filter.</div>
            </div>
          ) : (
            filteredItems.map(item => {
              const inCartQty = cart[item.id]?.quantity || 0;
              return (
                <div
                  key={item.id}
                  style={{
                    background: SURFACE,
                    border: `1px solid ${inCartQty > 0 ? G : BORDER}`,
                    borderRadius: 14,
                    padding: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{item.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: G }}>
                        ₹{item.selling_price.toFixed(2)}
                      </span>
                      {item.unit && (
                        <span style={{ fontSize: 11, color: '#64748b' }}>/ {item.unit}</span>
                      )}
                      {item.is_made_on_spot ? (
                        <span style={{ fontSize: 10, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '2px 6px', borderRadius: 4 }}>
                          Made to order
                        </span>
                      ) : item.current_stock > 0 ? (
                        <span style={{ fontSize: 10, background: 'rgba(16, 185, 129, 0.1)', color: G, padding: '2px 6px', borderRadius: 4 }}>
                          In stock ({item.current_stock})
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', padding: '2px 6px', borderRadius: 4 }}>
                          Out of stock
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quantity / Add Button */}
                  <div>
                    {inCartQty === 0 ? (
                      <button
                        onClick={() => addToCart(item)}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 8,
                          border: 'none',
                          background: G,
                          color: '#fff',
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        + Add
                      </button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: DARK_BG, padding: '4px 8px', borderRadius: 8, border: `1px solid ${G}` }}>
                        <button
                          onClick={() => decrementCart(item.id)}
                          style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}
                        >
                          -
                        </button>
                        <span style={{ fontSize: 13, fontWeight: 700, color: G, minWidth: 16, textAlign: 'center' }}>
                          {inCartQty}
                        </span>
                        <button
                          onClick={() => addToCart(item)}
                          style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* ── Sticky Bottom Cart Bar ── */}
      {cartCount > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(12px)',
          borderTop: `1px solid ${BORDER}`,
          padding: '12px 16px',
          zIndex: 40,
        }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {cartCount} item{cartCount > 1 ? 's' : ''} in cart
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>
                ₹{cartTotal.toFixed(2)}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setCartOpen(!cartOpen)}
                style={{
                  padding: '12px 16px',
                  borderRadius: 12,
                  border: `1px solid ${BORDER}`,
                  background: SURFACE,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {cartOpen ? 'Hide Cart ▲' : 'View Cart ▼'}
              </button>

              {upiPayUri ? (
                <a
                  href={upiPayUri}
                  onClick={handlePayClick}
                  style={{
                    padding: '12px 20px',
                    borderRadius: 12,
                    background: `linear-gradient(135deg, ${G}, #059669)`,
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>Pay with UPI</span>
                  <span>→</span>
                </a>
              ) : (
                <button
                  disabled
                  style={{
                    padding: '12px 20px',
                    borderRadius: 12,
                    background: '#334155',
                    color: '#94a3b8',
                    fontSize: 14,
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'not-allowed',
                  }}
                >
                  Pay with UPI
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Cart Drawer / Sheet ── */}
      {cartOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 74,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 35,
          display: 'flex',
          justifyContent: 'flex-end',
          flexDirection: 'column',
        }} onClick={() => setCartOpen(false)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: SURFACE,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              border: `1px solid ${BORDER}`,
              maxHeight: '80vh',
              overflowY: 'auto',
              padding: 20,
              maxWidth: 720,
              width: '100%',
              margin: '0 auto',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Your Order Cart</h3>
              <button
                onClick={() => setCartOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 16, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Cart Items list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {cartList.map(c => (
                <div key={c.item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${BORDER}`, paddingBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{c.item.name}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>₹{c.item.selling_price.toFixed(2)} × {c.quantity}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: G }}>
                      ₹{(c.item.selling_price * c.quantity).toFixed(2)}
                    </span>
                    <button
                      onClick={() => removeFromCart(c.item.id)}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: 14, cursor: 'pointer', padding: '0 4px' }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Optional Customer info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Your Name (optional)</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="e.g. Ramesh"
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 8,
                    background: DARK_BG, border: `1px solid ${BORDER}`, color: '#fff', fontSize: 12,
                    boxSizing: 'border-box', marginTop: 4,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Phone (optional)</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 8,
                    background: DARK_BG, border: `1px solid ${BORDER}`, color: '#fff', fontSize: 12,
                    boxSizing: 'border-box', marginTop: 4,
                  }}
                />
              </div>
            </div>

            {/* Total breakdown */}
            <div style={{ background: DARK_BG, padding: 14, borderRadius: 12, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>Total Amount</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: G }}>₹{cartTotal.toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                Ref: <span style={{ fontFamily: 'monospace' }}>{orderRef}</span>
              </div>
            </div>

            {/* Payment buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {upiPayUri && (
                <a
                  href={upiPayUri}
                  onClick={handlePayClick}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: 12,
                    background: `linear-gradient(135deg, ${G}, #059669)`,
                    color: '#fff',
                    fontSize: 15,
                    fontWeight: 700,
                    textAlign: 'center',
                    textDecoration: 'none',
                    display: 'block',
                    boxSizing: 'border-box',
                  }}
                >
                  Pay ₹{cartTotal.toFixed(2)} with any UPI App
                </a>
              )}

              {/* "I have paid" confirmation button */}
              <button
                onClick={handleConfirmPaid}
                disabled={submittingOrder}
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: 12,
                  border: `1.5px solid ${G}`,
                  background: hasOpenedUpi ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                  color: G,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: submittingOrder ? 'not-allowed' : 'pointer',
                }}
              >
                {submittingOrder ? 'Recording Order...' : '✓ I Have Paid'}
              </button>

              <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center', marginTop: 4 }}>
                After completing payment in Google Pay / PhonePe / Paytm, tap <strong>"I Have Paid"</strong> so the shopkeeper can confirm your order.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
