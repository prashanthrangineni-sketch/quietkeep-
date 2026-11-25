// Free and paid faces: the pure rule, the signup step, and the locks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { isPaidLook, allowedFace, ALL_LOOKS_FEATURE, saveChosenFace, normaliseChosenFace } = await import('../src/lib/avatar/face-pref.js');
let n = 0; const t = (name, fn) => { fn(); n++; };

t('2D and anime are free', () => {
  assert.equal(isPaidLook('2d', 'woman', 'woman-2'), false);
  assert.equal(isPaidLook('anime3d', 'man', 'man-3'), false);
});
t('saree and kurta looks are free (founder 25 Nov)', () => {
  assert.equal(isPaidLook('realistic', 'woman', 'woman-3'), false);
  assert.equal(isPaidLook('realistic', 'man', 'man-5'), false);
  assert.deepEqual(allowedFace({ style: 'realistic', who: 'man', look: 'man-5' }, false).look, 'man-5');
});
t('realistic Look 1 free, others paid', () => {
  assert.equal(isPaidLook('realistic', 'woman', 'woman-1'), false);
  assert.equal(isPaidLook('realistic', 'woman', 'woman-2'), true);
  assert.equal(isPaidLook('realistic', 'man', 'man-1'), false);
  for (const l of ['man-2', 'man-3', 'man-4']) assert.equal(isPaidLook('realistic', 'man', l), true);
});
t('free plan falls back to Look 1, paid keeps choice', () => {
  assert.deepEqual(allowedFace({ style: 'realistic', who: 'man', look: 'man-4' }, false), { style: 'realistic', who: 'man', look: 'man-1' });
  assert.deepEqual(allowedFace({ style: 'realistic', who: 'man', look: 'man-4' }, true), { style: 'realistic', who: 'man', look: 'man-4' });
  assert.deepEqual(allowedFace({ style: 'anime3d', who: 'woman', look: 'woman-1' }, false), normaliseChosenFace('anime3d', 'woman', 'woman-1'));
  assert.deepEqual(allowedFace(null, false), normaliseChosenFace());
});
t('saveChosenFace writes the three keys', () => {
  const store = {}; globalThis.localStorage = { setItem: (k, v) => { store[k] = v; }, getItem: (k) => store[k] ?? null };
  const c = saveChosenFace({ style: 'realistic', who: 'man', look: 'bogus' });
  assert.deepEqual(c, { style: 'realistic', who: 'man', look: 'man-1' });
  assert.equal(store.qk_aaria_stage_face, 'realistic'); assert.equal(store.qk_aaria_stage_who, 'man'); assert.equal(store.qk_aaria_stage_look2, 'man-1');
});
t('feature name is stable', () => assert.equal(ALL_LOOKS_FEATURE, 'aaria_face_all_looks'));

const ob = readFileSync(new URL('../src/app/onboarding/page.jsx', import.meta.url), 'utf8');
t('signup has a face step after voice, off by default', () => {
  assert.match(ob, /id: 'voice'[\s\S]*id: 'face'[\s\S]*id: 'persona'/);
  assert.match(ob, /useState\('none'\)/);
  assert.match(ob, /look: indian \? \(faceWhoNow === 'man' \? 'man-5' : 'woman-3'\) : `\$\{faceWhoNow\}-1`/); // Look 1, or the Indian look (master plan A2)
  for (let i = 0; i <= 6; i++) assert.match(ob, new RegExp(`step === ${i} `));
  assert.doesNotMatch(ob, /step === 7/);
});
const stage = readFileSync(new URL('../src/app/aaria-stage/page.jsx', import.meta.url), 'utf8');
const live = readFileSync(new URL('../src/components/avatar/AariaLiveFace.jsx', import.meta.url), 'utf8');
t('stage and panel respect the gate', () => {
  for (const s of [stage, live]) { assert.match(s, /useFeatureGate\(ALL_LOOKS_FEATURE\)/); assert.match(s, /!== 'LOCKED'/); }
  assert.match(stage, /router\.push\('\/pricing'\)/);
});
t('preview pictures exist and are small', () => {
  for (const f of ['anime-woman', 'anime-man', 'realistic-woman', 'realistic-man', 'realistic-indian-woman', 'realistic-indian-man']) {
    const b = readFileSync(new URL(`../public/avatars/previews/${f}.jpg`, import.meta.url));
    assert.ok(b.length > 2000 && b.length < 30000, f);
  }
});
console.log(`avatar-plans: ${n} passed`);
