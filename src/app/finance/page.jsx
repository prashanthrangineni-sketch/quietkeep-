'use client';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const EXP_CATS = ['Food','Groceries','Transport','Shopping','Health','Entertainment','Bills','Education','Travel','Other'];
const PAY_METHODS = ['UPI','Cash','Card','Net Banking','Wallet','Other'];
const SUB_CYCLES = ['monthly','yearly','weekly','quarterly'];
const inp = { width:'100%', background:'#111', border:'1px solid #333', borderRadius:8, color:'#fff', padding:'0.6rem 0.75rem', fontSize:'0.88rem', outline:'none', boxSizing:'border-box' };
const btn1 = { padding:'0.6rem 1.2rem', borderRadius:8, border:'none', background:'#6366f1', color:'#fff', fontSize:'0.88rem', fontWeight:600, cursor:'pointer' };
const btn0 = { ...btn1, background:'transparent', border:'1px solid #333', color:'#aaa' };
const lbl = { color:'#aaa', fontSize:'0.78rem', display:'block', marginBottom:4 };
const g2 = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginBottom:'0.75rem' };

export default function FinancePage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('expenses');
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [showAddE, setShowAddE] = useState(false);
  const [showAddB, setShowAddB] = useState(false);
  const [showAddS, setShowAddS] = useState(false);
  const [eAmt, setEAmt] = useState(''); const [eCat, setECat] = useState('Food'); const [eDesc, setEDesc] = useState(''); const [ePay, setEPay] = useState('UPI'); const [eDate, setEDate] = useState(new Date().toISOString().split('T')[0]); const [savingE, setSavingE] = useState(false); const [eError, setEError] = useState('');
  const [bCat, setBCat] = useState('Food'); const [bLimit, setBLimit] = useState(''); const [bThresh, setBThresh] = useState(80); const [savingB, setSavingB] = useState(false);
  const [sName, setSName] = useState(''); const [sAmt, setSAmt] = useState(''); const [sCycle, setSCycle] = useState('monthly'); const [sDue, setSDue] = useState(''); const [sCat, setSCat] = useState('Entertainment'); const [savingS, setSavingS] = useState(false);
  const thisMonth = new Date().toISOString().slice(0, 7);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login'; return; }
    setUser(user);
    const [eR, bR, sR] = await Promise.all([
      supabase.from('expenses').select('*').eq('user_id', user.id).order('expense_date', { ascending: false }).limit(50),
      supabase.from('budgets').select('*').eq('user_id', user.id).eq('month_year', new Date().toISOString().slice(0,7)),
      supabase.from('subscriptions').select('*').eq('user_id', user.id).eq('is_active', true).order('next_due', { ascending: true }),
    ]);
    setExpenses(eR.data || []); setBudgets(bR.data || []); setSubscriptions(sR.data || []);
    setLoading(false);
  }

  async function addExpense() {
    if (!eAmt || isNaN(parseFloat(eAmt))) return;
    setSavingE(true); setEError('');
    const descVal = eDesc.trim() || eCat;
    const catNorm = eCat.toLowerCase();
    const payNorm = ePay.toLowerCase().replace(/\s+/g, '');
    const { data, error: eErr } = await supabase.from('expenses').insert({
      user_id: user.id, amount: parseFloat(eAmt), currency: 'INR',
      category: catNorm, description: descVal,
      payment_method: payNorm, expense_date: eDate
    }).select().single();
    if (eErr) { setEError(eErr.message); setSavingE(false); return; }
    if (data) {
      setExpenses(p => [data, ...p]);
      await supabase.from('audit_log').insert({ user_id: user.id, action: 'expense_added', service: 'finance', details: { amount: parseFloat(eAmt), category: catNorm } }).catch(() => {});
    }
    setEAmt(''); setEDesc(''); setEError(''); setSavingE(false); setShowAddE(false);
  }

  async function addBudget() {
    if (!bLimit || isNaN(parseFloat(bLimit))) return;
    setSavingB(true);
    const { data } = await supabase.from('budgets').upsert({ user_id: user.id, category: bCat, limit_amount: parseFloat(bLimit), alert_threshold: bThresh, month_year: thisMonth }, { onConflict: 'user_id,category,month_year' }).select().single();
    if (data) setBudgets(p => [...p.filter(b => b.category !== bCat), data]);
    setBLimit(''); setSavingB(false); setShowAddB(false);
  }

  async function addSub() {
    if (!sName || !sAmt) return;
    setSavingS(true);
    const { data } = await supabase.from('subscriptions').insert({ user_id: user.id, name: sName, amount: parseFloat(sAmt), currency: 'INR', cycle: sCycle, next_due: sDue || null, category: sCat, is_active: true }).select().single();
    if (data) { setSubscriptions(p => [...p, data]); await supabase.from('audit_log').insert({ user_id: user.id, action: 'subscription_added', service: 'finance', details: { name: sName } }); }
    setSName(''); setSAmt(''); setSavingS(false); setShowAddS(false);
  }

  async function toggleSub(id, active) {
    await supabase.from('subscriptions').update({ is_active: !active }).eq('id', id);
    setSubscriptions(p => p.map(s => s.id === id ? { ...s, is_active: !active } : s));
  }

  if (loading) return (<div style={{ minHeight:'100vh', background:'#0f0f0f', display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ color:'#6366f1' }}>Loading Finance…</div></div>);

  const totalSpent = expenses.filter(e => e.expense_date?.startsWith(thisMonth)).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const totalSubs = subscriptions.reduce((s, sub) => s + parseFloat(sub.amount || 0), 0);

  return (
    <div style={{ minHeight:'100vh', background:'#0f0f0f', color:'#fff' }}>
      <NavbarClient />
      <div style={{ maxWidth:700, margin:'0 auto', padding:'1.5rem 1rem 4rem' }}>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'0.75rem', marginBottom:'1.5rem' }}>
          <div style={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:12, padding:'1.2rem' }}>
            <div style={{ color:'#666', fontSize:'0.78rem', marginBottom:4 }}>Spent This Month</div>
            <div style={{ color:'#ef4444', fontSize:'1.6rem', fontWeight:700 }}>₹{totalSpent.toLocaleString('en-IN')}</div>
          </div>
          <div style={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:12, padding:'1.2rem' }}>
            <div style={{ color:'#666', fontSize:'0.78rem', marginBottom:4 }}>Monthly Subscriptions</div>
            <div style={{ color:'#f59e0b', fontSize:'1.6rem', fontWeight:700 }}>₹{totalSubs.toLocaleString('en-IN')}</div>
          </div>
        </div>

        <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1.5rem', background:'#1a1a1a', borderRadius:10, padding:4 }}>
          {['expenses','budgets','subscriptions'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex:1, padding:'0.55rem', borderRadius:8, border:'none', background:tab===t?'#6366f1':'transparent', color:tab===t?'#fff':'#666', fontSize:'0.85rem', fontWeight:600, cursor:'pointer', textTransform:'capitalize' }}>{t}</button>
          ))}
        </div>

        {tab === 'expenses' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
              <h2 style={{ fontSize:'1rem', fontWeight:600 }}>Expenses</h2>
              <button onClick={() => setShowAddE(!showAddE)} style={btn1}>+ Add</button>
            </div>
            {showAddE && (
              <div style={{ background:'#1a1a1a', border:'1px solid #333', borderRadius:12, padding:'1.2rem', marginBottom:'1rem' }}>
                <div style={g2}>
                  <div><label style={lbl}>Amount (₹)*</label><input style={inp} type="number" placeholder="0" value={eAmt} onChange={e => setEAmt(e.target.value)} /></div>
                  <div><label style={lbl}>Date</label><input style={inp} type="date" value={eDate} onChange={e => setEDate(e.target.value)} /></div>
                </div>
                <div style={g2}>
                  <div><label style={lbl}>Category</label><select style={inp} value={eCat} onChange={e => setECat(e.target.value)}>{EXP_CATS.map(c => <option key={c}>{c}</option>)}</select></div>
                  <div><label style={lbl}>Payment</label><select style={inp} value={ePay} onChange={e => setEPay(e.target.value)}>{PAY_METHODS.map(p => <option key={p}>{p}</option>)}</select></div>
                </div>
                <div style={{ marginBottom:'0.75rem' }}><label style={lbl}>Description</label><input style={inp} placeholder="What was this for?" value={eDesc} onChange={e => setEDesc(e.target.value)} /></div>
                {eError && <div style={{ color:'#f87171', fontSize:'0.8rem', marginBottom:'0.6rem', background:'rgba(248,113,113,0.1)', padding:'6px 10px', borderRadius:6 }}>{eError}</div>}
                <div style={{ display:'flex', gap:'0.5rem' }}>
                  <button onClick={addExpense} disabled={savingE} style={btn1}>{savingE ? 'Saving…' : 'Save'}</button>
                  <button onClick={() => { setShowAddE(false); setEError(''); }} style={btn0}>Cancel</button>
                </div>
              </div>
            )}
            {expenses.length === 0 ? <div style={{ textAlign:'center', padding:'3rem', color:'#444' }}>No expenses yet.</div> : expenses.map(e => (
              <div key={e.id} style={{ background:'#1a1a1a', border:'1px solid #222', borderRadius:10, padding:'0.9rem 1rem', marginBottom:'0.5rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ color:'#fff', fontSize:'0.9rem', fontWeight:500 }}>{e.description || e.category}</div>
                  <div style={{ color:'#555', fontSize:'0.78rem', marginTop:2 }}>{e.category} · {e.payment_method} · {e.expense_date}</div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                  <div style={{ color:'#ef4444', fontWeight:700 }}>₹{parseFloat(e.amount).toLocaleString('en-IN')}</div>
                  <button onClick={() => { supabase.from('expenses').delete().eq('id',e.id); setExpenses(p=>p.filter(x=>x.id!==e.id)); }} style={{ background:'none', border:'none', color:'#444', cursor:'pointer' }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'budgets' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
              <h2 style={{ fontSize:'1rem', fontWeight:600 }}>Monthly Budgets</h2>
              <button onClick={() => setShowAddB(!showAddB)} style={btn1}>+ Set Budget</button>
            </div>
            {showAddB && (
              <div style={{ background:'#1a1a1a', border:'1px solid #333', borderRadius:12, padding:'1.2rem', marginBottom:'1rem' }}>
                <div style={g2}>
                  <div><label style={lbl}>Category</label><select style={inp} value={bCat} onChange={e => setBCat(e.target.value)}>{EXP_CATS.map(c => <option key={c}>{c}</option>)}</select></div>
                  <div><label style={lbl}>Limit (₹)</label><input style={inp} type="number" placeholder="5000" value={bLimit} onChange={e => setBLimit(e.target.value)} /></div>
                </div>
                <div style={{ marginBottom:'0.75rem' }}>
                  <label style={lbl}>Alert at {bThresh}%</label>
                  <input type="range" min={50} max={100} value={bThresh} onChange={e => setBThresh(parseInt(e.target.value))} style={{ width:'100%', accentColor:'#6366f1' }} />
                </div>
                <div style={{ display:'flex', gap:'0.5rem' }}>
                  <button onClick={addBudget} disabled={savingB} style={btn1}>{savingB ? 'Saving…' : 'Save Budget'}</button>
                  <button onClick={() => setShowAddB(false)} style={btn0}>Cancel</button>
                </div>
              </div>
            )}
            {budgets.length === 0 ? <div style={{ textAlign:'center', padding:'3rem', color:'#444' }}>No budgets set yet.</div> : budgets.map(b => {
              const spent = expenses.filter(e => e.category === b.category && e.expense_date?.startsWith(thisMonth)).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
              const pct = Math.min(100, Math.round((spent / b.limit_amount) * 100));
              const col = pct >= b.alert_threshold ? '#ef4444' : pct >= 60 ? '#f59e0b' : '#22c55e';
              return (
                <div key={b.id} style={{ background:'#1a1a1a', border:'1px solid #222', borderRadius:10, padding:'1rem', marginBottom:'0.5rem' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                    <span style={{ color:'#fff', fontWeight:500 }}>{b.category}</span>
                    <span style={{ color:col, fontSize:'0.85rem' }}>₹{spent.toLocaleString('en-IN')} / ₹{parseFloat(b.limit_amount).toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{ background:'#111', borderRadius:4, height:6 }}>
                    <div style={{ width:`${pct}%`, background:col, height:'100%', borderRadius:4 }} />
                  </div>
                  <div style={{ color:'#555', fontSize:'0.75rem', marginTop:4 }}>{pct}% used · Alert at {b.alert_threshold}%</div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'subscriptions' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
              <h2 style={{ fontSize:'1rem', fontWeight:600 }}>Subscriptions</h2>
              <button onClick={() => setShowAddS(!showAddS)} style={btn1}>+ Add</button>
            </div>
            {showAddS && (
              <div style={{ background:'#1a1a1a', border:'1px solid #333', borderRadius:12, padding:'1.2rem', marginBottom:'1rem' }}>
                <div style={g2}>
                  <div><label style={lbl}>Service Name*</label><input style={inp} placeholder="Netflix, Hotstar…" value={sName} onChange={e => setSName(e.target.value)} /></div>
                  <div><label style={lbl}>Amount (₹)*</label><input style={inp} type="number" placeholder="499" value={sAmt} onChange={e => setSAmt(e.target.value)} /></div>
                </div>
                <div style={g2}>
                  <div><label style={lbl}>Cycle</label><select style={inp} value={sCycle} onChange={e => setSCycle(e.target.value)}>{SUB_CYCLES.map(c => <option key={c}>{c}</option>)}</select></div>
                  <div><label style={lbl}>Next Due</label><input style={inp} type="date" value={sDue} onChange={e => setSDue(e.target.value)} /></div>
                </div>
                <div style={{ marginBottom:'0.75rem' }}><label style={lbl}>Category</label><select style={inp} value={sCat} onChange={e => setSCat(e.target.value)}>{EXP_CATS.map(c => <option key={c}>{c}</option>)}</select></div>
                <div style={{ display:'flex', gap:'0.5rem' }}>
                  <button onClick={addSub} disabled={savingS} style={btn1}>{savingS ? 'Saving…' : 'Save'}</button>
                  <button onClick={() => setShowAddS(false)} style={btn0}>Cancel</button>
                </div>
              </div>
            )}
            {subscriptions.length === 0 ? <div style={{ textAlign:'center', padding:'3rem', color:'#444' }}>No subscriptions tracked yet.</div> : subscriptions.map(s => {
              const daysLeft = s.next_due ? Math.ceil((new Date(s.next_due) - new Date()) / 86400000) : null;
              const urgent = daysLeft !== null && daysLeft <= 3;
              return (
                <div key={s.id} style={{ background:'#1a1a1a', border:`1px solid ${urgent ? '#ef4444' : '#222'}`, borderRadius:10, padding:'0.9rem 1rem', marginBottom:'0.5rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ color:'#fff', fontWeight:500, fontSize:'0.9rem' }}>{s.name}</div>
                    <div style={{ color:'#555', fontSize:'0.78rem', marginTop:2 }}>
                      {s.cycle} · {s.category}
                      {daysLeft !== null && <span style={{ color: urgent ? '#ef4444' : '#666', marginLeft:8 }}>· due in {daysLeft}d</span>}
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                    <div style={{ color:'#f59e0b', fontWeight:700 }}>₹{parseFloat(s.amount).toLocaleString('en-IN')}</div>
                    <div onClick={() => toggleSub(s.id, s.is_active)} style={{ width:36, height:20, borderRadius:10, background: s.is_active ? '#6366f1' : '#333', position:'relative', cursor:'pointer' }}>
                      <div style={{ position:'absolute', top:2, left: s.is_active ? 18 : 2, width:16, height:16, borderRadius:'50%', background:'#fff', transition:'left 0.2s' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
                                 }
