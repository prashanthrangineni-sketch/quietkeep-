// tests/avatar-face.test.mjs
// AARIA demo faces: the rules that must hold whatever is drawn.
//   1. "done" only for a confirmed completed action - 20 scripted tasks,
//      5 of them forced failures.
//   2. The pose machine never celebrates a failure, a question, or a promise.
//   3. Mouth shapes come from the sound: silence closes the mouth.
//   4. Off by default, and wired without touching the microphone hand-over.

import { readFileSync } from 'node:fs';
import { outcomeFromCapture, outcomeFromClientAction, onOutcome, reportOutcome, _resetForTests } from '../src/lib/avatar/outcome.js';
import { createPoseMachine, FLASH_MS } from '../src/lib/avatar/pose.js';
import { shapesFromSpectrum, smoothShapes, cycleShapes, SILENT } from '../src/lib/avatar/mouth.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      expected: ${JSON.stringify(want)}`); console.log(`      got     : ${JSON.stringify(got)}`); fail++; }
  else pass++;
}

// ── 1. twenty scripted tasks ────────────────────────────────────────────────
// Each: what the server (or the phone) answered, and the only outcome allowed.
const ok = (json) => outcomeFromCapture(json, true).status;
const TASKS = [
  // completed: the server recorded success, or a saved row came back
  ['reminder saved',                     () => ok({ tts_response: 'Reminder set.', keep: { id: 'k1' }, step_record: { result: 'success' } }), 'completed'],
  ['note saved (row id only)',           () => ok({ tts_response: 'Noted.', keep: { id: 'k2' } }), 'completed'],
  ['task saved',                         () => ok({ keep: { id: 'k3' }, step_record: { result: 'success' } }), 'completed'],
  ['business attendance marked',         () => ok({ tts_response: 'Marked Ravi absent.', step_record: { result: 'success' } }), 'completed'],
  ['keep deleted after a yes',           () => ok({ step_record: { result: 'success' }, confirmed_by: 'spoken_yes' }), 'completed'],
  ['call: phone opened the dialler',     () => outcomeFromClientAction({ executed: true, action_taken: 'Calling Surya' }).status, 'completed'],
  ['navigation: phone opened Maps',      () => outcomeFromClientAction({ executed: true, action_taken: 'Opened Maps' }).status, 'completed'],
  // pending: understood, asked, or waiting - NOT done
  ['"Calling Surya now." before the phone dials', () => ok({ tts_response: 'Calling Surya now.', auto_exec: { intent_type: 'contact' }, step_record: { result: 'success' } }), 'pending'],
  ['asked "when should I remind you?"',  () => ok({ tts_response: 'When?', follow_up: { action_hint: 'ask_time' }, keep: { id: 'k4' } }), 'pending'],
  ['asked "which Venu?"',                () => ok({ choices: [{ name: 'Venu A' }, { name: 'Venu B' }] }), 'pending'],
  ['needs the phone unlocked',           () => ok({ needs_unlock: true, tts_response: 'Unlock your phone.' }), 'pending'],
  ['needs a fingerprint',                () => ok({ needs_biometric: true, auto_exec: { intent_type: 'pay' } }), 'pending'],
  ['waiting for a spoken yes',           () => ok({ step_record: { result: 'pending_confirmation' }, tts_response: 'Shall I delete it?' }), 'pending'],
  ['low confidence, asks to clarify',    () => ok({ needs_followup: true, clarification: 'Did you mean…?' }), 'pending'],
  // none: nothing to confirm
  ['a spoken answer with no action',     () => ok({ tts_response: 'It is 4 pm.' }), 'none'],
  // FORCED FAILURES: five ways it can go wrong - never "completed"
  ['FAIL: server returned an error status', () => outcomeFromCapture({ tts_response: 'Saved.' }, false).status, 'failed'],
  ['FAIL: no response body at all',      () => outcomeFromCapture(null, true).status, 'failed'],
  ['FAIL: body carries an error',        () => ok({ error: 'db_write_failed', tts_response: 'Saved.' }), 'failed'],
  ['FAIL: the safety table refused',     () => ok({ step_record: { result: 'refused' }, tts_response: 'I cannot do that.' }), 'failed'],
  ['FAIL: phone could not dial (no number)', () => outcomeFromClientAction({ executed: false, action_taken: 'No phone number' }).status, 'failed'],
];
eq('there are 20 scripted tasks, 5 of them forced failures',
  [TASKS.length, TASKS.filter(([n]) => n.startsWith('FAIL')).length], [20, 5]);
