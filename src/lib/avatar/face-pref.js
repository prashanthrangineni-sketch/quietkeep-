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
