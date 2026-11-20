// Face choice follows the account: pure rules + wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/lib/avatar/face-sync.js', import.meta.url), 'utf8');
// Load only the pure part (the module imports React and Supabase).
const pure = src.slice(src.indexOf('/** Pure: what is stored'), src.indexOf('function phoneHasChoice'));
const { normaliseChosenFace } = await import('../src/lib/avatar/face-pref.js');
const m = new Function('normaliseChosenFace', pure.replace(/export function/g, 'function') + '; return { toAccountValue, fromAccountValue, decideSync };')(normaliseChosenFace);
let n = 0; const t = (name, fn) => { fn(); n++; };
t('only four safe fields are stored', () => {
  assert.deepEqual(m.toAccountValue(1, { style: 'realistic', who: 'man', look: 'man-3', extra: 'x' }), { on: true, style: 'realistic', who: 'man', look: 'man-3' });
  assert.deepEqual(m.toAccountValue(false, { style: 'evil', who: '?', look: 'z' }), { on: false, style: '2d', who: 'woman', look: 'woman-1' });
});
t('stored values are checked before use', () => {
  assert.equal(m.fromAccountValue(null), null);
  assert.equal(m.fromAccountValue({ style: 'anime3d' }), null);
  assert.deepEqual(m.fromAccountValue({ on: true, style: 'anime3d', who: 'man', look: 'man-9' }), { on: true, style: 'anime3d', who: 'man', look: 'man-1' });
});
t('new phone takes the account; first time saves the phone; same = nothing', () => {
  const a = { on: true, style: 'anime3d', who: 'man', look: 'man-1' };
  const l = { on: false, style: '2d', who: 'woman', look: 'woman-1' };
  assert.equal(m.decideSync(l, a, false), 'use_account');
  assert.equal(m.decideSync(l, null, true), 'save_phone');
  assert.equal(m.decideSync(a, a, true), 'nothing');
  assert.equal(m.decideSync(l, a, true), 'save_phone');
  assert.equal(m.decideSync(l, null, false), 'nothing');
});
t('missing column = quiet, writes only after a successful read, debounced', () => {
  assert.match(src, /if \(error \|\| stopped\) return;/);
  assert.match(src, /if \(!working \|\| stopped\) return;/);
  assert.match(src, /setTimeout\(save, 1500\)/);
  assert.match(src, /\.update\(\{ aaria_face: local\(\) \}\)\.eq\('user_id', userId\)/);
});
const dock = readFileSync(new URL('../src/components/AariaDock.jsx', import.meta.url), 'utf8');
t('dock mounts the sync once with the signed-in id', () => assert.match(dock, /useFaceAccountSync\(auth\?\.user\?\.id \|\| null\)/));
console.log(`avatar-face-sync: ${n} passed`);
