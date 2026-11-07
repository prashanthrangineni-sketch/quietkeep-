// tests/tasks100-guided.test.mjs
// Verification for Card AG-V5: guided 100-task run
//
// Required tests:
// 1. Next/skip/back/resume order
// 2. Export rows match the existing jsonl format and include the task ID
// 3. Contact-name substitution
// 4. The JSON has 100 unique IDs matching make_tasks100.py

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  getTasksList,
  substituteContactNames,
  getNextIndex,
  getPrevIndex,
  getSkipIndex,
  formatProgress,
  computeRunSummary,
  STANDARD_CONTACT_KEYS,
} from '../src/lib/tasks100-guided.js';

import {
  startRun,
  stopRun,
  recordStep,
  getSteps,
  clearSteps,
  exportSteps,
  REQUIRED_FIELDS,
} from '../src/lib/step-log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  ok ? pass++ : fail++;
}

console.log('── Guided 100-Task Run Unit Tests (Card AG-V5) ──\n');

// ── 1. The JSON has 100 unique IDs matching make_tasks100.py ──────────────────
console.log('1. Task List Integrity & Matching make_tasks100.py');

const jsonPath = path.join(REPO_ROOT, 'src', 'data', 'tasks100.json');
check('src/data/tasks100.json exists on disk', fs.existsSync(jsonPath));

const tasksRaw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const tasks = getTasksList(tasksRaw);

check('JSON contains exactly 100 tasks', tasks.length === 100, `got ${tasks.length}`);

const uniqueIds = new Set(tasks.map(t => t.id));
check('All 100 task IDs are unique', uniqueIds.size === 100, `got ${uniqueIds.size}`);

// Verify against local copy of make_tasks100.py in pranix-aaria
const pyCmd = `python -c "import sys, json; sys.path.append(r'C:\\Users\\ADMIN\\pranix-aaria\\scripts\\measure'); import make_tasks100; json.dump([t['id'] for t in make_tasks100.T], sys.stdout)"`;
// Always: compare against the committed reference list (works on GitHub too).
const fixture = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'tasks100-ids.json'), 'utf-8'));
const refIds = fixture.ids;
check('Reference list has 100 unique IDs', refIds.length === 100 && new Set(refIds).size === 100, `got ${refIds.length}`);
check('Every task ID and order matches the committed reference list',
  tasks.length === refIds.length && tasks.every((t, i) => t.id === refIds[i]));

// Only on the founder's laptop, where the engine repo exists: also check live.
const aariaDir = 'C:\\Users\\ADMIN\\pranix-aaria\\scripts\\measure';
if (fs.existsSync(aariaDir)) {
  let aariaIds = [];
  try {
    aariaIds = JSON.parse(execSync(pyCmd, { encoding: 'utf-8' }));
  } catch (e) {
    console.error('Failed to query make_tasks100.py:', e);
  }
  check('make_tasks100.py loaded 100 reference IDs', aariaIds.length === 100);
  check('Every single task ID and order exactly matches make_tasks100.py',
    tasks.every((t, i) => t.id === aariaIds[i]));
} else {
  console.log('SKIP  live check against make_tasks100.py (pranix-aaria folder not on this machine; committed reference list used instead)');
}

// Check self-documenting generation note
check('JSON contains generation note mentioning commit',
  typeof tasks[0]._generator_note === 'string' &&
  tasks[0]._generator_note.includes('make_tasks100.py') &&
  tasks[0]._generator_commit === '80f28a182dd93fe727c4100bd7aa076728241059'
);

// Check task shapes
const shapesValid = tasks.every(t =>
  t.id && t.lang && t.say && t.category && t.expect && t.risk && t.wrong_if
);
check('All 100 tasks have required schema fields (id, lang, say, category, expect, risk, wrong_if)', shapesValid);

// ── 2. Next / Skip / Back / Resume Order ───────────────────────────────────────
console.log('\n2. Next / Skip / Back / Resume Navigation Order');

let idx = 0; // Starts at Task 1 (index 0)
check('Initial progress is "Task 1 of 100"', formatProgress(idx, 100) === 'Task 1 of 100');

// Next moves 0 -> 1 -> 2
idx = getNextIndex(idx, 100);
check('Next from index 0 moves to index 1', idx === 1);
check('Progress at index 1 is "Task 2 of 100"', formatProgress(idx, 100) === 'Task 2 of 100');

idx = getNextIndex(idx, 100);
check('Next from index 1 moves to index 2', idx === 2);

// Back moves 2 -> 1 -> 0 -> 0 (clamped)
idx = getPrevIndex(idx);
check('Back from index 2 moves to index 1', idx === 1);

idx = getPrevIndex(idx);
check('Back from index 1 moves to index 0', idx === 0);

idx = getPrevIndex(idx);
check('Back at index 0 stays clamped at index 0', idx === 0);

// Skip moves to next
idx = getSkipIndex(idx, 100);
check('Skip from index 0 moves to index 1', idx === 1);

// Resume from middle (e.g. paused at Task 37, which is index 36)
const pausedIndex = 36;
check('Resume index 36 corresponds to "Task 37 of 100"', formatProgress(pausedIndex, 100) === 'Task 37 of 100');
check('Task at index 36 has stable ID and say', tasks[pausedIndex].id && tasks[pausedIndex].say);

// Boundary clamping at end
idx = 99; // Last task (Task 100 of 100)
check('Index 99 format is "Task 100 of 100"', formatProgress(idx, 100) === 'Task 100 of 100');

idx = getNextIndex(idx, 100);
check('Next from last task reaches completion index 100', idx === 100);
check('Progress at index 100 is Complete', formatProgress(idx, 100) === 'Complete (100 of 100)');

