'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/b/team/page.jsx
 * Three-tab system: Members · Tasks · Activity
 * Role-based access, task assignment, activity tracking.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';

const G = '#10b981';
const ROLES = ['employee','supervisor','manager','accounts','driver','helper','intern','contractor'];
const DEPTS = ['floor','delivery','accounts','kitchen','ops','sales','field','admin','hr'];
const ROLE_COLOR = {
  manager:'#6366f1', supervisor:'#8b5cf6', accounts:'#f59e0b',
  employee:'#10b981', driver:'#3b82f6', helper:'#64748b',
  intern:'#94a3b8', contractor:'#f97316',
};
const EMPTY_FORM = {
  name:'', phone:'', email:'', role:'employee', department:'',
  designation:'', employee_code:'', date_of_joining:'',
  basic_salary:'', salary_type:'monthly', emergency_contact:'', status:'active',
};
const PRIORITY_COLOR = { high:'#ef4444', medium:'#f59e0b', low:'#10b981' };

export default function TeamPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace]   = useState(null);
  const [members, setMembers]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [activeTab, setActiveTab]   = useState('members');
  const [showForm, setShowForm]     = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState(null);
  const [msg, setMsg]               = useState('');
  const [filter, setFilter]         = useState('active');
  // Tasks
  const [tasks, setTasks]           = useState([]);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskForm, setTaskForm]     = useState({ title:'', assignee_id:'', due_date:'', priority:'medium' });
  const [savingTask, setSavingTask] = useState(false);
  // Activity
  const [activity, setActivity]     = useState([]);

  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/biz-login'); return; }
    initPage();
  }, [user]);

  async function initPage() {
    setLoadError('');
    try {
      const { data: ws } = await supabase
        .from('business_workspaces').select('id,name')
        .eq('owner_user_id', user?.id).maybeSingle();
      if (ws) { setWorkspace(ws); await loadMembers(ws.id); loadTasks(ws.id); } else { setLoading(false); }
    } catch { setLoadError('Could not load data. Check your connection.'); setLoading(false); }
  }

  const loadMembers = useCallback(async (wsId) => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('business_members').select('*')
        .eq('workspace_id', wsId).order('name');
      setMembers(data || []);
    } catch { setLoadError('Could not load team data.'); }
    setLoading(false);
  }, []);

  const loadTasks = useCallback(async (wsId) => {
    const { data } = await supabase
      .from('business_tasks')
      .select('*, business_members(name)')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false }).limit(50);
    setTasks(data || []);
  }, []);

  const loadActivity = useCallback(async (wsId) => {
    const { data } = await supabase
      .from('business_activity_log').select('*')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false }).limit(50);
    setActivity(data || []);
  }, []);

  useEffect(() => {
    if (workspace && activeTab === 'activity') loadActivity(workspace.id);
  }, [activeTab, workspace, loadActivity]);

  function openAdd()    { setEditMember(null); setForm(EMPTY_FORM); setShowForm(true); }
  function openEdit(m)  {
    setEditMember(m);
    setForm({
      name: m.name||'', phone: m.phone||'', email: m.email||'',
      role: m.role||'employee', department: m.department||'',
      designation: m.designation||'', employee_code: m.employee_code||'',
      date_of_joining: m.date_of_joining||'', basic_salary: m.basic_salary||'',
      salary_type: m.salary_type||'monthly', emergency_contact: m.emergency_contact||'',
      status: m.status||'active',
    });
    setShowForm(true);
  }

  async function saveMember() {
    if (!form.name.trim() || !workspace) return;
    setSaving(true); setMsg('');
    const p = {
      workspace_id: workspace.id, name: form.name.trim(),
      phone: form.phone.trim()||null, email: form.email.trim()||null,
      role: form.role, department: form.department||null,
      designation: form.designation.trim()||null,
      employee_code: form.employee_code.trim()||null,
      date_of_joining: form.date_of_joining||null,
      basic_salary: form.basic_salary ? parseFloat(form.basic_salary) : null,
      salary_type: form.salary_type,
      emergency_contact: form.emergency_contact.trim()||null,
      status: form.status,
    };
    if (editMember) {
      await supabase.from('business_members').update(p).eq('id', editMember.id);
      setMsg('Member updated ✓');
    } else {
      await supabase.from('business_members').insert(p);
      setMsg('Member added ✓');
    }
    setSaving(false); setShowForm(false);
    loadMembers(workspace.id);
    setTimeout(() => setMsg(''), 3000);
  }

  async function deleteMember(id) {
    if (!confirm('Remove this team member?')) return;
    setDeleting(id);
    await supabase.from('business_members').delete().eq('id', id);
    setDeleting(null);
    loadMembers(workspace.id);
  }

  async function saveTask() {
    if (!taskForm.title.trim() || !workspace) return;
    setSavingTask(true);
    await supabase.from('business_tasks').insert({
      workspace_id: workspace.id,
      title: taskForm.title.trim(),
      assignee_id: taskForm.assignee_id||null,
      due_date: taskForm.due_date||null,
      priority: taskForm.priority,
      status: 'open',
    });
    setTaskForm({ title:'', assignee_id:'', due_date:'', priority:'medium' });
    setShowTaskForm(false); setSavingTask(false);
    loadTasks(workspace.id);
  }

  async function updateTaskStatus(id, status) {
    await supabase.from('business_tasks').update({ status }).eq('id', id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  }

  const filtered = members.filter(m => filter === 'all' || m.status === filter);

  const inp = {
    width:'100%', background:'var(--surface)', border:'1px solid var(--border)',
    borderRadius:10, padding:'10px 14px', color:'var(--text)', fontSize:14,
    outline:'none', boxSizing:'border-box', fontFamily:'inherit',
  };

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg)',
      paddingTop:56, paddingBottom:'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth:520, margin:'0 auto', padding:'20px 16px' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div>
            <div style={{ fontSize:20, fontWeight:800, color:'var(--text)' }}>Team</div>
            <div style={{ fontSize:12, color:'var(--text-subtle)', marginTop:2 }}>
              {workspace?.name} · {members.filter(m=>m.status==='active').length} active
            </div>
          </div>
          {activeTab === 'members' && (
            <button onClick={openAdd}
              style={{ padding:'8px 16px', borderRadius:8, border:'none',
                background:G, color:'#fff', fontSize:13, fontWeight:700,
                cursor:'pointer', fontFamily:'inherit' }}>+ Add</button>
          )}
          {activeTab === 'tasks' && (
            <button onClick={() => setShowTaskForm(true)}
              style={{ padding:'8px 16px', borderRadius:8, border:'none',
                background:'#6366f1', color:'#fff', fontSize:13, fontWeight:700,
                cursor:'pointer', fontFamily:'inherit' }}>+ Task</button>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:4, marginBottom:16,
          background:'var(--surface)', borderRadius:10, padding:4, border:'1px solid var(--border)' }}>
          {[['members','👥 Members'],['tasks','✅ Tasks'],['activity','📊 Activity']].map(([k,l]) => (
            <button key={k} onClick={() => setActiveTab(k)}
              style={{ flex:1, padding:'8px', borderRadius:7, border:'none',
                background: activeTab===k
                  ? (k==='members' ? G : k==='tasks' ? '#6366f1' : '#f59e0b')
                  : 'transparent',
                color: activeTab===k ? '#fff' : 'var(--text-muted)',
                fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              {l}
            </button>
          ))}
        </div>

        {msg && (
          <div style={{ background:`${G}15`, border:`1px solid ${G}40`,
            borderRadius:8, padding:'8px 12px', fontSize:13, color:G, marginBottom:12 }}>
            ✓ {msg}
          </div>
        )}

        {/* ── MEMBERS ── */}
        {activeTab === 'members' && (
          <>
            <div style={{ display:'flex', gap:6, marginBottom:12 }}>
              {['active','inactive','all'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{ padding:'4px 12px', borderRadius:20, border:'1px solid',
                    borderColor: filter===f ? G : 'var(--border)',
                    background: filter===f ? `${G}18` : 'transparent',
                    color: filter===f ? G : 'var(--text-muted)',
                    fontSize:11, cursor:'pointer', fontFamily:'inherit', textTransform:'capitalize' }}>
                  {f}
                </button>
              ))}
            </div>

            {loadError ? (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, padding:40 }}>
                <div style={{ color:'#ef4444', fontSize:13 }}>{loadError}</div>
                <button onClick={initPage} style={{ padding:'8px 16px', borderRadius:8, border:'none', background:G, color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer' }}>Retry</button>
              </div>
            ) : loading ? (
              <div style={{ textAlign:'center', padding:'40px 0' }}>
                <div className="qk-spinner" style={{ margin:'0 auto 12px' }} />
                <div style={{ color:'var(--text-subtle)', fontSize:13 }}>Loading team…</div>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign:'center', padding:'48px 20px' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>👥</div>
                <div style={{ fontSize:15, fontWeight:700, color:'var(--text)', marginBottom:6 }}>
                  No team members yet
                </div>
                <div style={{ fontSize:13, color:'var(--text-muted)' }}>
                  Tap + Add to add your first employee
                </div>
              </div>
            ) : filtered.map(m => (
              <div key={m.id} style={{ background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:14, padding:'14px', marginBottom:10 }}>
                <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                  <div style={{ width:42, height:42, borderRadius:'50%', flexShrink:0,
                    background:`linear-gradient(135deg,${ROLE_COLOR[m.role]||G},${ROLE_COLOR[m.role]||G}88)`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:16, fontWeight:800, color:'#fff' }}>
                    {(m.name||'?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                      <div style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>{m.name}</div>
                      <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:999,
                        background:`${ROLE_COLOR[m.role]||'#64748b'}20`,
                        color:ROLE_COLOR[m.role]||'#64748b',
                        border:`1px solid ${ROLE_COLOR[m.role]||'#64748b'}30`,
                        textTransform:'uppercase', letterSpacing:'0.06em' }}>
                        {m.role}
                      </span>
                    </div>
                    {m.designation && (
                      <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:1 }}>{m.designation}</div>
                    )}
                    <div style={{ display:'flex', gap:12, marginTop:5, flexWrap:'wrap' }}>
                      {m.phone && (
                        <a href={`tel:${m.phone}`}
                          style={{ fontSize:11, color:G, textDecoration:'none' }}>
                          📞 {m.phone}
                        </a>
                      )}
                      {m.department && (
                        <span style={{ fontSize:11, color:'var(--text-subtle)' }}>🏢 {m.department}</span>
                      )}
                      {m.basic_salary && (
                        <span style={{ fontSize:11, color:'var(--text-subtle)' }}>
                          ₹{Number(m.basic_salary).toLocaleString('en-IN')}/{m.salary_type==='monthly'?'mo':'day'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', gap:6, marginTop:10, paddingTop:8,
                  borderTop:'1px solid var(--border)' }}>
                  <button onClick={() => openEdit(m)}
                    style={{ flex:1, padding:'6px', borderRadius:8, border:'1px solid var(--border)',
                      background:'transparent', color:'var(--text-muted)', fontSize:12,
                      cursor:'pointer', fontFamily:'inherit' }}>✏️ Edit</button>
                  {m.phone && (
                    <a href={`https://wa.me/91${m.phone.replace(/\D/g,'')}`} target="_blank" rel="noopener"
                      style={{ flex:1, padding:'6px', borderRadius:8, border:`1px solid ${G}40`,
                        background:`${G}10`, color:G, fontSize:12, textDecoration:'none',
                        display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                      💬 WhatsApp
                    </a>
                  )}
                  <button onClick={() => deleteMember(m.id)} disabled={deleting===m.id}
                    style={{ width:34, padding:'6px', borderRadius:8,
                      border:'1px solid rgba(239,68,68,0.25)',
                      background:'rgba(239,68,68,0.06)', color:'#ef4444',
                      fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
                    {deleting===m.id?'…':'🗑'}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── TASKS ── */}
        {activeTab === 'tasks' && (
          <>
            {showTaskForm && (
              <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:14, padding:16, marginBottom:14 }}>
                <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>New Task</div>
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  <input value={taskForm.title}
                    onChange={e => setTaskForm(p=>({...p,title:e.target.value}))}
                    placeholder="Task description…" style={inp} />
                  <select value={taskForm.assignee_id}
                    onChange={e => setTaskForm(p=>({...p,assignee_id:e.target.value}))} style={inp}>
                    <option value="">Assign to…</option>
                    {members.filter(m=>m.status==='active').map(m => (
                      <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                    ))}
                  </select>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <input type="date" value={taskForm.due_date}
                      onChange={e => setTaskForm(p=>({...p,due_date:e.target.value}))} style={inp} />
                    <select value={taskForm.priority}
                      onChange={e => setTaskForm(p=>({...p,priority:e.target.value}))} style={inp}>
                      <option value="high">🔴 High</option>
                      <option value="medium">🟡 Medium</option>
                      <option value="low">🟢 Low</option>
                    </select>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={saveTask} disabled={savingTask||!taskForm.title.trim()}
                      style={{ flex:1, padding:'10px', borderRadius:8, border:'none',
                        background:'#6366f1', color:'#fff', fontSize:13, fontWeight:700,
                        cursor:'pointer', fontFamily:'inherit' }}>
                      {savingTask?'Saving…':'Assign Task'}
                    </button>
                    <button onClick={() => setShowTaskForm(false)}
                      style={{ padding:'10px 14px', borderRadius:8,
                        border:'1px solid var(--border)', background:'transparent',
                        color:'var(--text-muted)', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {tasks.length === 0 ? (
              <div style={{ textAlign:'center', padding:'48px 0' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
                <div style={{ fontSize:15, fontWeight:700, color:'var(--text)', marginBottom:6 }}>
                  No tasks yet
                </div>
                <div style={{ fontSize:13, color:'var(--text-muted)' }}>
                  Assign tasks to your team members
                </div>
              </div>
            ) : tasks.map(t => (
              <div key={t.id} style={{ background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:12, padding:'12px 14px', marginBottom:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between',
                  alignItems:'flex-start', gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--text)',
                      textDecoration: t.status==='done' ? 'line-through' : 'none',
                      opacity: t.status==='done' ? 0.5 : 1 }}>
                      {t.title}
                    </div>
                    {t.business_members?.name && (
                      <div style={{ fontSize:11, color:'var(--text-subtle)', marginTop:3 }}>
                        👤 {t.business_members.name}
                        {t.due_date && ` · 📅 ${new Date(t.due_date).toLocaleDateString('en-IN')}`}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize:8, fontWeight:700, padding:'2px 6px', borderRadius:999,
                    background:`${PRIORITY_COLOR[t.priority]||'#64748b'}20`,
                    color:PRIORITY_COLOR[t.priority]||'#64748b',
                    textTransform:'uppercase', flexShrink:0, alignSelf:'flex-start' }}>
                    {t.priority}
                  </span>
                </div>
                <div style={{ display:'flex', gap:4, marginTop:8 }}>
                  {['open','in_progress','done'].map(s => (
                    <button key={s} onClick={() => updateTaskStatus(t.id, s)}
                      style={{ flex:1, padding:'4px', borderRadius:6,
                        border:`1px solid ${t.status===s?'#6366f1':'var(--border)'}`,
                        background: t.status===s ? 'rgba(99,102,241,0.15)' : 'transparent',
                        color: t.status===s ? '#818cf8' : 'var(--text-subtle)',
                        fontSize:10, fontWeight: t.status===s ? 700 : 400,
                        cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                      {s==='in_progress'?'In Progress':s==='done'?'✓ Done':'Open'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── ACTIVITY ── */}
        {activeTab === 'activity' && (
          activity.length === 0 ? (
            <div style={{ textAlign:'center', padding:'48px 0' }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📊</div>
              <div style={{ fontSize:15, fontWeight:700, color:'var(--text)', marginBottom:6 }}>
                No activity yet
              </div>
              <div style={{ fontSize:13, color:'var(--text-muted)' }}>
                Team actions will appear here
              </div>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {activity.map((a, i) => (
                <div key={a.id||i} style={{ background:'var(--surface)', border:'1px solid var(--border)',
                  borderRadius:10, padding:'10px 14px' }}>
                  <div style={{ fontSize:13, color:'var(--text)' }}>{a.description||a.action}</div>
                  <div style={{ fontSize:11, color:'var(--text-subtle)', marginTop:3 }}>
                    {a.member_name||''} · {a.created_at?new Date(a.created_at).toLocaleString('en-IN'):''}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── MEMBER FORM MODAL ── */}
      {showForm && (
        <div style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.7)',
          backdropFilter:'blur(4px)', display:'flex', alignItems:'flex-end', justifyContent:'center' }}
          onClick={e => e.target===e.currentTarget && setShowForm(false)}>
          <div style={{ background:'var(--bg)', border:'1px solid var(--border)',
            borderRadius:'20px 20px 0 0', padding:'24px 20px 40px',
            width:'100%', maxWidth:520, maxHeight:'90dvh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between',
              alignItems:'center', marginBottom:18 }}>
              <div style={{ fontSize:16, fontWeight:800 }}>
                {editMember ? 'Edit Member' : 'Add Team Member'}
              </div>
              <button onClick={() => setShowForm(false)}
                style={{ background:'none', border:'none', color:'var(--text-subtle)',
                  cursor:'pointer', fontSize:22 }}>×</button>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {[
                { key:'name',              label:'Full Name *',      type:'text',   ph:'Raju Kumar' },
                { key:'phone',             label:'Phone',            type:'tel',    ph:'+91 98765 43210' },
                { key:'email',             label:'Email',            type:'email',  ph:'raju@example.com' },
                { key:'designation',       label:'Designation',      type:'text',   ph:'Sales Executive' },
                { key:'employee_code',     label:'Employee Code',    type:'text',   ph:'EMP-001' },
                { key:'date_of_joining',   label:'Date of Joining',  type:'date',   ph:'' },
                { key:'basic_salary',      label:'Basic Salary (₹)', type:'number', ph:'15000' },
                { key:'emergency_contact', label:'Emergency Contact',type:'tel',    ph:'+91 99999 00000' },
              ].map(({ key, label, type, ph }) => (
                <div key={key}>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                    display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    {label}
                  </label>
                  <input type={type} value={form[key]}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={ph} style={inp} />
                </div>
              ))}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                    display:'block', marginBottom:4 }}>ROLE</label>
                  <select value={form.role}
                    onChange={e => setForm(p=>({...p,role:e.target.value}))} style={inp}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                    display:'block', marginBottom:4 }}>DEPARTMENT</label>
                  <select value={form.department}
                    onChange={e => setForm(p=>({...p,department:e.target.value}))} style={inp}>
                    <option value="">Select…</option>
                    {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                    display:'block', marginBottom:4 }}>SALARY TYPE</label>
                  <select value={form.salary_type}
                    onChange={e => setForm(p=>({...p,salary_type:e.target.value}))} style={inp}>
                    <option value="monthly">Monthly</option>
                    <option value="daily">Daily</option>
                    <option value="hourly">Hourly</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                    display:'block', marginBottom:4 }}>STATUS</label>
                  <select value={form.status}
                    onChange={e => setForm(p=>({...p,status:e.target.value}))} style={inp}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="on_leave">On Leave</option>
                  </select>
                </div>
              </div>
              <button onClick={saveMember} disabled={saving||!form.name.trim()}
                style={{ width:'100%', padding:'14px', borderRadius:12, border:'none',
                  background: form.name.trim() ? G : 'var(--surface-hover)',
                  color: form.name.trim() ? '#fff' : 'var(--text-subtle)',
                  fontSize:15, fontWeight:700,
                  cursor: form.name.trim() ? 'pointer' : 'not-allowed',
                  fontFamily:'inherit' }}>
                {saving ? 'Saving…' : editMember ? 'Save Changes' : 'Add Member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
