'use client';
// src/components/avatar/FacePicker.jsx
// The "Choose Aaria's face" picker shown during signup. Pictures only — no
// 3D files are downloaded here; the chosen face loads later in the panel.
import AariaFace from '@/components/AariaFace';

export const FACE_OPTIONS = [
  { id: 'none', label: 'No face', desc: 'Just the glowing Aaria button (lightest)' },
  { id: '2d', label: 'Simple face', desc: 'A small animated face. No download.' },
  { id: 'anime3d', label: 'Anime', desc: 'Lips move as Aaria talks. About 5 MB, once.' },
  { id: 'realistic', label: 'Realistic', desc: 'A 3D person. About 1 MB, once.' },
  { id: 'realistic-in', label: 'Saree or kurta', desc: 'A 3D person in a saree (woman) or a kurta (man). About 1.5 MB, once.' },
];

function Picture({ id, who }) {
  const box = { width: 64, height: 64, borderRadius: 12, overflow: 'hidden', flex: '0 0 64px', background: 'var(--surface-2, #1b1530)', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (id === 'none') return <div style={box}><div style={{ width: 30, height: 30, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #c084fc, #7c3aed)' }} /></div>;
  if (id === '2d') return <div style={box}><AariaFace status="idle" size={56} /></div>;
  const file = id === 'realistic-in' ? `realistic-indian-${who}` : `${id === 'anime3d' ? 'anime' : 'realistic'}-${who}`;
  return <div style={box}><img src={`/avatars/previews/${file}.jpg`} alt="" width={64} height={64} style={{ objectFit: 'cover' }} /></div>;
}

export default function FacePicker({ face, who, onFace, onWho }) {
  return (
    <div data-testid="face-picker" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {['woman', 'man'].map((w) => (
          <button key={w} type="button" data-testid={`face-who-${w}`} onClick={() => onWho(w)}
            style={{ flex: 1, padding: '8px', borderRadius: 10, cursor: 'pointer', fontSize: 14,
              border: `1px solid ${who === w ? '#7c3aed' : 'var(--border)'}`,
              background: who === w ? 'rgba(124,58,237,0.15)' : 'var(--surface)', color: 'var(--text)' }}>
            {w === 'woman' ? 'Woman' : 'Man'}
          </button>
        ))}
      </div>
      {FACE_OPTIONS.map((o) => (
        <div key={o.id} role="button" tabIndex={0} data-testid={`face-option-${o.id}`}
          onClick={() => onFace(o.id)} onKeyDown={(e) => { if (e.key === 'Enter') onFace(o.id); }}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, cursor: 'pointer',
            border: `1px solid ${face === o.id ? '#7c3aed' : 'var(--border)'}`,
            background: face === o.id ? 'rgba(124,58,237,0.15)' : 'var(--surface)' }}>
          <Picture id={o.id} who={who} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: face === o.id ? '#a855f7' : 'var(--text)' }}>{o.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{o.desc}</div>
          </div>
          {face === o.id && <span style={{ color: '#a855f7', fontSize: 18, fontWeight: 'bold' }}>✓</span>}
        </div>
      ))}
      <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '4px 0 0' }}>
        You can change this anytime from Aaria’s panel. More looks are on the “Choose her face” page.
      </p>
    </div>
  );
}
