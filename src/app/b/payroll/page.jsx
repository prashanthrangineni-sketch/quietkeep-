'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
// src/app/b/payroll/page.jsx — Payroll engine with attendance-based calculation

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';
const G = '#10b981';

function calcNetSalary({ basic_salary, days_present, working_days, daily_wage, salary_type }) {
  if (salary_type === 'daily') return (parseFloat(daily_wage) || 0) * (parseInt(days_present) || 0);
  const perDay = (parseFloat(basic_salary) || 0) / (parseInt(working_days) || 26);
  const earned = perDay * (parseInt(days_present) || 0);
  const pf = earned > 15000 ? earned * 0.12 : 0;
  const esic = earned <= 21000 ? earned * 0.0075 : 0;
  return Math.round(earned - pf - esic);
}

export default function PayrollPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [records, setRecords] = useState({});
  const [attendanceSummary, setAttendanceSummary] = useState({});
  const [period, setPeriod] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [msg, setMsg] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
            const { data: ws } = await supabase.from('business_workspaces').select('id').eq('owner_user_id', user?.id).maybeSingle();
            if (ws) { setWorkspace(ws); loadData(ws.id, period); }
    })();
  }, [user]);

  const loadData = useCallback(async (wsId, per) => {
    setLoading(true);
    const [yr, mo] = per.split('-').map(Number);
    const start = `${yr}-${String(mo).padStart(2,'0')}-01`;
    const end = new Date(yr, mo, 0).toISOString().split('T')[0];

    const [membersRes, payrollRes, attRes] = await Promise.all([
      supabase.from('business_members').select('*').eq('workspace_id', wsId).eq('status', 'active').order('name'),
      supabase.from('payroll_records').select('*').eq('workspace_id', wsId).eq('pay_period_start', start),
      supabase.from('attendance_logs').select('member_id,status').eq('workspace_id', wsId).gte('log_date', start).lte('log_date', end),
    ]);

    const attMap = {};
    for (const a of (attRes.data || [])) {
      if (!attMap[a.member_id]) attMap[a.member_id] = { present: 0, absent: 0, half: 0 };
      if (a.status === 'present') attMap[a.member_id].present++;
      else if (a.status === 'absent') attMap[a.member_id].absent++;
      else if (a.status === 'half_day') attMap[a.member_id].half++;
    }
    setAttendanceSummary(attMap);

    const recMap = {};
    for (const r of (payrollRes.data || [])) recMap[r.member_id] = r;
    setRecords(recMap);
    setMembers(membersRes.data || []);
    setLoading(false);
  }, []);

  async function generatePayroll(member) {
    if (!workspace) return;
    setSaving(member.id);
    const [yr, mo] = period.split('-').map(Number);
    const start = `${yr}-${String(mo).padStart(2,'0')}-01`;
    const end = new Date(yr, mo, 0).toISOString().split('T')[0];
    const att = attendanceSummary[member.id] || { present: 0, absent: 0, half: 0 };
    const days_present = att.present + att.half * 0.5;
    const basic = parseFloat(member.basic_salary) || 0;
    const hra = basic * 0.4;
    const da = basic * 0.1;
    const gross = basic + hra + da;
    const perDay = gross / 26;
    const earned = perDay * days_present;
    const pf = earned > 15000 ? earned * 0.12 : 0;
    const esic = earned <= 21000 ? earned * 0.0075 : 0;
    const net = Math.round(earned - pf - esic);

    const payload = {
      workspace_id: workspace.id, member_id: member.id,
      pay_period_start: start, pay_period_end: end,
      working_days: 26, days_present: Math.floor(days_present),
      days_absent: att.absent, days_half: att.half,
      basic_salary: basic, hra, da, gross_salary: gross,
      pf_employee: Math.round(pf), esic_employee: Math.round(esic),
      net_salary: net, payment_status: 'pending',
    };
    await supabase.from('payroll_records').upsert(payload, { onConflict: 'workspace_id,member_id,pay_period_start' });
    setRecords(prev => ({ ...prev, [member.id]: payload }));
    setSaving(null);
    setMsg(`✓ Payslip generated for ${member.name}`);
    setTimeout(() => setMsg(''), 3000);
  }

  async function markPaid(memberId) {
    const rec = records[memberId];
    if (!rec) return;
    await supabase.from('payroll_records').update({ payment_status: 'paid', payment_date: new Date().toISOString().split('T')[0] }).eq('workspace_id', workspace.id).eq('member_id', memberId).eq('pay_period_start', rec.pay_period_start);
    setRecords(prev => ({ ...prev, [memberId]: { ...prev[memberId], payment_status: 'paid' } }));
  }

  const totalPayable = Object.values(records).filter(r => r.payment_status === 'pending').reduce((s,r) => s + (r.net_salary || 0), 0);
  const totalPaid = Object.values(records).filter(r => r.payment_status === 'paid').reduce((s,r) => s + (r.net_salary || 0), 0);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div><h1 className="qk-h1">💳 Payroll</h1><p className="qk-desc">Salary calculation from attendance</p></div>
          <input type="month" value={period} onChange={e => { setPeriod(e.target.value); workspace && loadData(workspace.id, e.target.value); }}
            className="qk-input" style={{ width: 'auto', fontSize: 12, padding: '6px 10px' }} />
        </div>

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div className="qk-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f59e0b' }}>₹{totalPayable.toLocaleString('en-IN')}</div>
            <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Pending payroll</div>
          </div>
          <div className="qk-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: G }}>₹{totalPaid.toLocaleString('en-IN')}</div>
            <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Paid this month</div>
          </div>
        </div>

        {msg && <div style={{ color: G, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{msg}</div>}

        {/* Generate all button */}
        <button onClick={async () => { for (const m of members) await generatePayroll(m); }}
          className="qk-btn qk-btn-sm" style={{ width: '100%', justifyContent: 'center', marginBottom: 14, background: `rgba(16,185,129,0.1)`, border: `1px solid ${G}40`, color: G }}>
          ⚡ Generate All Payslips
        </button>

        {loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="qk-spinner" /></div>
        : members.length === 0 ? (
          <div className="qk-empty"><div className="qk-empty-icon">💳</div><div className="qk-empty-title">No staff added</div><div className="qk-empty-sub">Add team members to process payroll</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {members.map(m => {
              const rec = records[m.id];
              const att = attendanceSummary[m.id] || { present: 0, absent: 0, half: 0 };
              const isSelected = selected === m.id;
              return (
                <div key={m.id} className="qk-card" style={{ overflow: 'hidden', borderColor: rec?.payment_status === 'paid' ? `${G}40` : 'var(--border)' }}>
                  <div style={{ padding: '13px 14px', display: 'flex', gap: 12, alignItems: 'center' }} onClick={() => setSelected(isSelected ? null : m.id)}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--primary-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--primary)', flexShrink: 0 }}>
                      {m.name[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                        P:{att.present} A:{att.absent} ½:{att.half} · ₹{(parseFloat(m.basic_salary)||0).toLocaleString('en-IN')}/mo
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {rec ? (
                        <>
                          <div style={{ fontSize: 15, fontWeight: 800, color: rec.payment_status === 'paid' ? G : '#f59e0b' }}>₹{(rec.net_salary||0).toLocaleString('en-IN')}</div>
                          <div style={{ fontSize: 10, color: rec.payment_status === 'paid' ? G : '#f59e0b', textTransform: 'uppercase' }}>{rec.payment_status}</div>
                        </>
                      ) : <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Not generated</div>}
                    </div>
                  </div>
                  {isSelected && (
                    <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>
                      {rec && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '10px 0', fontSize: 12 }}>
                          {[
                            ['Basic', rec.basic_salary], ['HRA', rec.hra], ['DA', rec.da], ['Gross', rec.gross_salary],
                            ['PF (12%)', rec.pf_employee], ['ESIC', rec.esic_employee], ['Net Salary', rec.net_salary],
                          ].map(([k,v]) => (
                            <div key={k} style={{ background: 'var(--surface-hover)', padding: '6px 10px', borderRadius: 6 }}>
                              <div style={{ color: 'var(--text-subtle)', fontSize: 10 }}>{k}</div>
                              <div style={{ color: 'var(--text)', fontWeight: 700 }}>₹{(parseFloat(v)||0).toLocaleString('en-IN')}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button onClick={() => generatePayroll(m)} disabled={saving === m.id} className="qk-btn qk-btn-ghost qk-btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                          {saving === m.id ? '⏳' : '⚡ Generate'}
                        </button>
                        {rec && rec.payment_status === 'pending' && (
                          <button onClick={() => markPaid(m.id)} className="qk-btn qk-btn-sm" style={{ flex: 1, justifyContent: 'center', background: G, color: '#fff', border: 'none' }}>
                            ✓ Mark Paid
                          </button>
                        )}
                        {rec && (
                          <button onClick={() => {
                            const wa = `https://wa.me/${m.phone?.replace(/[^0-9]/g,'')}?text=${encodeURIComponent(`Dear ${m.name}, your payslip for ${period}:\nDays Present: ${rec.days_present}\nGross: \u20b9${rec.gross_salary}\nPF: \u20b9${rec.pf_employee}\nESIC: \u20b9${rec.esic_employee}\nNet Salary: \u20b9${rec.net_salary}\n\n- ${workspace?.name || 'Your Company'}`)}`;
                            window.open(wa, '_blank');
                          }} className="qk-btn qk-btn-sm" style={{ flex: 1, justifyContent: 'center', background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)', color: '#25D366' }}>
                            📲 WhatsApp
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
                      }