for (const [name, run, want] of TASKS) eq(`task: ${name}`, run(), want);
eq('ignored background talk is never an outcome, even if a saved row came back',
  outcomeFromCapture({ ignored: true, keep: { id: 'k9' }, step_record: { result: 'success' } }, true).status, 'none');
{
  // Keep-listening: a silent ignored turn goes thinking -> listening with no speech. No "done".
  let t = 0; const m = createPoseMachine({ now: () => t });
  m.setStatus('listening'); m.setStatus('thinking');
  m.setOutcome(outcomeFromCapture({ ignored: true, keep: { id: 'k9' } }, true));
  m.setStatus('idle'); m.setStatus('listening');
  eq('a silent ignored turn shows no done', m.pose(), 'listening');
}
eq('phone action that threw counts as failed', outcomeFromClientAction(null).status, 'failed');

// Run all 20 through the pose machine: "done" must appear exactly for the
// completed ones and for nothing else.
{
  const wrong = [];
  for (const [name, run, want] of TASKS) {
    let t = 0;
    const m = createPoseMachine({ now: () => t });
    m.setStatus('listening'); m.setStatus('thinking');
    const status = run();
    m.setOutcome({ status });
    m.setStatus('speaking');
    const duringSpeech = m.pose();
    m.setStatus('idle');
    const after = m.pose();
    if (duringSpeech !== 'speaking') wrong.push(`${name}: pose while speaking was ${duringSpeech}`);
    if ((after === 'done') !== (want === 'completed')) wrong.push(`${name}: after speech pose was ${after}`);
    if (want === 'failed' && after !== 'oops') wrong.push(`${name}: a failure showed ${after}`);
    t += FLASH_MS + 1;
    if (m.pose() !== 'idle') wrong.push(`${name}: flash did not end`);
  }
  eq('all 20 tasks: "done" shown only for confirmed completed actions', wrong, []);
}

// ── 2. the pose machine ─────────────────────────────────────────────────────
{
  let t = 0; const m = createPoseMachine({ now: () => t });
  eq('starts idle', m.pose(), 'idle');
  m.setOutcome({ status: 'pending' }); eq('pending shows nothing', m.pose(), 'idle');
  m.setOutcome({ status: 'none' }); eq('none shows nothing', m.pose(), 'idle');
  m.setOutcome({ status: 'completed' }); eq('completed while idle flashes done', m.pose(), 'done');
  t += FLASH_MS - 1; eq('done still showing just before the flash ends', m.pose(), 'done');
  t += 1; eq('done ends by itself', m.pose(), 'idle');

  m.setStatus('speaking'); m.setOutcome({ status: 'completed' });
  eq('never celebrates over her own sentence', m.pose(), 'speaking');
  m.setStatus('idle'); eq('shown once she stops', m.pose(), 'done');
  t += FLASH_MS + 1; eq('and it runs out', m.pose(), 'idle');

  // Keep-listening mode: the microphone reopens straight after the reply.
  m.setStatus('listening'); m.setStatus('thinking'); m.setOutcome({ status: 'completed' }); m.setStatus('speaking');
  m.setStatus('listening');
  eq('keep-listening: done is shown as the microphone reopens', m.pose(), 'done');
  t += FLASH_MS + 1; eq('keep-listening: then the face is listening', m.pose(), 'listening');
  m.setStatus('thinking'); m.setOutcome({ status: 'failed' }); m.setStatus('speaking'); m.setStatus('listening');
  eq('keep-listening: a failure shows oops, never done', m.pose(), 'oops');
  t += FLASH_MS + 1;
  m.setStatus('thinking'); m.setOutcome({ status: 'pending' }); m.setStatus('speaking'); m.setStatus('listening');
  eq('keep-listening: a question back shows no done', m.pose(), 'listening');
  m.setStatus('idle');

  // An outcome left queued is dropped when a fresh turn starts from rest.
  m.setStatus('thinking'); m.setOutcome({ status: 'completed' }); m.setStatus('idle'); t += FLASH_MS + 1;
  m.setStatus('listening'); eq('a turn started from rest shows no old celebration', m.pose(), 'listening');
  m.setStatus('idle'); eq('nothing left over after that turn', m.pose(), 'idle');

  m.setStatus('thinking'); m.setOutcome({ status: 'completed' }); m.setOutcome({ status: 'failed' });
  m.setStatus('idle');
  eq('a later failure replaces an earlier success', m.pose(), 'oops');
  m.setStatus('nonsense'); eq('an unknown status is treated as idle', m.pose() === 'done', false);
}
_resetForTests();
{
  const seen = [];
  onOutcome((o) => seen.push(o.status));
  reportOutcome({ status: 'none' }); reportOutcome(null); reportOutcome({ status: 'completed' });
  eq('"none" is never broadcast; real outcomes are', seen, ['completed']);
}

