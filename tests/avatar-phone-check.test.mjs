// Phone check on the faces page: pure helpers and page wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { CHECK_FACES, verdict, mouthWord, summariseCheck, SMOOTH_FPS, USABLE_FPS } = await import('../src/lib/avatar/phone-check.js');
let n = 0; const t = (name, fn) => { fn(); n++; };

t('checks all 8 3D faces, the founder picks included', () => {
  assert.equal(CHECK_FACES.length, 8);
  assert.deepEqual(CHECK_FACES.filter((f) => f.style === 'realistic').map((f) => f.look), ['woman-1', 'woman-2', 'man-1', 'man-2', 'man-3', 'man-4']);
});
t('verdict thresholds match the panel fallback', () => {
  assert.equal(USABLE_FPS, 12);
  assert.equal(verdict({ medianFps: 60 }), 'smooth');
  assert.equal(verdict({ medianFps: SMOOTH_FPS }), 'smooth');
  assert.equal(verdict({ medianFps: 20 }), 'usable');
  assert.equal(verdict({ medianFps: 11 }), 'too slow');
  assert.equal(verdict(null), 'no reading');
});
t('mouth words never claim lip-sync without audio', () => {
  assert.equal(mouthWord({ heard: true, audio: true }), 'lips followed her voice');
  assert.equal(mouthWord({ heard: true, cycle: true }), 'lips moved (simple open-close)');
  assert.equal(mouthWord({ heard: true }), 'sound played, lips did not move');
  assert.equal(mouthWord({ heard: false, audio: true }), 'no sound reached the page');
  assert.equal(mouthWord(undefined), 'no sound reached the page');
});
t('summary text has every face and voice', () => {
  const txt = summariseCheck({ device: 'Phone X', startedAt: 0, endedAt: 181000,
    faces: [{ name: 'Anime woman', loadSeconds: 1.5, rest: { medianFps: 60, worstFrameMs: 42 }, speaking: { medianFps: 58, worstFrameMs: 50 }, mouth: { heard: true, audio: true } }, { name: 'Realistic man 4', error: 'no picture within 60 s' }],
    voices: [{ label: 'English', mouth: { heard: true, audio: true } }] });
  assert.match(txt, /Anime woman: 60 \/ 58 fps; slowest 42 \/ 50 ms; loaded in 1.5 s; smooth; lips followed her voice/);
  assert.match(txt, /Realistic man 4: FAILED \(no picture within 60 s\)/);
  assert.match(txt, /- English: lips followed her voice/);
  assert.match(txt, /Took 181 s/);
});
const page = readFileSync(new URL('../src/app/aaria-stage/page.jsx', import.meta.url), 'utf8');
t('page has the check, does not save the faces it cycles, and puts the face back', () => {
  assert.match(page, /data-testid="phone-check-run"/);
  const body = page.slice(page.indexOf('const runCheck'), page.indexOf('const card ='));
  assert.doesNotMatch(body, /pick\(|pickWho\(|pickLook\(|localStorage/);
  assert.match(body, /setFace\(saved\.face\); setWho\(saved\.who\); setLook\(saved\.look\)/);
});
console.log(`avatar-phone-check: ${n} passed`);
