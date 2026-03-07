'use client';
import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';

const KEEP_COLORS = ['#6366f1','#FF6B6B','#4ECDC4','#FFD700','#2ECC71','#E67E22','#9B59B6','#3498DB'];

export default function KeepWidget({ compact = false }) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const [keeps, setKeeps] = useState([]);
  const [newText, setNewText] = useState('');
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState(null);
  const [selectedColor, setSelectedColor] = useState('#6366f1');
  const [showInput, setShowInput] = useState(false);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    await fetchKeeps(user.id);
  }

  async function fetchKeeps(uid) {
    const { data, error } = await supabase
      .from('keeps')
      .select('*')
      .eq('user_id', uid)
      .eq('status', 'open')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(compact ? 5 : 50);
    if (!error) setKeeps(data || []);
  }

  async function saveKeep() {
    if (!newText.trim() || !userId) return;
    setLoading(true);
    const { error } = await supabase.from('keeps').insert({
      user_id: userId,
      content: newText.trim(),
      status: 'open',
      intent_type: 'note',
      color: selectedColor,
      show_on_brief: true,
    });
    if (!error) {
      setNewText('');
      setShowInput(false);
      await fetchKeeps(userId);
    } else {
      alert('Could not save: ' + error.message);
    }
    setLoading(false);
  }

  async function dismissKeep(id) {
    await supabase.from('keeps').update({ status: 'done' }).eq('id', id);
    fetchKeeps(userId);
  }

  async function pinKeep(id, currentPinned) {
    await supabase.from('keeps').update({ is_pinned: !currentPinned }).eq('id', id);
    fetchKeeps(userId);
  }

  return (
    <div style={{ background: '#12121a', borderRadius: '16px', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontWeight: 700, fontSize: '16px' }}>📌 Keep</span>
        <button onClick={() => setShowInput(!showInput)}
          style={{ background: '#6366f1', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
          + Add
        </button>
      </div>

      {/* Input area */}
      {showInput && (
        <div style={{ marginBottom: '12px' }}>
          <textarea
            value={newText}
            onChange={e => setNewText(e.target.value)}
            placeholder="What do you want to keep in mind?"
            rows={2}
            style={{ width: '100%', background: '#1e1e2e', border: '1px solid #333', color: '#fff', padding: '10px', borderRadius: '10px', fontSize: '14px', resize: 'none', boxSizing: 'border-box', marginBottom: '8px' }}
          />
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            {KEEP_COLORS.map(c => (
              <div key={c} onClick={() => setSelectedColor(c)}
                style={{ width: '20px', height: '20px', borderRadius: '50%', background: c, cursor: 'pointer',
                  border: selectedColor === c ? '2px solid #fff' : '2px solid transparent' }} />
            ))}
          </div>
          <button onClick={saveKeep} disabled={loading || !newText.trim()}
            style={{ width: '100%', padding: '10px', background: newText.trim() ? '#6366f1' : '#333', border: 'none', color: '#fff', borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
            {loading ? 'Saving...' : 'Save Keep'}
          </button>
        </div>
      )}

      {/* Keeps list */}
      {keeps.length === 0 ? (
        <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '16px' }}>
          Nothing in keep. Tap + Add to save a note, reminder, or task.
        </div>
      ) : (
        keeps.map(k => (
          <div key={k.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px', background: '#1a1a2e', borderRadius: '10px', marginBottom: '6px',
            borderLeft: `3px solid ${k.color || '#6366f1'}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', color: '#eee', lineHeight: '1.4' }}>{k.content}</div>
              {k.reminder_at && (
                <div style={{ fontSize: '11px', color: '#FFD700', marginTop: '4px' }}>⏰ {new Date(k.reminder_at).toLocaleString('en-IN')}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
              <button onClick={() => pinKeep(k.id, k.is_pinned)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', opacity: k.is_pinned ? 1 : 0.4 }}>📌</button>
              <button onClick={() => dismissKeep(k.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#888' }}>✓</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
