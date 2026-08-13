import fs from 'fs';

// Pull the reader out of the module so it can be exercised without a network.
const src = fs.readFileSync(new URL('../src/lib/aaria-llm.js', import.meta.url), 'utf8');
const fn = src.slice(src.indexOf('async function readUntilJsonComplete'),
                     src.indexOf('export async function aariaUnderstandLLM'));
const readUntilJsonComplete = new Function(`${fn}; return readUntilJsonComplete;`)();

function sseStream(chunks) {
  return new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      for (const piece of chunks) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`));
      }
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
}
const fakeCtrl = { aborted: false, abort() { this.aborted = true; } };

let pass = 0, fail = 0;
async function check(name, chunks, expect) {
  const ctrl = { ...fakeCtrl, aborted: false, abort() { this.aborted = true; } };
  const got = await readUntilJsonComplete(sseStream(chunks), ctrl);
  const ok = got === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      expected: ${JSON.stringify(expect)}`); console.log(`      got     : ${JSON.stringify(got)}`); fail++; } else pass++;
}

await check('simple object, split across chunks',
  ['{"intent":"remin', 'der","confidence":0.9}'],
  '{"intent":"reminder","confidence":0.9}');

await check('stops at the closing brace and drops trailing prose',
  ['{"a":1}', '\n\nI hope that helps! Let me know.'],
  '{"a":1}');

await check('a brace INSIDE a string must not close the object',
  ['{"reply":"use {this} carefully","ok":true}'],
  '{"reply":"use {this} carefully","ok":true}');

await check('nested object closes only at the outer brace',
  ['{"entities":{"person":"Ravi"},"intent":"contact"}'],
  '{"entities":{"person":"Ravi"},"intent":"contact"}');

await check('escaped quote inside a string does not end the string',
  ['{"reply":"he said \\"hi\\" to me"}'],
  '{"reply":"he said \\"hi\\" to me"}');

await check('leading markdown fence is preserved for the caller to strip',
  ['```json\n{"a":1}\n```'],
  '```json\n{"a":1}');

await check('Telugu reply survives multi-byte chunk boundaries',
  ['{"reply":"సరే, రేపు ఉద', 'యం గుర్తు చేస్తాను"}'],
  '{"reply":"సరే, రేపు ఉదయం గుర్తు చేస్తాను"}');

await check('unterminated stream returns what it has',
  ['{"a":1'],
  '{"a":1');

// abort must fire when the object completes, so the rest is never downloaded
{
  const ctrl = { aborted: false, abort() { this.aborted = true; } };
  await readUntilJsonComplete(sseStream(['{"a":1}', 'more tokens']), ctrl);
  console.log(`${ctrl.aborted ? 'PASS' : 'FAIL'}  aborts the request once the JSON closes`);
  ctrl.aborted ? pass++ : fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
