// tests/step-log.test.mjs
// Verification for TASK AG-AARIA-37: 100-task phone step log
//
// Requirements:
// 1. Off by default writes nothing
// 2. On writes exactly the 8 fields with real level names
// 3. Export returns valid JSON lines
// 4. No audio stored (heard_text is transcribed text only)
// 5. Seamless integration with decide() and action levels

import {
  recordStep,
  getActiveRun,
  isRunActive,
  startRun,
  stopRun,
  getSteps,
  clearSteps,
  exportSteps,
  VALID_LEVELS,
  REQUIRED_FIELDS,
} from '../src/lib/step-log.js';

import { LEVEL, DECISION, decide, levelFor } from '../src/lib/action-levels.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

// Ensure clean slate
stopRun();
clearSteps();
delete process.env.QK_TASKS100_RUN;

// ── 1. Off by default writes nothing ─────────────────────────────────────────
check('off by default: isRunActive is false', isRunActive() === false);
check('off by default: getActiveRun returns null', getActiveRun() === null);

const offResult = recordStep({
  heard_text: 'remind me to call John at 5pm',
  decided_action: 'reminder',
  action_level: LEVEL.READ_BACK,
  decision: DECISION.DO,
});

check('off by default: recordStep returns null', offResult === null);
check('off by default: getSteps is empty', getSteps().length === 0);
check('off by default: exportSteps returns empty string', exportSteps() === '');

// ── 2. On writes exactly the 8 fields with real level names ─────────────────
const run = startRun('task-101');
check('startRun sets active run', isRunActive() === true);
check('getActiveRun returns task_id', getActiveRun()?.task_id === 'task-101');

const step1 = recordStep({
  heard_text: 'remind me to check stock',
  decided_action: 'reminder',
  level: LEVEL.READ_BACK,
  decision: DECISION.DO,
});

check('recorded step 1 is returned', step1 !== null);
check('step 1 has task_id', step1.task_id === 'task-101');
check('step 1 has step index 1', step1.step === 1);
check('step 1 has heard_text', step1.heard_text === 'remind me to check stock');
check('step 1 has decided_action', step1.decided_action === 'reminder');
check('step 1 has real action_level', step1.action_level === 'read_back');
check('step 1 asked_confirmation is false for DO decision', step1.asked_confirmation === false);
check('step 1 result is success', step1.result === 'success');
check('step 1 timestamps has start and end', typeof step1.timestamps?.start === 'string' && typeof step1.timestamps?.end === 'string');

// Verify exact 8 fields
const expectedKeys = [...REQUIRED_FIELDS].sort();
const actualKeys = Object.keys(step1).sort();
check(
  'step object contains EXACTLY the 8 required fields, no extra, no missing',
  actualKeys.length === 8 && actualKeys.every((k, i) => k === expectedKeys[i]),
  `keys: ${JSON.stringify(actualKeys)}`
);

// ── 3. Real action levels from action-levels.js ──────────────────────────────
const testCases = [
  { action: { type: 'reminder' }, expectedLevel: LEVEL.READ_BACK },
  { action: { type: 'navigation' }, expectedLevel: LEVEL.READ_BACK },
  { action: { type: 'contact', contactSaved: true }, expectedLevel: LEVEL.SPOKEN_YES },
  { action: { type: 'money_transfer' }, expectedLevel: LEVEL.PIN },
  { action: { type: 'delete_all' }, expectedLevel: LEVEL.NEVER },
  { action: { type: 'unknown_intent' }, expectedLevel: LEVEL.NEVER },
];

for (const tc of testCases) {
  const decisionResult = decide(tc.action, {}, { doneThisHour: 0 });
  const lvl = levelFor(tc.action);
  const recorded = recordStep({
    heard_text: 'sample test utterance',
    decided_action: tc.action.type,
    level: lvl,
    decision: decisionResult.decision,
  });

  check(
    `level for ${tc.action.type} is valid real level: ${recorded.action_level}`,
    VALID_LEVELS.has(recorded.action_level) && recorded.action_level === tc.expectedLevel
  );
}

// ── 4. Confirmation asked check with decide() ───────────────────────────────
const ctx = { doneThisHour: 0 };
const spokenYesDecide = decide({ type: 'contact', contactSaved: true }, {}, ctx); // no spoken proof -> ASK_YES
const spokenYesStep = recordStep({
  heard_text: 'call Ravi',
  decided_action: 'contact',
  level: levelFor({ type: 'contact', contactSaved: true }),
  decision: spokenYesDecide.decision,
});
check('spoken_yes without proof sets asked_confirmation to true', spokenYesStep.asked_confirmation === true);
check('spoken_yes without proof result is pending_confirmation', spokenYesStep.result === 'pending_confirmation');

