// Body movement for the 3D faces: rules and limits (founder 22 Nov: "with motion").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { createGestures, WAVE_SECONDS } = await import('../src/lib/avatar/gestures.js');
let n = 0; const t = (name, fn) => { fn(); n++; };
const run = (g, pose, from, to, talk = 0, dt = 1 / 30) => { let last; for (let x = from; x < to; x += dt) last = g(pose, x, dt, talk); return last; };

t('wave only when she starts listening after idle, at most every 30 s', () => {
  assert.equal(WAVE_SECONDS, 1.8);
  const g = createGestures();
  run(g, 'idle', 0, 1);
  assert.equal(g('listening', 1.0, 1 / 30).waving, true);
  assert.equal(run(g, 'listening', 1.0, 3.0).waving, false);
  run(g, 'idle', 3, 4);
  assert.equal(g('listening', 4, 1 / 30).waving, false);          // too soon
  run(g, 'idle', 4, 40);
  assert.equal(g('listening', 40, 1 / 30).waving, true);           // 30 s later
  const g2 = createGestures(); run(g2, 'speaking', 0, 1);
  assert.equal(g2('listening', 1, 1 / 30).waving, false);          // after speaking: no wave
});
t('nod only for done, head shake only for oops', () => {
  for (const pose of ['idle', 'listening', 'thinking']) {
    const g = createGestures(); const r = run(g, pose, 0, 0.6);
    assert.equal(r.nod, 0, pose); assert.equal(r.shake, 0, pose);
  }
  const d = createGestures(); run(d, 'idle', 0, 1); const rd = run(d, 'done', 1, 1.25);
  assert.ok(rd.nod > 0.05); assert.equal(rd.shake, 0);
  const o = createGestures(); run(o, 'idle', 0, 1); const ro = run(o, 'oops', 1, 1.12);
  assert.ok(Math.abs(ro.shake) > 0.01); assert.equal(ro.nod, 0);
});
t('hands move with her voice and rest when quiet', () => {
  const g = createGestures(); run(g, 'idle', 0, 1);
  const vals = []; for (let x = 1; x < 4; x += 1 / 30) vals.push(g('speaking', x, 1 / 30, 0.6).left.bend);
  assert.ok(Math.max(...vals) - Math.min(...vals) > 0.3);
  const q = createGestures(); run(q, 'idle', 0, 1);
  const quiet = []; for (let x = 1; x < 4; x += 1 / 30) quiet.push(q('speaking', x, 1 / 30, 0).left.bend);
  assert.ok(Math.max(...quiet.slice(30)) - Math.min(...quiet.slice(30)) < 0.01);
});
t('thinking raises one hand toward the face', () => {
  const g = createGestures(); const r = run(g, 'thinking', 0, 2);
  assert.ok(r.right.bend > 1.5 && r.right.lift > 0.4 && r.left.bend < 0.5);
});
t('all angles stay small and finite', () => {
  const g = createGestures(); let x = 0;
  for (const pose of ['idle', 'listening', 'speaking', 'thinking', 'done', 'oops', 'idle', 'listening']) {
    for (let k = 0; k < 90; k++, x += 1 / 30) {
      const r = g(pose, x, 1 / 30, Math.random());
      for (const v of [r.left.lift, r.left.out, r.left.bend, r.right.lift, r.right.out, r.right.bend, r.right.swing, r.nod, r.shake, r.chest]) {
        assert.ok(Number.isFinite(v) && Math.abs(v) < 2.6);
      }
    }
  }
});
const vrm = readFileSync(new URL('../src/components/avatar/VrmStage.jsx', import.meta.url), 'utf8');
const human = readFileSync(new URL('../src/components/avatar/HumanStage.jsx', import.meta.url), 'utf8');
t('both 3D stages use the gestures and carry no test hooks', () => {
  for (const s of [vrm, human]) { assert.match(s, /createGestures\(\)/); assert.doesNotMatch(s, /__qkPoseOverride|__qkBoneDebug|__qkSceneYaw|__qkGesture/); }
});
console.log(`avatar-gestures: ${n} passed`);
