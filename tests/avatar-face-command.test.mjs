// "Change your face" by voice: parser, resolver, apply, and the hook.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const store = {}; globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.window = { dispatchEvent() { }, addEventListener() { }, removeEventListener() { } };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.Event = class { constructor(t) { this.type = t; } };
const { parseFaceCommand, resolveFaceCommand, handleFaceCommand } = await import('../src/lib/avatar/face-command.js');
const { readChosenFace, isFaceOn } = await import('../src/lib/avatar/face-pref.js');
let n = 0; const t = (name, fn) => { fn(); n++; };

t('not face requests go to the brain', () => {
  for (const s of ['remind me to call mom at 5', 'what is the weather', 'add milk to my list', 'I need to wash my face tomorrow morning at 7 and then go to the gym and also remember to buy soap for the trip', 'what does a realistic painting look like?', 'remind me to look for real estate agents', 'look up the anime festival dates'])
    assert.equal(parseFaceCommand(s), null, s);
});
t('english requests', () => {
  assert.deepEqual(parseFaceCommand('change your face to the man'), { who: 'man' });
  assert.deepEqual(parseFaceCommand('show the realistic face'), { style: 'realistic' });
  assert.deepEqual(parseFaceCommand('switch to anime woman face'), { style: 'anime3d', who: 'woman' });
  assert.deepEqual(parseFaceCommand('use the simple face'), { style: '2d' });
  assert.deepEqual(parseFaceCommand('hide your face'), { hide: true });
  assert.deepEqual(parseFaceCommand('show your face'), { show: true });
  assert.deepEqual(parseFaceCommand('realistic man look 3'), { style: 'realistic', who: 'man', lookNo: 3 });
  assert.deepEqual(parseFaceCommand('change the face'), { ask: true });
});
t('hindi and telugu requests', () => {
  assert.deepEqual(parseFaceCommand('चेहरा बदलो आदमी वाला'), { who: 'man' });
  assert.deepEqual(parseFaceCommand('chehra hatao'), { hide: true });
  assert.deepEqual(parseFaceCommand('ముఖం మార్చు అబ్బాయి'), { who: 'man' });
  assert.deepEqual(parseFaceCommand('anime ముఖం చూపించు'), { style: 'anime3d' });
});
t('resolve keeps what was not asked and guards look numbers', () => {
  const cur = { style: 'anime3d', who: 'woman', look: 'woman-1' };
  assert.deepEqual(resolveFaceCommand({ who: 'man' }, cur, 'en').choice, { style: 'anime3d', who: 'man', look: 'man-1' });
  assert.deepEqual(resolveFaceCommand({ style: 'realistic' }, cur, 'en').choice, { style: 'realistic', who: 'woman', look: 'woman-1' });
  const r = resolveFaceCommand({ who: 'woman', lookNo: 4 }, cur, 'hi-IN');
  assert.deepEqual(r.choice, { style: 'realistic', who: 'woman', look: 'woman-1' }); assert.match(r.reply, /लुक 1/);
  assert.deepEqual(resolveFaceCommand({ who: 'man' }, { style: '2d', who: 'woman', look: 'woman-1' }, 'en').choice.style, 'anime3d');
  assert.equal(resolveFaceCommand({ hide: true }, cur, 'te-IN').on, false);
  assert.match(resolveFaceCommand({ ask: true }, cur, 'en').reply, /Which face/);
});
t('apply changes this phone only', () => {
  assert.match(handleFaceCommand('change your face to realistic man', 'en-IN'), /Done/);
  assert.deepEqual(readChosenFace(), { style: 'realistic', who: 'man', look: 'man-1' });
  assert.equal(isFaceOn(), true);
  assert.match(handleFaceCommand('hide your face', 'en-IN'), /hidden/);
  assert.equal(isFaceOn(), false);
  assert.equal(handleFaceCommand('remind me at 5', 'en-IN'), null);
});
const src = readFileSync(new URL('../src/lib/context/aaria.jsx', import.meta.url), 'utf8');
t('hook runs before the brain call and never reaches the server', () => {
  const a = src.indexOf('const askBrain'); const hook = src.indexOf('handleFaceCommand(text', a); const fetchAt = src.indexOf("fetch('/api/voice/capture'", a);
  assert.ok(hook > a && hook < fetchAt);
  assert.ok(hook < src.indexOf('brainBusyRef.current += 1', a));
});
console.log(`avatar-face-command: ${n} passed`);
// 23 Nov: the Indian looks by name
{
  const { parseFaceCommand: p, resolveFaceCommand: r } = await import('../src/lib/avatar/face-command.js');
  assert.deepEqual(p('show the saree face'), { style: 'realistic', who: 'woman', lookNo: 3 });
  assert.deepEqual(p('change your face to kurta'), { style: 'realistic', who: 'man', lookNo: 5 });
  assert.deepEqual(p('साड़ी वाला चेहरा दिखाओ'), { style: 'realistic', who: 'woman', lookNo: 3 });
  assert.equal(p('buy a new saree for diwali'), null);
  assert.deepEqual(r({ style: 'realistic', who: 'man', lookNo: 5 }, { style: '2d', who: 'woman', look: 'woman-1' }, 'en').choice, { style: 'realistic', who: 'man', look: 'man-5' });
  console.log('avatar-face-command: indian looks passed');
}
