'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function BriefPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [keeps, setKeeps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    content: '',
    intent_type: 'note',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadKeeps();
  }, []);

  const loadKeeps = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        const { data, error } = await supabase
          .from('keeps')
          .select('*')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setKeeps(data || []);
      }
    } catch (error) {
      console.error('Error loading keeps:', error);
      alert('Error loading keeps');
    } finally {
      setLoading(false);
    }
  };

  const handleAddKeep = async () => {
    if (!formData.content.trim()) {
      alert('Please enter something');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('keeps')
        .insert({
          user_id: user.id,
          content: formData.content,
          intent_type: formData.intent_type,
          status: 'open',
          voice_text: formData.content,
        })
        .select()
        .single();

      if (error) throw error;

      setKeeps([data, ...keeps]);
      setFormData({ content: '', intent_type: 'note' });
      setShowForm(false);
      alert('Keep added successfully!');
    } catch (error) {
      console.error('Error:', error);
      alert('Error adding keep: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKeep = async (id) => {
    if (!confirm('Delete this keep?')) return;

    try {
      await supabase.from('keeps').delete().eq('id', id);
      setKeeps(keeps.filter(k => k.id !== id));
      alert('Keep deleted');
    } catch (error) {
      console.error('Error:', error);
      alert('Error deleting keep');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'open': return '#6366f1';
      case 'done': return '#10b981';
      case 'reminded': return '#f59e0b';
      default: return '#64748b';
    }
  };

  if (loading) return <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>;

  const openCount = keeps.filter(k => k.status === 'open').length;
  const doneCount = keeps.filter(k => k.status === 'done').length;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '20px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '800', margin: 0 }}>📝 Daily Brief</h1>
          <button onClick={() => router.push('/dashboard')} style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
            ← Back
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '24px' }}>
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#6366f1' }}>{openCount}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Open</div>
          </div>
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>{doneCount}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Done</div>
          </div>
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#8b5cf6' }}>{keeps.length}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Total</div>
          </div>
        </div>

        {keeps.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>All Keeps</h3>
            {keeps.map(keep => (
              <div 
                key={keep.id} 
                style={{ 
                  backgroundColor: '#0f0f1a', 
                  border: `1px solid ${getStatusColor(keep.status)}`, 
                  borderRadius: '10px', 
                  padding: '14px', 
                  marginBottom: '8px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>{keep.content}</div>
                    <div style={{ display: 'flex', gap: '8px', fontSize: '10px' }}>
                      <span style={{ color: getStatusColor(keep.status), fontWeight: '600' }}>{keep.status.toUpperCase()}</span>
                      <span style={{ color: '#64748b' }}>{new Date(keep.created_at).toLocaleDateString('en-IN')}</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDeleteKeep(keep.id)} 
                    style={{ backgroundColor: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '12px' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button 
          onClick={() => setShowForm(!showForm)}
          style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}
        >
          + New Keep
        </button>

        {showForm && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '16px' }}>
            <textarea 
              placeholder="What's on your mind?" 
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', minHeight: '80px', fontFamily: 'inherit', resize: 'none' }}
            />
            <select 
              value={formData.intent_type}
              onChange={(e) => setFormData({ ...formData, intent_type: e.target.value })}
              style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            >
              <option value="note">Note</option>
              <option value="reminder">Reminder</option>
              <option value="todo">Todo</option>
              <option value="event">Event</option>
            </select>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={handleAddKeep}
                disabled={saving}
                style={{ flex: 1, backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
              >
                {saving ? 'Saving...' : 'Save Keep'}
              </button>
              <button 
                onClick={() => setShowForm(false)}
                style={{ flex: 1, backgroundColor: '#1a1a2e', color: '#94a3b8', border: '1px solid #334155', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
