// tests/voice-settings-crash.test.mjs
// Card T12: Verify identifiers in Developer 100-Task Step Log are defined in VoiceSettings()
// Prevents ReferenceError crash on /settings/voice (Settings -> Voice settings).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  ok ? pass++ : fail++;
}

console.log('── Card T12: Voice Settings 100-Task Step Log Identifiers ──\n');

const pagePath = path.join(REPO_ROOT, 'src', 'app', 'settings', 'voice', 'page.jsx');
check('src/app/settings/voice/page.jsx exists on disk', fs.existsSync(pagePath));

const src = fs.readFileSync(pagePath, 'utf8');

// 1. Locate VoiceSettings component body
const fnStart = src.indexOf('export default function VoiceSettings()');
check('VoiceSettings component declaration exists', fnStart !== -1);

const returnIdx = src.indexOf('return (', fnStart);
check('VoiceSettings has JSX return statement', returnIdx !== -1);

const componentHeader = src.slice(fnStart, returnIdx);

// 2. Locate Developer: 100-Task Step Log JSX section
const logSectionStart = src.indexOf('Developer: 100-Task Step Log', returnIdx);
check('Developer: 100-Task Step Log section exists in JSX', logSectionStart !== -1);

const logSectionEnd = src.indexOf('</details>', logSectionStart);
check('Developer: 100-Task Step Log section has closing </details>', logSectionEnd !== -1);

const stepLogJsx = src.slice(logSectionStart, logSectionEnd);

// 3. Verify the 5 required identifiers used in the JSX block
const requiredIdentifiers = [
  'isCompleted',
  'isGuidedActive',
  'currentTask',
  'currentTaskSteps',
  'summary',
];

console.log('\nChecking usage in JSX section:');
for (const id of requiredIdentifiers) {
  const isUsed = new RegExp(`\\b${id}\\b`).test(stepLogJsx);
  check(`Identifier "${id}" is referenced in 100-Task Step Log JSX`, isUsed);
}

console.log('\nChecking definition inside VoiceSettings() scope (before JSX return):');
for (const id of requiredIdentifiers) {
  // Matches const/let/var id = ... or function id(...)
  const isDeclared = new RegExp(`(?:const|let|var)\\s+${id}\\b`).test(componentHeader);
  check(`Identifier "${id}" is defined in VoiceSettings()`, isDeclared, `missing definition before return`);
}

// 4. Check specific logic contract for each definition
console.log('\nChecking logic contracts for defined identifiers:');
check('currentTask accesses tasks with guidedIndex',
  /const\s+currentTask\s*=\s*tasks\[guidedIndex\]/.test(componentHeader)
);

check('isCompleted checks guidedIndex >= tasks.length',
  /const\s+isCompleted\s*=\s*guidedIndex\s*>=\s*tasks\.length/.test(componentHeader)
);

check('isGuidedActive checks !!activeRun && !manualMode',
  /const\s+isGuidedActive\s*=\s*!*!*activeRun\s*&&\s*!manualMode/.test(componentHeader)
);

check('currentTaskSteps computes recorded step count for current task',
  /const\s+currentTaskSteps\s*=\s*/.test(componentHeader) &&
  /task_id\s*===?\s*currentTask(?:\.id|\?\.id)/.test(componentHeader)
);

check('summary calls computeRunSummary',
  /const\s+summary\s*=\s*computeRunSummary\s*\(/.test(componentHeader)
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

