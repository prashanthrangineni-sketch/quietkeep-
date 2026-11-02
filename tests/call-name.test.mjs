// tests/call-name.test.mjs — AG-I1: "Call X" in te/hi picks right contact name
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIntent } from '../src/lib/intent-parser.js';

const cases = JSON.parse(
  readFileSync(new URL('./fixtures/call-name-cases.json', import.meta.url), 'utf8')
);

const FORBIDDEN_NAMES = new Set([
  'cheyyi', 'cheyi', 'chey', 'cheyali', 'cheyyali', 'karo', 'kar', 'kardo', 'lagao',
  'ki', 'ko', 'se', 'tho', 'to', 'ku', 'garu', 'ji', 'call', 'phone'
]);

test('call-name cases fixture contains 40 cases', () => {
  assert.equal(cases.length, 40);
  const teCases = cases.filter(c => c.lang === 'te');
  const hiCases = cases.filter(c => c.lang === 'hi');
  const noCallCases = cases.filter(c => c.expected === null);
  assert.ok(teCases.length >= 14, `Expected >= 14 te cases, got ${teCases.length}`);
  assert.ok(hiCases.length >= 14, `Expected >= 14 hi cases, got ${hiCases.length}`);
  assert.equal(noCallCases.length, 4, `Expected 4 no-call cases, got ${noCallCases.length}`);
});

for (const c of cases) {
  test(`[${c.id}] ${c.text} -> ${c.expected ?? 'no contact'}`, () => {
    const res = parseIntent(c.text);
    const names = res.entities?.names || [];
    const name = names[0] || null;

    // Never capture a verb or particle as a contact name
    for (const n of names) {
      assert.ok(
        !FORBIDDEN_NAMES.has(String(n).toLowerCase()),
        `Extracted name "${n}" is a forbidden verb/particle in "${c.text}"`
      );
    }

    assert.equal(
      name,
      c.expected,
      `Sentence "${c.text}": expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(name)}`
    );
  });
}

test('bare commands without names yield no contact name and never capture verbs or particles', () => {
  const bareCommands = ['call cheyyi', 'call karo', 'కాల్ చెయ్యి', 'कॉल करो', 'call', 'కాల్'];
  for (const cmd of bareCommands) {
    const res = parseIntent(cmd);
    const names = res.entities?.names || [];
    assert.equal(names.length, 0, `Command "${cmd}" extracted unexpected name: ${JSON.stringify(names)}`);
  }
});
