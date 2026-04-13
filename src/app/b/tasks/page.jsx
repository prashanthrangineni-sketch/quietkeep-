'use client';
import { useRouter } from 'next/navigation';
import { apiGet } from '@/lib/safeFetch';
import { useAuth } from '@/lib/context/auth';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';
const G = '#10b981';
const PRIORITIES = { low: '#64748b', medium: '#f59e0b', high: '#ef4444', urgent: '#dc2626' };

export default function TasksPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title:'', description:'', priority:'medium', assigned_to_member_id:'', due_date:'' });
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState({});
  const [tab, setTab] = useState('todo');

  function canDo(resource, action) {
    if (!permissions || Object.keys(permissions).length === 0) return true;
    return permissions?.[resource]?.[action] === true;
  }

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) { router.replace('/biz-login'); return; }
    (async () => {
            const { data: ws } = await supabase.from('business_workspaces').select('id').eq('owner_user_id', user?.id).maybeSingle();
            if (ws) { setWorkspace(ws); loadData(ws.id); }
    })();
  }, [user]);

  const loadData = useCallback(async (wsId) => {
    setLoading(true);
    const [tasksRes, membersRes] = await Promise.all([
      supabase.from('business_tasks').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }),
      supabase.from('business_members').select('id,name').eq('workspace_id', wsId).eq('status', 'active'),
    ]);
    setTasks(tasksRes.data || []);
    setMembers(membersRes.data || []);
    setLoading(false);
  }, []);

  async function saveTask() {
    if (!form.title || !workspace) return;
    if (!canDo('tasks', 'create')) { alert('You do not have permission to create tasks'); return; }
    setSaving(true);
    await supabase.from('business_tasks').insert({ workspace_id: workspace.id, ...form, assigned_to_member_id: form.assigned_to_member_id || null, due_date: form.due_date || null });
    setSaving(false); setShowForm(false);
    setForm({ title:'', description:'', priority:'medium', assigned_to_member_id:'', due_date:'' });
    loadData(workspace.id);
  }

  async function updateStatus(id, status) {
    if (!canDo('tasks', 'update')) { alert('You do not have permission to update tasks'); return; }
    await supabase.from('business_tasks').update({ status, completed_at: status === 'done' ? new Date().toISOString() : null }).eq('id', id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  }


  async function deleteTask(id) {
    if (!canDo('tasks', 'delete')) { alert('You do not have permission to delete tasks'); return; }
    if (!window.confirm('Delete this task?')) return;
    await supabase.from('business_tasks').delete().eq('id', id);
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  const filtered = tasks.filter(t => t.status === tab);
  const counts = { todo: tasks.filter(t => t.status === 'todo').length, in_progress: tasks.filter(t => t.status === 'in_progress').length, done: tasks.filter(t => t.status === 'done').length };

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px) + 16px)' }}>
      <BizNavbar />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div><h1 className="qk-h1">✅ Tasks</h1><p className="qk-desc">Team task board — assign, track, complete</p></div>
          <button onClick={() => setShowForm(!showForm)} className="qk-btn qk-btn-primary qk-btn-sm">+ Add</button>
        </div>

        <div className="qk-tabs" style={{ marginBottom: 12 }}>
          {[['todo',`Todo (${counts.todo})`],['in_progress',`In Progress (${counts.in_progress})`],['done',`Done (${counts.done})`]].map(([v,l]) => (
            <button key={v} onClick={() => setTab(v)} className={`qk-tab${tab===v?' active':''}`}>{l}</button>
          ))}
        </div>

        {showForm && (
          <div className="qk-card" style={{ padding: 16, marginBottom: 12, borderColor: G }}>
            <div style={{ marginBottom: 8 }}>
              <label className="qk-lbl">Task title *</label>
              <input value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))} placeholder="What needs to be done?" className="qk-input" style={{ marginTop: 4 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label className="qk-lbl">Assign to</label>
                <select value={form.assigned_to_member_id} onChange={e => setForm(p => ({...p, assigned_to_member_id: e.target.value}))} className="qk-input" style={{ marginTop: 4 }}>
                  <option value="">Anyone</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="qk-lbl">Priority</label>
                <select value={form.priority} onChange={e => setForm(p => ({...p, priority: e.target.value}))} className="qk-input" style={{ marginTop: 4 }}>
                  {Object.keys(PRIORITIES).map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="qk-lbl">Due date</label>
                <input type="date" value={form.due_date} onChange={e => setForm(p => ({...p, due_date: e.target.value}))} className="qk-input" style={{ marginTop: 4 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveTask} disabled={saving} className="qk-btn qk-btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{saving ? '...' : '+ Add Task'}</button>
              <button onClick={() => setShowForm(false)} className="qk-btn qk-btn-ghost">Cancel</button>
            </div>
          </div>
        )}

        {loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="qk-spinner" /></div>
        : filtered.length === 0 ? (
          <div className="qk-empty"><div className="qk-empty-icon">✅</div><div className="qk-empty-title">No {tab.replace('_',' ')} tasks</div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(t => {
              const assignee = members.find(m => m.id === t.assigned_to_member_id);
              const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done';
              return (
                <div key={t.id} className="qk-card" style={{ padding: '13px 14px', borderLeft: `3px solid ${PRIORITIES[t.priority]}` }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-subtle)' }}>
                        {assignee && <span>👤 {assignee.name}</span>}
                        {t.due_date && <span style={{ color: isOverdue ? '#ef4444' : 'var(--text-subtle)' }}>📅 {new Date(t.due_date).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}{isOverdue ? ' ⚠️' : ''}</span>}
                        <span style={{ color: PRIORITIES[t.priority], fontWeight: 600 }}>{t.priority}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                      {t.status === 'todo' && <button onClick={() => updateStatus(t.id, 'in_progress')} className="qk-btn qk-btn-sm" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#3b82f6', fontSize: 11, padding: '4px 8px' }}>▶ Start</button>}
                      {t.status === 'in_progress' && <button onClick={() => updateStatus(t.id, 'done')} className="qk-btn qk-btn-sm" style={{ background: `${G}15`, border: `1px solid ${G}40`, color: G, fontSize: 11, padding: '4px 8px' }}>✓ Done</button>}
                      {t.status === 'done' && <button onClick={() => updateStatus(t.id, 'todo')} className="qk-btn qk-btn-sm" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-subtle)', fontSize: 11, padding: '4px 8px' }}>↩ Reopen</button>}
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
