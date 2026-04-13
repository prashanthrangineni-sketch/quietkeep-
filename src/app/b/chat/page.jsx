'use client';
import { apiGet } from '@/lib/safeFetch';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/b/chat/page.jsx
 * WhatsApp-style internal business chat.
 * Rooms: general | group | dm
 * Messages: text | voice | image | file
 * Real-time via Supabase postgres_changes subscription.
 *
 * Required DB tables (create if not exist):
 *   business_chat_rooms (id, workspace_id, name, room_type, created_by, updated_at)
 *   business_chat_messages (id, room_id, workspace_id, sender_id, sender_name,
 *                           content, message_type, metadata jsonb, created_at)
 *
 * Required Storage bucket: voice-messages (public: false)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import BizNavbar from '@/components/biz/BizNavbar';
import { VoiceMessageRecorder, VoiceMessagePlayer } from '@/components/VoiceMessage';

const G = '#10b981';

export default function BizChatPage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const [workspace, setWorkspace]     = useState(null);
  const [rooms, setRooms]             = useState([]);
  const [members, setMembers]         = useState([]);
  const [activeRoom, setActiveRoom]   = useState(null);
  const [messages, setMessages]       = useState([]);
  const [text, setText]               = useState('');
  const [sending, setSending]         = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [loading, setLoading]         = useState(true);
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomType, setNewRoomType] = useState('group');
  const [dmTarget, setDmTarget]       = useState('');
  const fileRef                       = useRef();
  const bottomRef                     = useRef();
  const channelRef                    = useRef(null);

  function canDo(resource, action) {
    if (!permissions || Object.keys(permissions).length === 0) return true;
    return permissions?.[resource]?.[action] === true;
  }

  useEffect(() => {
    if (authLoading) return; // wait for auth context to resolve
    if (!user) return;
    (async () => {
      const { data: ws } = await supabase
        .from('business_workspaces').select('id,name')
        .eq('owner_user_id', user?.id).maybeSingle();
      if (ws) {
        setWorkspace(ws);
        await loadRooms(ws.id);
        await loadMembers(ws.id);
        apiGet('/api/business/permissions', accessToken)
          .then(({ data: d }) => { if (d?.permissions) setPermissions(d.permissions); })
          .catch(() => {});
      }
      setLoading(false);
    })();
    return () => { channelRef.current?.unsubscribe(); };
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadRooms = useCallback(async (wsId) => {
    const { data } = await supabase
      .from('business_chat_rooms')
      .select('*')
      .eq('workspace_id', wsId)
      .order('updated_at', { ascending: false });
    const roomList = data || [];
    setRooms(roomList);
    // Auto-open General or first room
    if (roomList.length > 0) {
      const gen = roomList.find(r => r.room_type === 'general' || r.name === 'General');
      openRoom(gen || roomList[0]);
    }
  }, []);

  const loadMembers = useCallback(async (wsId) => {
    const { data } = await supabase
      .from('business_members').select('id,name,role,phone')
      .eq('workspace_id', wsId).eq('status', 'active');
    setMembers(data || []);
  }, []);

  function subscribeRoom(roomId) {
    channelRef.current?.unsubscribe();
    channelRef.current = supabase
      .channel(`chat:${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'business_chat_messages',
        filter: `room_id=eq.${roomId}`,
      }, payload => setMessages(prev => [...prev, payload.new]))
      .subscribe();
  }

  async function openRoom(room) {
    setActiveRoom(room);
    const { data } = await supabase
      .from('business_chat_messages').select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true }).limit(60);
    setMessages(data || []);
    subscribeRoom(room.id);
  }

  async function sendText() {
    if (!text.trim() || !activeRoom || sending) return;
    if (!canDo('chat', 'create')) { return; } // silently block — no spam alerts in chat
    const content = text.trim(); setText(''); setSending(true);
    await supabase.from('business_chat_messages').insert({
      room_id: activeRoom.id, workspace_id: workspace.id,
      sender_id: user.id,
      sender_name: user.email?.split('@')[0] || 'User',
      content, message_type: 'text',
      read_by: JSON.stringify([user.id]),
      reactions: JSON.stringify({}),
    });
    await supabase.from('business_chat_rooms')
      .update({ updated_at: new Date().toISOString() }).eq('id', activeRoom.id);
    setSending(false);
  }

  async function sendVoice(blob, durationSec) {
    if (!activeRoom) return;
    setUploading(true);
    const path = `chat/${workspace.id}/${activeRoom.id}/${Date.now()}.webm`;
    const { error } = await supabase.storage
      .from('voice-messages').upload(path, blob, { upsert: false });
    if (error) { setUploading(false); return; }
    // FIX B4: null guard on createSignedUrl — was crashing with TypeError if storage error
    const { data: voiceUrlData, error: voiceUrlErr } = await supabase.storage
      .from('voice-messages').createSignedUrl(path, 60 * 60 * 24 * 365);
    if (voiceUrlErr || !voiceUrlData?.signedUrl) { setUploading(false); return; }
    const signedUrl = voiceUrlData.signedUrl;
    await supabase.from('business_chat_messages').insert({
      room_id: activeRoom.id, workspace_id: workspace.id,
      sender_id: user.id, sender_name: user.email?.split('@')[0] || 'User',
      content: signedUrl, message_type: 'voice',
      metadata: { duration: durationSec, path },
    });
    await supabase.from('business_chat_rooms')
      .update({ updated_at: new Date().toISOString() }).eq('id', activeRoom.id);
    setUploading(false);
  }

  async function sendFile(file) {
    if (!file || !activeRoom) return;
    setUploading(true);
    const ext  = file.name.split('.').pop();
    const path = `chat/${workspace.id}/${activeRoom.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('voice-messages').upload(path, file, { upsert: false });
    if (upErr) { setUploading(false); return; }
    // FIX B4: null guard on signedUrl
    const { data: fileUrlData, error: fileUrlErr } = await supabase.storage
      .from('voice-messages').createSignedUrl(path, 60 * 60 * 24 * 365);
    if (fileUrlErr || !fileUrlData?.signedUrl) { setUploading(false); return; }
    const signedUrl = fileUrlData.signedUrl;
    await supabase.from('business_chat_messages').insert({
      room_id: activeRoom.id, workspace_id: workspace.id,
      sender_id: user.id, sender_name: user.email?.split('@')[0] || 'User',
      content: signedUrl,
      message_type: file.type.startsWith('image') ? 'image' : 'file',
      metadata: { filename: file.name, size: file.size },
    });
    setUploading(false);
  }

  async function createRoom() {
    if (!workspace) return;
    const name = newRoomType === 'dm'
      ? members.find(m => m.id === dmTarget)?.name || 'DM'
      : newRoomName.trim();
    if (!name) return;
    const { data } = await supabase.from('business_chat_rooms').insert({
      workspace_id: workspace.id, name,
      room_type: newRoomType, created_by: user.id,
    }).select().single();
    if (data) { setRooms(p => [data, ...p]); setShowNewRoom(false); setNewRoomName(''); openRoom(data); }
  }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  const isOwn = msg => msg.sender_id === user?.id;

  const inp = {
    width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14,
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };

  async function addReaction(messageId, emoji) {
    const { data: msg } = await supabase.from('business_chat_messages')
      .select('reactions').eq('id', messageId).single();
    if (!msg) return;
    const reactions = typeof msg.reactions === 'string'
      ? JSON.parse(msg.reactions || '{}') : (msg.reactions || {});
    const users = reactions[emoji] || [];
    const alreadyReacted = users.includes(user.id);
    if (alreadyReacted) {
      reactions[emoji] = users.filter(id => id !== user.id);
      if (!reactions[emoji].length) delete reactions[emoji];
    } else {
      reactions[emoji] = [...users, user.id];
    }
    await supabase.from('business_chat_messages')
      .update({ reactions: JSON.stringify(reactions) }).eq('id', messageId);
  }

  async function markRead(messageId) {
    if (!user) return;
    const { data: msg } = await supabase.from('business_chat_messages')
      .select('read_by').eq('id', messageId).single();
    if (!msg) return;
    const readBy = typeof msg.read_by === 'string'
      ? JSON.parse(msg.read_by || '[]') : (msg.read_by || []);
    if (!readBy.includes(user.id)) {
      await supabase.from('business_chat_messages')
        .update({ read_by: JSON.stringify([...readBy, user.id]) }).eq('id', messageId);
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <BizNavbar />
      <div className="qk-spinner" />
    </div>
  );

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', display: 'flex',
      flexDirection: 'column', paddingTop: 56,
      paddingBottom: 'calc(52px + env(safe-area-inset-bottom,0px))' }}>
      <BizNavbar />

      <div style={{ display: 'flex', flex: 1, maxWidth: 900, width: '100%',
        margin: '0 auto', height: 'calc(100dvh - 108px)', overflow: 'hidden' }}>

        {/* ── ROOM LIST sidebar ── */}
        <div style={{
          width: activeRoom ? 0 : '100%',
          maxWidth: 280, minWidth: activeRoom ? 0 : '100%',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden', transition: 'all 0.2s',
        }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexShrink: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>💬 Channels</div>
            <button onClick={() => setShowNewRoom(true)}
              style={{ width: 30, height: 30, borderRadius: '50%', border: 'none',
                background: G, color: '#fff', cursor: 'pointer', fontSize: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              +
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {rooms.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center',
                color: 'var(--text-subtle)', fontSize: 13 }}>
                No channels yet.<br />Create one to start.
              </div>
            ) : rooms.map(room => (
              <div key={room.id} onClick={() => openRoom(room)}
                style={{ padding: '12px 14px', cursor: 'pointer',
                  background: activeRoom?.id === room.id ? 'var(--primary-dim)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: `3px solid ${activeRoom?.id === room.id ? 'var(--primary)' : 'transparent'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)',
                      display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>
                        {room.room_type === 'general' ? '#'
                          : room.room_type === 'dm' ? '👤' : '👥'}
                      </span>
                      {room.name}
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-subtle)', flexShrink: 0 }}>
                    {fmtTime(room.updated_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── MESSAGE PANEL ── */}
        {activeRoom ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
            overflow: 'hidden', minWidth: 0 }}>
            {/* Room header */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--surface)', flexShrink: 0 }}>
              <button onClick={() => setActiveRoom(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: 20, padding: '0 4px' }}>
                ←
              </button>
              <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: `linear-gradient(135deg,${G},#059669)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 800, color: '#fff' }}>
                {activeRoom.room_type === 'general' ? '#'
                  : activeRoom.room_type === 'dm' ? '👤' : '👥'}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{activeRoom.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                  {workspace?.name}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px',
              display: 'flex', flexDirection: 'column', gap: 6 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 0',
                  color: 'var(--text-subtle)', fontSize: 13 }}>
                  No messages yet. Say hello! 👋
                </div>
              )}
              {messages.map((msg, i) => {
                const own = isOwn(msg);
                return (
                  <div key={msg.id || i}
                    style={{ display: 'flex', justifyContent: own ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '76%' }}>
                      {!own && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: G,
                          marginBottom: 2, paddingLeft: 4 }}>
                          {msg.sender_name}
                        </div>
                      )}
                      <div style={{
                        padding: msg.message_type === 'text' ? '9px 12px' : '8px',
                        borderRadius: own ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                        background: own ? 'var(--primary)' : 'var(--surface)',
                        border: own ? 'none' : '1px solid var(--border)',
                        fontSize: 13, color: own ? '#fff' : 'var(--text)', lineHeight: 1.5,
                      }}>
                        {msg.message_type === 'text' && msg.content}
                        {msg.message_type === 'voice' && (
                          <VoiceMessagePlayer
                            url={msg.content}
                            durationSec={msg.metadata?.duration || 0}
                            accentColor={own ? '#fff' : G}
                            compact
                          />
                        )}
                        {msg.message_type === 'image' && (
                          <img src={msg.content} alt="img"
                            style={{ maxWidth: 200, borderRadius: 8, display: 'block' }} />
                        )}
                        {msg.message_type === 'file' && (
                          <a href={msg.content} target="_blank" rel="noopener"
                            style={{ color: own ? '#fff' : 'var(--primary)', fontSize: 12,
                              textDecoration: 'none' }}>
                            📎 {msg.metadata?.filename || 'File'}
                          </a>
                        )}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-subtle)',
                        textAlign: own ? 'right' : 'left', marginTop: 2,
                        display: 'flex', alignItems: 'center', gap: 4,
                        justifyContent: own ? 'flex-end' : 'flex-start' }}>
                        {fmtTime(msg.created_at)}
                        {msg.read_by && (Array.isArray(msg.read_by) ? msg.read_by : JSON.parse(msg.read_by||'[]')).length > 1 && (
                          <span title="Read">✓✓</span>
                        )}
                      </div>
                      {/* Reactions */}
                      {msg.reactions && Object.keys(typeof msg.reactions === 'string' ? JSON.parse(msg.reactions||'{}') : (msg.reactions||{})).length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3,
                          justifyContent: own ? 'flex-end' : 'flex-start' }}>
                          {Object.entries(typeof msg.reactions === 'string' ? JSON.parse(msg.reactions||'{}') : (msg.reactions||{})).map(([emoji, users]) => (
                            <button key={emoji} onClick={() => addReaction(msg.id, emoji)}
                              style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10,
                                border: '1px solid var(--border)',
                                background: (Array.isArray(users) ? users : []).includes(user?.id||'') ? 'var(--primary-dim)' : 'var(--surface)',
                                cursor: 'pointer', color: 'var(--text-muted)' }}>
                              {emoji} {(Array.isArray(users) ? users : []).length}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)',
              background: 'var(--surface)', display: 'flex', gap: 8,
              alignItems: 'center', flexShrink: 0 }}>
              <input type="file" ref={fileRef} accept="image/*,application/pdf"
                onChange={e => { if (e.target.files?.[0]) sendFile(e.target.files[0]); }}
                style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                style={{ width: 36, height: 36, borderRadius: '50%', border: 'none',
                  background: 'var(--surface-hover)', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: 16, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                📎
              </button>

              <input value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                placeholder="Message…"
                style={{ ...inp, flex: 1, marginBottom: 0, fontSize: 14 }} />

              <VoiceMessageRecorder onSend={sendVoice} disabled={uploading} accentColor={G} />
              <div style={{ display: 'flex', gap: 2 }}>
                {['❤️','👍','😂','🙏'].map(emoji => (
                  <button key={emoji} disabled={!activeRoom}
                    style={{ fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                    title={`React with ${emoji}`}>
                    {emoji}
                  </button>
                ))}
              </div>

              {text.trim() && (
                <button onClick={sendText} disabled={sending}
                  style={{ width: 36, height: 36, borderRadius: '50%', border: 'none',
                    background: G, color: '#fff', cursor: 'pointer', fontSize: 16,
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ➤
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: 'var(--text-subtle)', fontSize: 14 }}>
            Select a channel to start chatting
          </div>
        )}
      </div>

      {/* New room modal */}
      {showNewRoom && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.7)', display: 'flex',
          alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setShowNewRoom(false)}>
          <div style={{ background: 'var(--bg)', borderRadius: '20px 20px 0 0',
            padding: '24px 20px 40px', width: '100%', maxWidth: 480,
            border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 18 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>New Channel</div>
              <button onClick={() => setShowNewRoom(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-subtle)',
                  cursor: 'pointer', fontSize: 22 }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {[['group','👥 Group'],['dm','👤 DM'],['general','# Announce']].map(([v,l]) => (
                <button key={v} onClick={() => setNewRoomType(v)}
                  style={{ flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 11,
                    fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${newRoomType === v ? G : 'var(--border)'}`,
                    background: newRoomType === v ? `${G}15` : 'transparent',
                    color: newRoomType === v ? G : 'var(--text-muted)' }}>
                  {l}
                </button>
              ))}
            </div>
            {newRoomType === 'dm' ? (
              <select value={dmTarget} onChange={e => setDmTarget(e.target.value)} style={inp}>
                <option value="">Select member…</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                ))}
              </select>
            ) : (
              <input value={newRoomName} onChange={e => setNewRoomName(e.target.value)}
                placeholder="Channel name (e.g. Sales, Delivery)" style={inp} />
            )}
            <button onClick={createRoom}
              style={{ width: '100%', marginTop: 14, padding: '13px', borderRadius: 12,
                border: 'none', background: G, color: '#fff', fontSize: 15,
                fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Create Channel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