const pinDecide = decide({ type: 'money_transfer' }, {}, ctx); // no pin proof -> ASK_PIN
const pinStep = recordStep({
  heard_text: 'transfer 500 to supplier',
  decided_action: 'money_transfer',
  level: LEVEL.PIN,
  decision: pinDecide.decision,
});
check('pin action without proof sets asked_confirmation to true', pinStep.asked_confirmation === true);
check('pin action without proof result is pending_confirmation', pinStep.result === 'pending_confirmation');

const neverDecide = decide({ type: 'delete_all' }, {}, ctx);
const neverStep = recordStep({
  heard_text: 'delete everything',
  decided_action: 'delete_all',
  level: LEVEL.NEVER,
  decision: neverDecide.decision,
});
check('never action sets asked_confirmation to false and result refused', neverStep.asked_confirmation === false && neverStep.result === 'refused');

// ── 5. Step number incrementation per task ──────────────────────────────────
clearSteps();
const s1 = recordStep({ heard_text: 'step one', decided_action: 'note' });
const s2 = recordStep({ heard_text: 'step two', decided_action: 'note' });
const s3 = recordStep({ heard_text: 'step three', decided_action: 'note' });
check('step numbering increments correctly: 1, 2, 3', s1.step === 1 && s2.step === 2 && s3.step === 3);

// ── 6. Export returns valid JSON lines ──────────────────────────────────────
const jsonLines = exportSteps();
const lines = jsonLines.trim().split('\n');
check('exportSteps returns non-empty string with correct line count', lines.length === 3);

let allValidJson = true;
for (const line of lines) {
  try {
    const parsed = JSON.parse(line);
    if (!parsed.task_id || !parsed.step || !parsed.heard_text) {
      allValidJson = false;
    }
    const keys = Object.keys(parsed).sort();
    if (keys.length !== 8 || !keys.every((k, i) => k === expectedKeys[i])) {
      allValidJson = false;
    }
  } catch {
    allValidJson = false;
  }
}
check('every exported line is valid JSON with exactly the 8 specification fields', allValidJson);

// ── 7. No raw audio stored ──────────────────────────────────────────────────
const allStoredSteps = getSteps();
let audioLeak = false;
for (const s of allStoredSteps) {
  for (const k of Object.keys(s)) {
    if (['audio', 'raw_audio', 'audio_base64', 'sound', 'blob', 'buffer', 'media'].includes(k.toLowerCase())) {
      audioLeak = true;
    }
  }
  if (typeof s.heard_text !== 'string') {
    audioLeak = true;
  }
}
check('strictly NO raw audio or binary data stored anywhere in steps', !audioLeak);

// ── 8. Stop run and clear steps ─────────────────────────────────────────────
stopRun();
check('stopRun turns off active run', isRunActive() === false);

const postStopStep = recordStep({ heard_text: 'should not be saved', decided_action: 'note' });
check('recordStep after stopRun writes nothing', postStopStep === null);

clearSteps();
check('clearSteps empties stored steps', getSteps().length === 0);
check('exportSteps after clear is empty string', exportSteps() === '');

// ── 9. Environment variable activation (for automated test runs) ────────────
process.env.QK_TASKS100_RUN = JSON.stringify({ task_id: 'task-env-99' });
check('env var QK_TASKS100_RUN activates run', isRunActive() === true);
check('env var task_id is correctly parsed', getActiveRun()?.task_id === 'task-env-99');

const envStep = recordStep({ heard_text: 'env test step', decided_action: 'reminder', level: 'read_back', decision: 'do' });
check('env run records step', envStep?.task_id === 'task-env-99');

delete process.env.QK_TASKS100_RUN;
check('cleaning env var deactivates run', isRunActive() === false);
clearSteps();

// ── 10. Server builds a step but stores nothing (persist:false) ─────────────
const serverStep = recordStep({ heard_text: 'server side', decided_action: 'note', run: { task_id: 'task-srv' }, persist: false });
check('persist:false still returns the step', serverStep?.task_id === 'task-srv');
check('persist:false stores nothing', getSteps().length === 0);

// ── 11. Phone re-numbers a step that came back from the server ──────────────
startRun('task-phone');
recordStep({ heard_text: 'first', decided_action: 'note' });
const fromServer = { ...serverStep, task_id: 'task-phone', step: 1 };
const renumbered = recordStep({ ...fromServer, step: undefined });
check('phone re-numbers server step (2, not 1)', renumbered.step === 2);
stopRun();
clearSteps();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
