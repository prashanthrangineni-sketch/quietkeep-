'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/camera/page.jsx
 * AI Memory Capture Engine
 *
 * Captures photo/video → attaches:
 *   - Auto GPS location (Capacitor Geolocation) + manual override
 *   - People tags (contacts or custom names)
 *   - Text note + voice note
 *   - Event type (trip, meeting, purchase, etc.)
 *   - AI auto-tagging (object/scene detection via Claude vision)
 *
 * Creates a memory record searchable by:
 *   "Show photos with Rahul in Hyderabad"
 *   "Show invoices from last month"
 *
 * Works for both personal (memory timeline) and business (proof of work,
 * inventory capture, invoice scanning).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';
import { safeFetch } from '@/lib/safeFetch';

const EVENT_TYPES = [
  { value: 'memory',    emoji: '💭', label: 'Memory' },
  { value: 'trip',      emoji: '✈️', label: 'Trip' },
  { value: 'meeting',   emoji: '🤝', label: 'Meeting' },
  { value: 'purchase',  emoji: '🛍️', label: 'Purchase' },
  { value: 'invoice',   emoji: '🧾', label: 'Invoice' },
  { value: 'inventory', emoji: '📦', label: 'Inventory' },
  { value: 'milestone', emoji: '🏆', label: 'Milestone' },
  { value: 'family',    emoji: '👨‍👩‍👧', label: 'Family' },
  { value: 'health',    emoji: '❤️', label: 'Health' },
  { value: 'other',     emoji: '📌', label: 'Other' },
];

