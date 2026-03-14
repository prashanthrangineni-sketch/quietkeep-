'use client';
import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';

const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const BILL_TYPES = [
  { value:'electricity',label:'Electricity',emoji:'⚡',color:'#f59e0b',dueDay:15 },
  { value:'tax',label:'Income Tax',emoji:'🏛️',color:'#ef4444',recurrence:'yearly' },
  { value:'fastag',label:'FASTag',emoji:'🚗',color:'#6366f1',recurrence:'monthly' },
  { value:'water',label:'Water',emoji:'💧',color:'#3b82f6',dueDay:10 },
  { value:'gas',label:'Gas/LPG',emoji:'🔥',color:'#f97316',recurrence:'monthly' },
  { value:'internet',label:'Internet',emoji:'📶',color:'#8b5cf6',dueDay:5 },
  { value:'emi',label:'EMI/Loan',emoji:'🏦',color:'#10b981',dueDay:1 },
  { value:'insurance',label:'Insurance',emoji:'🛡️',color:'#06b6d4',recurrence:'yearly' },
  { value:'rent',label:'Rent',emoji:'🏠',color:'#ec4899',dueDay:1 },
  { value:'subscription',label:'Subscription',emoji:'📦',color:'#a78bfa',dueDay:1 },
  { value:'other',label:'Other',emoji:'📋',color:'#64748b',dueDay:1 },
];

function daysUntilDue(bill) {
  const now = new Date();
  if (bill.due_date) return Math.ceil((new Date(bill.due_date) - now) / 86400000);
  if (bill.due_day) {
    const d = new Date(now.getFullYear(), now.getMonth(), bill.due_day);
    if (d < now) d.setMonth(d.getMonth() + 1);
    return Math.ceil((d - now) / 86400000);
  }
  return null;
}

const EMPTY = { bill_type:'electricity', title:'', amount:'', due_day:'15', due_date:'', recurrence:'monthly', remind_days_before:3 };

