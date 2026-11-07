// scripts/generate-tasks100.mjs
// Generates src/data/tasks100.json from pranix-aaria's make_tasks100.py.
//
// Source: C:\Users\ADMIN\pranix-aaria\scripts\measure\make_tasks100.py
// Commit: 80f28a182dd93fe727c4100bd7aa076728241059 (14 Oct 2026)
//
// Usage: node scripts/generate-tasks100.mjs

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const AARIA_PATH = 'C:\\Users\\ADMIN\\pranix-aaria';
const SCRIPT_PATH = path.join(AARIA_PATH, 'scripts', 'measure', 'make_tasks100.py');
const OUTPUT_PATH = path.join(REPO_ROOT, 'src', 'data', 'tasks100.json');

// 1. Get commit hash from pranix-aaria
let commitHash = '80f28a182dd93fe727c4100bd7aa076728241059';
try {
  commitHash = execSync(`git -C "${AARIA_PATH}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
} catch (e) {
  console.warn('Could not read git rev-parse HEAD, using pinned commit', commitHash);
}

// 2. Extract tasks using Python from make_tasks100.py
const pyCmd = `python -c "import sys, json; sys.path.append(r'${path.join(AARIA_PATH, 'scripts', 'measure')}'); import make_tasks100; json.dump(make_tasks100.T, sys.stdout, ensure_ascii=False)"`;
const rawJson = execSync(pyCmd, { encoding: 'utf-8' });
const tasks = JSON.parse(rawJson);

if (!Array.isArray(tasks) || tasks.length !== 100) {
  throw new Error(`Expected exactly 100 tasks, got ${tasks?.length}`);
}

// 3. Annotate the first task with generation metadata so the file self-documents
const annotatedTasks = tasks.map((task, idx) => {
  if (idx === 0) {
    return {
      _generator_note: `Generated from pranix-aaria/scripts/measure/make_tasks100.py at commit ${commitHash}. Do not invent or hand-edit tasks. Regenerate via: node scripts/generate-tasks100.mjs`,
      _generator_commit: commitHash,
      _generator_source: 'scripts/measure/make_tasks100.py',
      ...task,
    };
  }
  return task;
});

// Ensure directory exists
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(annotatedTasks, null, 2), 'utf-8');
console.log(`Successfully generated ${annotatedTasks.length} tasks into ${OUTPUT_PATH}`);
console.log(`Source commit: ${commitHash}`);
