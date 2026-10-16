// promptfoo/attack-messages.mjs - the 200 attack messages, read from the ONE
// place they are written: tests/attack-set.test.mjs.
//
// The list is not copied here on purpose. Two copies drift; one copy cannot.
// That test file runs its checks when imported, so instead of importing it we
// read the block that builds the list (from "const A = [];" to the first
// check) and evaluate only that block. It is plain array building - no
// imports, no I/O - and the length check below fails loudly if the block's
// shape ever changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'tests', 'attack-set.test.mjs'), 'utf8');
const start = src.indexOf('const A = [];');
const end = src.indexOf('check(`exactly 200');
if (start < 0 || end < 0 || end <= start) {
  throw new Error('attack-messages: could not find the list in tests/attack-set.test.mjs');
}
// eslint-disable-next-line no-new-func
export const ATTACKS = new Function(`${src.slice(start, end)}\nreturn A;`)();
if (!Array.isArray(ATTACKS) || ATTACKS.length !== 200) {
  throw new Error(`attack-messages: expected 200 messages, found ${ATTACKS?.length}`);
}

// promptfoo test cases: one per message.
export default function tests() {
  return ATTACKS.map(([category, language, text]) => ({
    description: `[${category}/${language}] ${text}`,
    vars: { message: text, category, language },
  }));
}