// ── 3. Contact-Name Substitution ──────────────────────────────────────────────
console.log('\n3. Contact-Name Substitution');

// Defaults stay as in the task list until set
check('Default substitution with empty map leaves "call mom" untouched',
  substituteContactNames('call mom', {}) === 'call mom'
);

check('Default substitution with null map leaves text untouched',
  substituteContactNames('call mom', null) === 'call mom'
);

check('Default substitution with default value "Mom" leaves "call mom" untouched',
  substituteContactNames('call mom', { Mom: 'Mom' }) === 'call mom'
);

// Mom -> Amma
check('Mom -> Amma replaces English "call mom" with "call Amma"',
  substituteContactNames('call mom', { Mom: 'Amma' }) === 'call Amma'
);

check('Mom -> Amma is case-insensitive on key: { mom: "Amma" } replaces "call mom"',
  substituteContactNames('call mom', { mom: 'Amma' }) === 'call Amma'
);

check('Mom -> Amma replaces Telugu "అమ్మకు ఫోన్ చెయ్యి" with "Ammaకు ఫోన్ చెయ్యి"',
  substituteContactNames('అమ్మకు ఫోన్ చెయ్యి', { Mom: 'Amma' }) === 'Ammaకు ఫోన్ చెయ్యి'
);

// Word boundary check: "moment" or "tomorrow" does not replace "mom"
check('Word boundary prevents partial replacement: "moment" does not become "Ammament"',
  substituteContactNames('wait a moment', { Mom: 'Amma' }) === 'wait a moment'
);

// Surya Kiran -> Kiran
check('Surya Kiran -> Kiran replaces "call Surya Kiran"',
  substituteContactNames('call Surya Kiran', { 'Surya Kiran': 'Kiran' }) === 'call Kiran'
);

check('Surya Kiran -> Kiran replaces Telugu "సూర్య కిరణ్ కి కాల్ చెయ్యి"',
  substituteContactNames('సూర్య కిరణ్ కి కాల్ చెయ్యి', { 'Surya Kiran': 'Kiran' }) === 'Kiran కి కాల్ చెయ్యి'
);

// Venu -> Venu Office
check('Venu -> Venu Office replaces "call Venu"',
  substituteContactNames('call Venu', { Venu: 'Venu Office' }) === 'call Venu Office'
);

// Gautam -> Gautam B
check('Gautam -> Gautam B replaces Hindi "गौतम को फ़ोन करो"',
  substituteContactNames('गौतम को फ़ोन करो', { Gautam: 'Gautam B' }) === 'Gautam B को फ़ोन करो'
);

// Multiple substitutions in one utterance
const multiSub = substituteContactNames('Ravi and Mom called', { Ravi: 'Ravinder', Mom: 'Amma' });
check('Multiple substitutions work in single sentence', multiSub === 'Ravinder and Amma called');

// ── 4. Export Rows Match Existing JSONL Format & Carry Task ID ─────────────────
console.log('\n4. Export Rows Match Existing JSONL Format & Carry Task ID');

// Reset step-log state
stopRun();
clearSteps();

// Simulate guided execution of first 3 tasks
const guidedRunSteps = [
  { taskId: 'en-rem-01', heard: 'remind me to buy milk at 6 pm', action: 'set_reminder', level: 'read_back', result: 'success' },
  { taskId: 'en-rem-02', heard: 'remind me to call the plumber tomorrow morning', action: 'set_reminder', level: 'read_back', result: 'success' },
  { taskId: 'en-call-01', heard: 'call Surya Kiran', action: 'place_call', level: 'spoken_yes', asked: true, result: 'pending_confirmation' },
];

for (const item of guidedRunSteps) {
  startRun(item.taskId);
  recordStep({
    heard_text: item.heard,
    decided_action: item.action,
    action_level: item.level,
    asked_confirmation: item.asked || false,
    result: item.result,
  });
}

const recordedSteps = getSteps();
check('Recorded 3 guided steps', recordedSteps.length === 3);

const exportedJsonl = exportSteps();
check('exportSteps returns non-empty string', exportedJsonl.length > 0);

const lines = exportedJsonl.trim().split('\n');
check('Exported lines count matches recorded steps (3)', lines.length === 3);

let allLinesValid = true;
let allCarryCorrectTaskId = true;
let allMatchRequiredSchema = true;

lines.forEach((lineStr, i) => {
  try {
    const obj = JSON.parse(lineStr);
    if (obj.task_id !== guidedRunSteps[i].taskId) allCarryCorrectTaskId = false;
    for (const f of REQUIRED_FIELDS) {
      if (!(f in obj)) allMatchRequiredSchema = false;
    }
    if (Object.keys(obj).length !== 8) allMatchRequiredSchema = false;
  } catch {
    allLinesValid = false;
  }
});

check('Every exported line is valid JSON', allLinesValid);
check('Every exported row carries the exact task_id of that guided task', allCarryCorrectTaskId);
check('Every row contains exactly the 8 specification fields defined in docs/TASKS100_RECORDER.md', allMatchRequiredSchema);

// ── 5. Run Summary Calculation ────────────────────────────────────────────────
console.log('\n5. Run Summary Calculation');

const summary = computeRunSummary(tasks, recordedSteps);
check('Summary reports total 100 tasks', summary.totalTasks === 100);
check('Summary reports 3 measured tasks', summary.measuredCount === 3);
check('Summary reports 97 unmeasured tasks', summary.unmeasuredCount === 97);
check('Summary reports 3 total recorded steps', summary.totalSteps === 3);
check('Summary isComplete is false when not all 100 measured', summary.isComplete === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