// ── 3. mouth from sound ─────────────────────────────────────────────────────
{
  const n = 256, rate = 48000, hz = rate / 2 / n;
  const spectrum = (fill) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = fill(i * hz); return b; };
  eq('silence closes the mouth', shapesFromSpectrum(spectrum(() => 0), rate), { ...SILENT });
  eq('no data closes the mouth', shapesFromSpectrum(null), { ...SILENT });
  const hiss = shapesFromSpectrum(spectrum(() => 6), rate);
  eq('faint background noise does not open the mouth', hiss.open, 0);
  const loud = shapesFromSpectrum(spectrum((f) => (f > 150 && f < 3000 ? 200 : 0)), rate);
  eq('speech-band sound opens the mouth', loud.open > 0.5, true);
  const lowV = shapesFromSpectrum(spectrum((f) => (f > 250 && f < 650 ? 220 : 10)), rate);
  const highV = shapesFromSpectrum(spectrum((f) => (f > 1900 && f < 3100 ? 220 : 10)), rate);
  eq('low sounds lean to "oh", high sounds to "ee"', [lowV.oh > lowV.ee, highV.ee > highV.oh], [true, true]);
  eq('every shape stays between 0 and 1', Object.values(loud).every((v) => v >= 0 && v <= 1), true);
  const eased = smoothShapes({ ...SILENT }, loud);
  eq('the mouth eases open, not snaps', eased.open > 0 && eased.open < loud.open, true);
  const c = [0, 40, 80, 120, 160, 200].map((t) => cycleShapes(t).open);
  eq('the fallback cycle moves and stays in range', [new Set(c.map((x) => x.toFixed(2))).size > 2, c.every((x) => x >= 0 && x <= 1)], [true, true]);
}