export default function CameraPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [view, setView]               = useState('capture'); // capture | review | gallery
  const [file, setFile]               = useState(null);
  const [preview, setPreview]         = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);

  // Metadata fields
  const [note, setNote]           = useState('');
  const [eventType, setEventType] = useState('memory');
  const [location, setLocation]   = useState('');
  const [locationAuto, setLocationAuto] = useState(null); // { lat, lng, name }
  const [people, setPeople]       = useState([]); // string[]
  const [newPerson, setNewPerson] = useState('');
  const [aiTags, setAiTags]       = useState([]); // AI-detected tags
  const [aiLoading, setAiLoading] = useState(false);

  // Gallery
  const [memories, setMemories]   = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fileRef = useRef();
  const cameraRef = useRef();

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    requestLocation();
  }, [authLoading, user]);

  async function requestLocation() {
    try {
      // Try Capacitor Geolocation first
      const cap = typeof window !== 'undefined' ? window?.Capacitor : null;
      if (cap?.Plugins?.Geolocation) {
        const pos = await cap.Plugins.Geolocation.getCurrentPosition({
          enableHighAccuracy: true, timeout: 8000,
        });
        const { latitude: lat, longitude: lng } = pos.coords;
        await reverseGeocode(lat, lng);
        return;
      }
      // Fallback: browser geolocation
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          async p => await reverseGeocode(p.coords.latitude, p.coords.longitude),
          () => {},
          { timeout: 8000 }
        );
      }
    } catch {}
  }

  async function reverseGeocode(lat, lng) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
      );
      if (!res.ok) return;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json') && !ct.includes('text/json')) return;
      const d = await res.json();
      const name = d.address?.city || d.address?.town || d.address?.village
        || d.address?.suburb || d.display_name?.split(',')[0] || '';
      setLocationAuto({ lat, lng, name });
      if (!location) setLocation(name);
    } catch {}
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setNote(''); setAiTags([]); setSaved(false);
    setView('review');
    // Auto-run AI tagging for images
    if (f.type.startsWith('image')) runAITagging(f);
  }

  // Native camera via Capacitor — forces CAMERA source (not gallery picker).
  // On web: falls back to the hidden <input capture="environment">.
  async function takePhotoNative() {
    try {
      const cap = typeof window !== 'undefined' ? window?.Capacitor : null;
      const CameraPlugin = cap?.Plugins?.Camera;
      if (CameraPlugin) {
        // Capacitor Camera plugin — CameraSource.Camera = 1 (forces camera, never gallery)
        const photo = await CameraPlugin.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: 'dataUrl',  // CameraResultType.DataUrl = 'dataUrl'
          source: 'CAMERA',       // CameraSource.Camera — critical fix for APK gallery bug
          saveToGallery: false,
        });
        if (photo?.dataUrl) {
          // Convert dataUrl to File object for consistent downstream handling
          const res  = await fetch(photo.dataUrl);
          const blob = await res.blob();
          const f    = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
          setFile(f);
          setPreview(photo.dataUrl);
          setNote(''); setAiTags([]); setSaved(false);
          setView('review');
          runAITagging(f);
          return;
        }
      }
    } catch (err) {
      // User cancelled or plugin unavailable — fall through to web input
      if (err?.message?.includes('cancelled') || err?.message?.includes('canceled')) return;
    }
    // Web fallback: use HTML input with capture="environment"
    fileRef.current?.click();
  }

  async function runAITagging(imgFile) {
    if (!accessToken || !imgFile) return;
    setAiLoading(true);
    try {
      // Convert to base64
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(imgFile);
      });

      const { data: d, error } = await safeFetch('/api/ai/summary', {
        method: 'POST',
        body: JSON.stringify({
          prompt: `Analyse this image and return ONLY valid JSON:
{
  "objects": ["detected objects/items"],
  "scene": "brief scene description",
  "suggested_tags": ["tag1","tag2","tag3"],
  "suggested_event_type": "memory|trip|meeting|purchase|invoice|inventory|milestone|family|health|other",
  "suggested_note": "one sentence description",
  "people_count": 0,
  "text_detected": "any visible text (receipt totals, product names, etc.)"
}`,
          type: 'vision_tag',
          image_base64: b64,
          image_mime: imgFile.type,
        }),
      });

      if (!error && d) {
        const text = d.summary || d.result || d.content || '';
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          setAiTags(parsed.suggested_tags || parsed.objects || []);
          if (parsed.suggested_event_type) setEventType(parsed.suggested_event_type);
          if (!note && parsed.suggested_note) setNote(parsed.suggested_note);
          if (parsed.text_detected) {
            setNote(prev => prev || `Text: ${parsed.text_detected}`);
          }
        }
      }
    } catch {}
    setAiLoading(false);
  }

  async function saveCapture() {
    if (!file || !user) return;
    setSaving(true);
    try {
      // 1. Upload to Supabase Storage
      const ext  = file.name.split('.').pop() || (file.type.startsWith('image') ? 'jpg' : 'mp4');
      const path = `${user.id}/camera/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('memories').upload(path, file, {
        cacheControl: '3600', upsert: false,
      });
      if (upErr) throw upErr;

      // FIX B3: createSignedUrl returns { data, error } — destructuring data.signedUrl
      // directly crashes with TypeError if data is null (permissions error, network, etc.)
      const { data: urlData, error: urlErr } = await supabase.storage
        .from('memories').createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      if (urlErr || !urlData?.signedUrl) throw new Error('Could not generate file URL');
      const signedUrl = urlData.signedUrl;

      // 2. Create memory record
      const { data: mem } = await supabase.from('memories').insert({
        user_id: user.id,
        title: note.trim() || `${EVENT_TYPES.find(e => e.value === eventType)?.label} · ${new Date().toLocaleDateString('en-IN')}`,
        description: note.trim() || null,
        life_event_type: eventType,
        event_date: new Date().toISOString().split('T')[0],
        location: location.trim() || null,
        location_lat: locationAuto?.lat || null,
        location_lng: locationAuto?.lng || null,
        people_tags: people,
        ai_tags: aiTags,
      }).select().single();

      if (mem) {
        // 3. Create memory_item
        await supabase.from('memory_items').insert({
          memory_id: mem.id,
          user_id: user.id,
          item_type: file.type.startsWith('video') ? 'video' : 'image',
          file_path: path,
          file_url: signedUrl,
          title: note.trim() || file.name,
          metadata: { size: file.size, mime: file.type, ai_tags: aiTags },
        });
      }

      setSaved(true);
      setTimeout(() => {
        setFile(null); setPreview(null); setNote(''); setPeople([]);
        setAiTags([]); setSaved(false); setView('capture');
      }, 1500);
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
    setSaving(false);
  }

  async function loadGallery() {
    if (!user) return;
    setGalleryLoading(true);
    // Query memories with items
    const query = supabase.from('memories')
      .select('*, memory_items(id,file_url,item_type,title,metadata)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(40);

    if (searchQuery.trim()) {
      query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%,people_tags.cs.{${searchQuery}},location.ilike.%${searchQuery}%`);
    }

    const { data } = await query;
    setMemories(data || []);
    setGalleryLoading(false);
  }

  useEffect(() => {
    if (view === 'gallery' && user) loadGallery();
  }, [view, user]);

  const inp = {
    width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 14,
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingTop: 56, paddingBottom: 80,
        fontFamily: "'Inter',-apple-system,sans-serif", color: 'var(--text)' }}>

        <div style={{ maxWidth: 520, margin: '0 auto', padding: '20px 16px' }}>

          {/* ── HEADER + TAB BAR ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.5px' }}>
                📷 AI Camera
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Capture · Tag · Remember forever
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['capture','📷'],['gallery','🗂']].map(([v, icon]) => (
                <button key={v} onClick={() => setView(v)}
                  style={{ padding: '7px 14px', borderRadius: 8, border: 'none',
                    background: view === v ? 'var(--primary)' : 'var(--surface)',
                    color: view === v ? '#fff' : 'var(--text-muted)',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* ── CAPTURE / REVIEW VIEW ── */}
          {(view === 'capture' || view === 'review') && (
            <>
              {/* Camera / file trigger */}
              {!preview ? (
                <div>
                  <input type="file" ref={fileRef}
                    accept="image/*,video/*" capture="environment"
                    onChange={handleFileChange}
                    style={{ display: 'none' }} />
                  <input type="file" ref={cameraRef}
                    accept="image/*,video/*"
                    onChange={handleFileChange}
                    style={{ display: 'none' }} />

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                    <button onClick={takePhotoNative}
                      style={{ aspectRatio: '1', borderRadius: 20, border: '2px dashed var(--primary)',
                        background: 'var(--primary-dim)', color: 'var(--primary)',
                        cursor: 'pointer', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <span style={{ fontSize: 40 }}>📸</span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>Take Photo</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Camera</span>
                    </button>
                    <button onClick={() => cameraRef.current?.click()}
                      style={{ aspectRatio: '1', borderRadius: 20, border: '2px dashed var(--border)',
                        background: 'var(--surface)', color: 'var(--text)',
                        cursor: 'pointer', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <span style={{ fontSize: 40 }}>🖼️</span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>Choose File</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gallery / Files</span>
                    </button>
                  </div>

                  {/* Recent captures preview */}
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', marginTop: 8 }}>
                    Tap a button above to capture or select a photo/video
                  </div>
                </div>
              ) : (
                <>
                  {/* Preview */}
                  <div style={{ position: 'relative', marginBottom: 16 }}>
                    <img src={preview} alt="preview"
                      style={{ width: '100%', borderRadius: 16, maxHeight: 320,
                        objectFit: 'cover', display: 'block' }} />
                    <button onClick={() => { setFile(null); setPreview(null); setAiTags([]); setNote(''); setView('capture'); }}
                      style={{ position: 'absolute', top: 10, right: 10, width: 32, height: 32,
                        borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)',
                        color: '#fff', cursor: 'pointer', fontSize: 16,
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      ✕
                    </button>
                    {aiLoading && (
                      <div style={{ position: 'absolute', bottom: 10, left: 10,
                        background: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: '4px 10px',
                        display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div className="qk-spinner" style={{ width: 14, height: 14 }} />
                        <span style={{ fontSize: 11, color: '#fff' }}>AI analysing…</span>
                      </div>
                    )}
                  </div>

                  {/* AI tags */}
                  {aiTags.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)',
                        marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        🤖 AI detected
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {aiTags.map((tag, i) => (
                          <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999,
                            background: 'var(--primary-dim)', color: 'var(--primary)',
                            border: '1px solid var(--primary-glow)' }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Event type */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                      marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      TYPE
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {EVENT_TYPES.map(et => (
                        <button key={et.value} onClick={() => setEventType(et.value)}
                          style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11,
                            cursor: 'pointer', fontFamily: 'inherit',
                            background: eventType === et.value ? 'var(--primary-dim)' : 'transparent',
                            border: `1px solid ${eventType === et.value ? 'var(--primary-glow)' : 'var(--border)'}`,
                            color: eventType === et.value ? 'var(--primary)' : 'var(--text-muted)' }}>
                          {et.emoji} {et.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Note */}
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                      display: 'block', marginBottom: 4 }}>NOTE</label>
                    <textarea value={note} rows={2}
                      onChange={e => setNote(e.target.value)}
                      placeholder="What is this? Add context…"
                      style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
                  </div>

                  {/* Location */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        LOCATION
                      </label>
                      {locationAuto && (
                        <button onClick={() => setLocation(locationAuto.name)}
                          style={{ fontSize: 10, color: 'var(--primary)', background: 'none',
                            border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                          📍 Use GPS: {locationAuto.name}
                        </button>
                      )}
                    </div>
                    <input value={location} onChange={e => setLocation(e.target.value)}
                      placeholder="Where was this taken?" style={inp} />
                  </div>

                  {/* People tags */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                      display: 'block', marginBottom: 6, textTransform: 'uppercase',
                      letterSpacing: '0.05em' }}>
                      PEOPLE
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                      {people.map((p, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5,
                          padding: '3px 10px', borderRadius: 999,
                          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
                          fontSize: 12, color: 'var(--primary)' }}>
                          👤 {p}
                          <button onClick={() => setPeople(people.filter((_, j) => j !== i))}
                            style={{ background: 'none', border: 'none', color: '#ef4444',
                              cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input value={newPerson} onChange={e => setNewPerson(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && newPerson.trim()) {
                            setPeople(p => [...p, newPerson.trim()]); setNewPerson('');
                          }
                        }}
                        placeholder="Add person name (Enter to add)"
                        style={{ ...inp, flex: 1, fontSize: 12 }} />
                      <button onClick={() => {
                        if (newPerson.trim()) { setPeople(p => [...p, newPerson.trim()]); setNewPerson(''); }
                      }} style={{ padding: '8px 12px', borderRadius: 8, border: 'none',
                        background: 'var(--primary)', color: '#fff', fontSize: 13,
                        cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                        +
                      </button>
                    </div>
                  </div>

                  {/* Save button */}
                  {saved ? (
                    <div style={{ width: '100%', padding: '14px', borderRadius: 12, textAlign: 'center',
                      background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
                      color: '#10b981', fontSize: 15, fontWeight: 700 }}>
                      ✓ Memory saved!
                    </div>
                  ) : (
                    <button onClick={saveCapture} disabled={saving || !file}
                      style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                        background: file ? 'var(--primary)' : 'var(--surface-hover)',
                        color: file ? '#fff' : 'var(--text-subtle)',
                        fontSize: 15, fontWeight: 700,
                        cursor: file ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                      {saving ? '⏳ Saving…' : '✓ Save to Memory'}
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {/* ── GALLERY VIEW ── */}
          {view === 'gallery' && (
            <>
              {/* Search bar */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') loadGallery(); }}
                    placeholder="Search by person, place, event… (Enter)"
                    style={{ ...inp, flex: 1 }} />
                  <button onClick={loadGallery}
                    style={{ padding: '10px 14px', borderRadius: 8, border: 'none',
                      background: 'var(--primary)', color: '#fff', fontSize: 13,
                      cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                    🔍
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                  Try: "Goa", "Rahul", "invoice", "family"
                </div>
              </div>

              {galleryLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <div className="qk-spinner" style={{ margin: '0 auto 12px' }} />
                  <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading gallery…</div>
                </div>
              ) : memories.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 20px',
                  border: '1px dashed var(--border)', borderRadius: 16 }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                    {searchQuery ? 'No memories match your search' : 'No memories yet'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Capture your first photo or video above
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 10 }}>
                    {memories.length} memories
                  </div>

                  {/* Image grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginBottom: 16 }}>
                    {memories.flatMap(m =>
                      (m.memory_items || [])
                        .filter(i => i.item_type === 'image')
                        .slice(0, 1)
                        .map(item => (
                          <div key={item.id} style={{ aspectRatio: '1', borderRadius: 8,
                            overflow: 'hidden', background: 'var(--surface)', position: 'relative' }}>
                            <img src={item.file_url} alt={item.title}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            {m.location && (
                              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
                                background: 'linear-gradient(transparent,rgba(0,0,0,0.7))',
                                padding: '12px 4px 3px', fontSize: 9, color: '#fff',
                                textAlign: 'center' }}>
                                📍{m.location}
                              </div>
                            )}
                          </div>
                        ))
                    )}
                  </div>

                  {/* List view for memories without images */}
                  {memories.filter(m => !m.memory_items?.length || !m.memory_items.some(i => i.item_type === 'image')).map(m => (
                    <div key={m.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{m.title}</div>
                      {m.location && (
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                          📍 {m.location}
                        </div>
                      )}
                      {m.people_tags?.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                          👤 {m.people_tags.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
