// Master plan A5: a slow or broken face never holds up the conversation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const live = readFileSync(new URL('../src/components/avatar/AariaLiveFace.jsx', import.meta.url), 'utf8');
const vrm = readFileSync(new URL('../src/components/avatar/VrmStage.jsx', import.meta.url), 'utf8');
const human = readFileSync(new URL('../src/components/avatar/HumanStage.jsx', import.meta.url), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; };
t('the simple face shows while a 3D face downloads', () => {
  assert.match(live, /const showSimple = style === '2d' \|\| \(is3d && stage !== 'ready'\);/);
  assert.match(live, /opacity: stage === 'ready' \? 1 : 0/);
});
t('a broken file falls back at once', () => assert.match(live, /if \(s === 'failed'\) setFallback\(true\);/));
t('too slow: 2 readings in a row under 12 fps (about 2 s)', () => {
  assert.match(live, /f\.medianFps < 12/);
  assert.match(live, /slow\.current >= 2/);
});
t('a face that stops drawing falls back after 2.5 s', () => assert.match(live, /Date\.now\(\) - lastFps\.current > 2500/));
t('both stages report every second even when frames are few', () => {
  for (const s of [vrm, human]) { assert.match(s, /nowMs - lastReport > 900 && frames\.length >= 3/); assert.match(s, /frames\.slice\(-60\)/); }
});
console.log(`avatar-never-break: ${n} passed`);