// ── 4. wiring ───────────────────────────────────────────────────────────────
{
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const pref = read('../src/lib/avatar/face-pref.js');
  eq('the face is on only when the stored value is exactly "1"', pref.includes("localStorage.getItem(KEY) === '1'"), true);
  const dock = read('../src/components/AariaDock.jsx');
  eq('dock draws the face only when switched on', dock.includes('{faceOn\n          ? <AariaFace status={status} size={56} />'), true);
  eq('dock keeps the plain microphone button otherwise', dock.includes("(listening ? '⏹' : thinking ? '…' : speaking ? '🔊' : '🎙️')"), true);
  eq('dock shows the chosen live face only when switched on', dock.includes('{faceOn && !onStagePage && (\n            <>\n              <AariaLiveFace status={status} height={190} />'), true);
  const live = read('../src/components/avatar/AariaLiveFace.jsx');
  eq('live face draws anime, realistic or 2D from the stored choice', ["style === 'anime3d' && <VrmStage", "style === 'realistic' && <HumanStage", '<AariaFace status={status}'].every((x) => live.includes(x)), true);
  eq('live face falls back to 2D when 3D fails or is too slow', live.includes("if (s === 'failed') setFallback(true)") && live.includes('f.medianFps < 12') && live.includes("const style = fallback ? '2d' : choice.style;"), true);
  eq('live face is driven by the dock status, so keep-listening moves it', live.includes('status={status}') && dock.includes('<AariaLiveFace status={status}'), true);
  {
    const { normaliseChosenFace, ANIME_MODELS } = await import('../src/lib/avatar/face-pref.js');
    eq('no stored choice falls back to the 2D face', normaliseChosenFace(null, null, null), { style: '2d', who: 'woman', look: 'woman-1' });
    eq('a stored realistic man keeps his look', normaliseChosenFace('realistic', 'man', 'man-3'), { style: 'realistic', who: 'man', look: 'man-3' });
    eq('a look from the other group is corrected', normaliseChosenFace('realistic', 'man', 'woman-2'), { style: 'realistic', who: 'man', look: 'man-1' });
    eq('nonsense falls back safely', normaliseChosenFace('<script>', 'x', 'y'), { style: '2d', who: 'woman', look: 'woman-1' });
    const { existsSync } = await import('node:fs');
    eq('both anime files the dock can load are in the app', Object.values(ANIME_MODELS).every((f) => existsSync(new URL('../public' + f, import.meta.url))), true);
  }
  eq('the face switch is in Aaria\'s own panel, where it can be found', dock.includes('data-testid="aaria-face-switch"') && dock.includes('onClick={() => setFaceOn(!faceOn)}') && dock.includes("'Show Aaria’s face'"), true);
  {
    // The smaller files must still hold every face shape the app moves.
    const { readFileSync: rf, readdirSync } = await import('node:fs');
    const glbJson = (path) => { const b = rf(new URL(path, import.meta.url)); const n = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + n).toString('utf8')); };
    const humanSrc = read('../src/components/avatar/HumanStage.jsx');
    const used = [...humanSrc.matchAll(/P \+ '([^']+)'/g)].map((m) => 'blendShape1.' + m[1]);
    const bad = [];
    for (const d of readdirSync(new URL('../public/avatars/realistic-rocketbox/', import.meta.url), { withFileTypes: true }).filter((x) => x.isDirectory())) {
      for (const fn of readdirSync(new URL(`../public/avatars/realistic-rocketbox/${d.name}/`, import.meta.url)).filter((x) => x.endsWith('.glb'))) {
        const j = glbJson(`../public/avatars/realistic-rocketbox/${d.name}/${fn}`);
        const have = new Set(j.meshes.flatMap((m) => (m.extras && m.extras.targetNames) || []));
        for (const u of used) if (!have.has(u)) bad.push(`${fn}: ${u}`);
      }
    }
    eq('every realistic file still has every face shape the app uses', [used.length >= 12, bad], [true, []]);
    for (const f of ['../public/avatars/anime-sample/VRM1_Constraint_Twist_Sample.vrm', '../public/avatars/anime-man-sample/Sakurada_Fumiriya.vrm']) {
      const j = glbJson(f);
      const ext = j.extensions || {};
      const meta = (ext.VRMC_vrm && ext.VRMC_vrm.meta) || (ext.VRM && ext.VRM.meta) || {};
      const hasMouth = ext.VRMC_vrm ? ['aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'happy'].every((k) => ext.VRMC_vrm.expressions.preset[k])
        : ['a', 'i', 'u', 'e', 'o', 'blink', 'joy'].every((k) => ext.VRM.blendShapeMaster.blendShapeGroups.some((g) => g.presetName === k));
      eq(`${f.split('/').pop()}: licence block and mouth shapes kept`, [!!(meta.licenseUrl || meta.licenseName), hasMouth], [true, true]);
    }
    const { statSync } = await import('node:fs');
    const sizes = ['../public/avatars/anime-sample/VRM1_Constraint_Twist_Sample.vrm', '../public/avatars/anime-man-sample/Sakurada_Fumiriya.vrm']
      .map((f) => statSync(new URL(f, import.meta.url)).size);
    eq('each anime file is under 6 MB', sizes.every((x) => x < 6 * 1024 * 1024), true);
    // What the page tells people about the download must match the real files.
    const dirSize = (d) => readdirSync(new URL(d, import.meta.url)).filter((x) => !x.endsWith('.md'))
      .reduce((n, x) => n + statSync(new URL(d + x, import.meta.url)).size, 0);
    const realistic = readdirSync(new URL('../public/avatars/realistic-rocketbox/', import.meta.url), { withFileTypes: true })
      .filter((x) => x.isDirectory()).map((x) => dirSize(`../public/avatars/realistic-rocketbox/${x.name}/`));
    eq('every realistic look is under 1.5 MB, as the page says', realistic.every((x) => x > 0.7 * 1024 * 1024 && x < 1.5 * 1024 * 1024), true);
    eq('every anime face is about 5 MB, as the page says', sizes.every((x) => x > 4 * 1024 * 1024 && x < 6 * 1024 * 1024), true);
  }
  const face = read('../src/components/AariaFace.jsx');
  eq('2D face takes "done" from the pose machine only', face.includes("const happy = pose === 'done';") && !/tts_response|useAaria\(/.test(face), true);
  const stage = read('../src/app/aaria-stage/page.jsx');
  eq('3D engine is loaded only when the stage asks for it', stage.includes("dynamic(() => import('@/components/avatar/VrmStage'), { ssr: false })"), true);
  eq('realistic people are labelled as game-style characters, not real people',
    stage.includes('like game characters; not real people'), true);
  const human = read('../src/components/avatar/HumanStage.jsx');
  eq('the person can pick a woman or a man', ["{ id: 'woman', label: 'Woman' }", "{ id: 'man', label: 'Man' }"].every((x) => stage.includes(x)), true);
  eq('realistic looks are numbered, never labelled by origin', /label: '(Indian|Western|Arab|Asian|African)'/.test(stage), false);
  eq('saree and kurta looks are offered by their clothing, and "coming next" is gone', stage.includes("{ id: 'woman-3', label: 'Saree' }") && stage.includes("{ id: 'man-5', label: 'Kurta' }") && !stage.includes('Coming next'), true);
  {
    const { existsSync } = await import('node:fs');
    const ids = [...human.matchAll(/dir: '([^']+)', model: '([^']+)', tex: '([^']+)'/g)];
    const missing = ids.flatMap(([, dir, model, tex]) => [dir + model, `${dir}${tex}_head_color.jpg`, `${dir}${tex}_body_color.jpg`])
      .filter((f) => !existsSync(new URL('../public' + f, import.meta.url)));
    eq('every realistic look has its model and colour pictures in the app', [ids.length, missing], [8, []]);
  }
  const man = read('../public/avatars/anime-man-sample/LICENCE.md');
  eq('the anime man has his licence beside him', man.includes('CC0') && man.includes('d8fb05f33e377df028cb6b9d58c441ce68326c41fa23f6c735d40c65ae3dc710'), true);
  eq('realistic smile comes from the pose machine only', human.includes("smile: p === 'done' ? 0.9 : 0,"), true);
  const rb = read('../public/avatars/realistic-rocketbox/LICENCE.md');
  eq('the realistic character has its licence beside it', rb.includes('MIT') && rb.includes('0236707bb4a42b1a56ca221ad45c4254a0b69cbc4d647b399de0d541102807a4') && rb.includes('35df2eea5a5eb16913a5367ac419cac47bbdea2862b2be308c9f98f2c4570301') && rb.includes('7fad7a688357a69f8083859a7c5d05c56a98d40364d7fe80c04eca19a14ced3c')
    && read('../public/avatars/realistic-rocketbox/ROCKETBOX-MIT-LICENSE.md').includes('Copyright (c) 2020 Microsoft'), true);
  const vrm = read('../src/components/avatar/VrmStage.jsx');
  eq('3D "happy" comes from the pose machine only', vrm.includes("happy: p === 'done' ? 1 : 0,"), true);
  const aaria = read('../src/lib/context/aaria.jsx');
  eq('an ignored turn leaves before any outcome is reported',
    aaria.indexOf('if (json.ignored) {') > 0 && aaria.indexOf('if (json.ignored) {') < aaria.indexOf('reportOutcome(outcomeFromCapture(json, true));'), true);
  eq('outcome is read from the response, not the reply text', aaria.includes('reportOutcome(outcomeFromCapture(json, true));'), true);
  eq('phone action reports only after it ran', aaria.includes('reportOutcome(outcomeFromClientAction(done));'), true);
  eq('microphone hand-over estimate unchanged', aaria.includes("const est = Math.min(20000, 1200 + String(text || '').length * 75);"), true);
  eq('follow-up wait unchanged', aaria.includes('if (isSpeaking() && waited < 25000) return;'), true);
  for (const banned of ['live2d', 'cubism', '@rive-app', 'rive-react']) {
    eq(`no ${banned} anywhere in package.json`, read('../package.json').toLowerCase().includes(banned), false);
  }
  const lic = read('../public/avatars/anime-sample/LICENCE.md');
  eq('the character file has its licence beside it', lic.includes('VRM Public License 1.0') && lic.includes('12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
// 25 Nov: the kurta look shows hair, not a cap edge (cap points pulled inside the head).
{
  const fs = await import('node:fs');
  const lic = fs.readFileSync(new URL('../public/avatars/realistic-rocketbox/LICENCE.md', import.meta.url), 'utf8');
  if (!/cap's 172 points pulled inside the head/.test(lic) || !fs.existsSync(new URL('../scripts/avatar-kurta-hair.py', import.meta.url))) { console.error('kurta hair record missing'); process.exit(1); }
  console.log('kurta hair: recorded');
}
