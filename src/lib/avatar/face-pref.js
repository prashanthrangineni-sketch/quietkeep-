// src/lib/avatar/face-pref.js
// The settings switch for Aaria's animated face. OFF unless the person turns
// it on; nothing about the dock changes for anyone who has not.
const KEY = 'qk_aaria_face';
export const FACES = ['2d', 'anime3d', 'realistic'];

export function isFaceOn() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setFaceOn(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { }
  try { window.dispatchEvent(new Event('qk_aaria_face_changed')); } catch { }
}
export function onFaceChange(fn) {
  if (typeof window === 'undefined') return () => { };
  window.addEventListener('qk_aaria_face_changed', fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener('qk_aaria_face_changed', fn); window.removeEventListener('storage', fn); };
}

// ── Which face the person chose (made on /aaria-stage, used by the dock) ────
export const ANIME_MODELS = {
  woman: '/avatars/anime-sample/VRM1_Constraint_Twist_Sample.vrm',
  man: '/avatars/anime-man-sample/Sakurada_Fumiriya.vrm',
};
const LOOKS = { woman: ['woman-1', 'woman-2'], man: ['man-1', 'man-2', 'man-3', 'man-4'] };

/** Pure: turn stored values into a valid choice (anything odd falls back to the 2D face). */
export function normaliseChosenFace(style, who, look) {
  const w = who === 'man' ? 'man' : 'woman';
  const st = style === 'anime3d' || style === 'realistic' ? style : '2d';
  const l = LOOKS[w].includes(look) ? look : LOOKS[w][0];
  return { style: st, who: w, look: l };
}
export function readChosenFace() {
  try {
    return normaliseChosenFace(
      localStorage.getItem('qk_aaria_stage_face'),
      localStorage.getItem('qk_aaria_stage_who'),
      localStorage.getItem('qk_aaria_stage_look2'),
    );
  } catch { return normaliseChosenFace(); }
}
/** Tell the dock the choice changed (the stage page calls this after saving). */
export function announceFaceChoice() {
  try { window.dispatchEvent(new Event('qk_aaria_face_changed')); } catch { }
}