export default function BillsPage() {
  const [user, setUser] = useState(null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const inp = { width:'100%', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, color:'#e2e8f0', padding:'11px 14px', fontSize:14, fontFamily:'inherit', outline:'none', boxSizing:'border-box' };

  useEffect(() => {
    supabase.auth.getUser().then(({ data:{ user } }) => {
      if (!user) { window.location.href='/login'; return; }
      setUser(user); loadBills(user.id);
    });
  }, []);

  async function loadBills(uid) {
    const { data } = await supabase.from('bill_reminders').select('*').eq('user_id',uid).eq('is_active',true).order('created_at',{ ascending:false });
    setBills(data||[]); setLoading(false);
  }

  async function saveBill() {
    if (!form.title.trim()) return setErr('Title required');
    setSaving(true); setErr('');
    const { data, error } = await supabase.from('bill_reminders').insert({
      user_id:user.id, bill_type:form.bill_type, title:form.title.trim(),
      amount:form.amount?parseFloat(form.amount):null,
      due_day:form.due_day?parseInt(form.due_day):null,
      due_date:form.due_date||null, recurrence:form.recurrence,
      remind_days_before:parseInt(form.remind_days_before)||3,
    }).select().single();
    if (error) setErr(error.message);
    else if (data) { setBills(p=>[data,...p]); setShowAdd(false); setForm(EMPTY); }
    setSaving(false);
  }

  async function markPaid(id) {
    const today = new Date().toISOString().split('T')[0];
    await supabase.from('bill_reminders').update({ last_paid_at:today }).eq('id',id);
    setBills(p=>p.map(b=>b.id===id?{...b,last_paid_at:today}:b));
  }

  async function deleteBill(id) {
    await supabase.from('bill_reminders').update({ is_active:false }).eq('id',id);
    setBills(p=>p.filter(b=>b.id!==id));
  }

  const upcoming = bills.filter(b=>{ const d=daysUntilDue(b); return d!==null&&d>=0&&d<=7; });

  return (
    <div style={{ minHeight:'100dvh', background:'#0d1117', color:'#e2e8f0', fontFamily:'system-ui,sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth:480, margin:'0 auto', padding:'6rem 16px 6rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div>
            <h1 style={{ fontSize:22, fontWeight:800, marginBottom:4 }}>💳 Bill Reminders</h1>
            <div style={{ fontSize:13, color:'#64748b' }}>Tax · FASTag · Electricity · EMIs</div>
          </div>
          <button onClick={()=>{ setShowAdd(!showAdd); setErr(''); }} style={{ padding:'8px 16px', borderRadius:10, border:'none', background:'#6366f1', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            {showAdd?'Cancel':'+ Add'}
          </button>
        </div>

        {upcoming.length>0&&(
          <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:12, padding:'12px 16px', marginBottom:16, fontSize:13, color:'#fca5a5' }}>
            ⚠️ {upcoming.length} bill{upcoming.length>1?'s':''} due within 7 days
          </div>
        )}

        {showAdd&&(
          <div style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:14, padding:16, marginBottom:20 }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#e2e8f0', marginBottom:14 }}>New Bill</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginBottom:14 }}>
              {BILL_TYPES.map(t=>(
                <button key={t.value} onClick={()=>setForm(f=>({...f,bill_type:t.value,recurrence:t.recurrence||f.recurrence,due_day:t.dueDay||f.due_day}))}
                  style={{ padding:'8px 4px', borderRadius:8, border:`1px solid ${form.bill_type===t.value?t.color:'rgba(255,255,255,0.08)'}`, background:form.bill_type===t.value?t.color+'22':'transparent', color:form.bill_type===t.value?t.color:'#64748b', fontSize:10, cursor:'pointer', fontFamily:'inherit', textAlign:'center' }}>
                  <div style={{ fontSize:18 }}>{t.emoji}</div><div style={{ fontWeight:600 }}>{t.label}</div>
                </button>
              ))}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <input style={inp} placeholder="Bill title e.g. APSPDCL Electricity" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} />
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <input style={inp} placeholder="Amount ₹" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} />
                <input style={inp} placeholder="Due day (1-31)" type="number" min="1" max="31" value={form.due_day} onChange={e=>setForm(f=>({...f,due_day:e.target.value}))} />
              </div>
              <input style={inp} placeholder="Specific date (for Tax)" type="date" value={form.due_date} onChange={e=>setForm(f=>({...f,due_date:e.target.value}))} />
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <select style={inp} value={form.recurrence} onChange={e=>setForm(f=>({...f,recurrence:e.target.value}))}>
                  {['monthly','quarterly','yearly','one_time'].map(r=><option key={r}>{r}</option>)}
                </select>
                <input style={inp} placeholder="Remind X days before" type="number" value={form.remind_days_before} onChange={e=>setForm(f=>({...f,remind_days_before:e.target.value}))} />
              </div>
            </div>
            {err&&<div style={{ color:'#ef4444', fontSize:12, marginTop:8 }}>⚠️ {err}</div>}
            <button onClick={saveBill} disabled={saving} style={{ width:'100%', marginTop:14, padding:12, borderRadius:10, border:'none', background:'linear-gradient(135deg,#6366f1,#818cf8)', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
              {saving?'Saving…':'Add Bill Reminder'}
            </button>
          </div>
        )}

        {loading ? <div style={{ textAlign:'center', padding:'40px', color:'#64748b' }}>Loading…</div>
          : bills.length===0 ? (
            <div style={{ textAlign:'center', padding:'40px 20px', color:'#475569', fontSize:13 }}>
              <div style={{ fontSize:40, marginBottom:12 }}>💳</div>
              No bills yet. Add Tax, FASTag, electricity and more.
            </div>
          ) : bills.map(bill=>{
            const t=BILL_TYPES.find(x=>x.value===bill.bill_type)||BILL_TYPES[10];
            const days=daysUntilDue(bill);
            const urgent=days!==null&&days<=3, soon=days!==null&&days<=7;
            return (
              <div key={bill.id} style={{ background:'rgba(255,255,255,0.04)', border:`1px solid ${urgent?'rgba(239,68,68,0.3)':soon?'rgba(245,158,11,0.25)':'rgba(255,255,255,0.08)'}`, borderRadius:12, padding:'14px 16px', marginBottom:8, display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ fontSize:28 }}>{t.emoji}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'#e2e8f0' }}>{bill.title}</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', fontSize:12, color:'#64748b', marginTop:3 }}>
                    {bill.amount&&<span style={{ color:'#10b981', fontWeight:600 }}>₹{Number(bill.amount).toLocaleString('en-IN')}</span>}
                    <span>{bill.recurrence}</span>
                    {days!==null&&<span style={{ color:urgent?'#ef4444':soon?'#f59e0b':'#10b981', fontWeight:600 }}>{days===0?'Due today':days<0?`${Math.abs(days)}d overdue`:`${days}d left`}</span>}
                  </div>
                  {bill.last_paid_at&&<div style={{ fontSize:11, color:'#475569', marginTop:2 }}>Paid: {bill.last_paid_at}</div>}
                </div>
                <div style={{ display:'flex', gap:5 }}>
                  <button onClick={()=>markPaid(bill.id)} style={{ padding:'5px 9px', borderRadius:6, border:'1px solid rgba(16,185,129,0.3)', background:'rgba(16,185,129,0.1)', color:'#10b981', fontSize:11, cursor:'pointer' }}>✓</button>
                  <button onClick={()=>deleteBill(bill.id)} style={{ padding:'5px 8px', borderRadius:6, border:'1px solid rgba(239,68,68,0.25)', background:'transparent', color:'#ef4444', fontSize:11, cursor:'pointer' }}>✕</button>
                </div>
              </div>
            );
          })
        }
      </div>
    </div>
  );
}
