// src/lib/avatar/phone-check.js
// "Phone check" on the faces page: the phone measures itself, so no USB cable
// or laptop is needed. Pure helpers here; the page drives the faces.

export const CHECK_FACES = [
  { name: 'Anime woman', style: 'anime3d', who: 'woman', look: 'woman-1' },
  { name: 'Anime man', style: 'anime3d', who: 'man', look: 'man-1' },
  { name: 'Realistic woman 1', style: 'realistic', who: 'woman', look: 'woman-1' },
  { name: 'Realistic woman 2', style: 'realistic', who: 'woman', look: 'woman-2' },
  { name: 'Realistic man 1', style: 'realistic', who: 'man', look: 'man-1' },
  { name: 'Realistic man 2', style: 'realistic', who: 'man', look: 'man-2' },
  { name: 'Realistic man 3', style: 'realistic', who: 'man', look: 'man-3' },
  { name: 'Realistic man 4', style: 'realistic', who: 'man', look: 'man-4' },
];

// Same bar the live panel uses to fall back to the simple face.
export const SMOOTH_FPS = 24;
export const USABLE_FPS = 12;

/** Plain-words verdict for one reading. */
export function verdict(fps) {
  if (!fps || typeof fps.medianFps !== 'number') return 'no reading';
  if (fps.medianFps >= SMOOTH_FPS) return 'smooth';
  if (fps.medianFps >= USABLE_FPS) return 'usable';
  return 'too slow';
}

/** What happened to the mouth while she spoke. */
export function mouthWord(m) {
  if (!m || !m.heard) return 'no sound reached the page';
  if (m.audio) return 'lips followed her voice';
  if (m.cycle) return 'lips moved (simple open-close)';
  return 'sound played, lips did not move';
}

/** The text the founder can copy or screenshot. */
export function summariseCheck({ device, faces, voices, startedAt, endedAt }) {
  const lines = [];
  lines.push(`Aaria phone check · ${new Date(startedAt).toISOString()}`);
  lines.push(`Phone: ${device}`);
  lines.push(`Took ${Math.round((endedAt - startedAt) / 1000)} s`);
  lines.push('');
  lines.push('Faces (frames per second at rest / while speaking; slowest frame):');
  for (const f of faces) {
    if (f.error) { lines.push(`- ${f.name}: FAILED (${f.error})`); continue; }
    const r = f.rest, s = f.speaking;
    lines.push(`- ${f.name}: ${r ? r.medianFps : '-'} / ${s ? s.medianFps : '-'} fps; slowest ${r ? r.worstFrameMs : '-'} / ${s ? s.worstFrameMs : '-'} ms; loaded in ${f.loadSeconds ?? '-'} s; ${verdict(s || r)}; ${mouthWord(f.mouth)}`);
  }
  lines.push('');
  lines.push('Voice (Anime woman):');
  for (const v of voices) lines.push(`- ${v.label}: ${mouthWord(v.mouth)}`);
  return lines.join('\n');
}
