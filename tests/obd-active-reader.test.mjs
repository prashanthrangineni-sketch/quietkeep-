// tests/obd-active-reader.test.mjs — the shared "connected car reader" (DRV-06b)
import { ObdReader } from '../src/lib/obd/reader.js';
import { ObdSimulator } from '../src/lib/obd/simulator.js';
import { setActiveReader, getActiveReader, isCarReaderConnected, describeCar, describeFaults } from '../src/lib/obd/active-reader.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  ok ? pass++ : fail++;
}

check('no reader: not connected', isCarReaderConnected() === false && getActiveReader() === null);
check('no reader: describeCar() is null (voice says "connect the car reader first")', (await describeCar()) === null);
check('no reader: describeFaults() is null', (await describeFaults()) === null);

let sim;
try { sim = new ObdSimulator(); } catch (e) { sim = null; }
if (!sim) {
  check('simulator constructs', false, 'ObdSimulator constructor failed');
} else {
  const reader = new ObdReader(sim);
  await reader.connect();
  setActiveReader(reader);
  check('connected reader is shared', getActiveReader() === reader && isCarReaderConnected());
  const line = await describeCar();
  check('describeCar() returns a spoken sentence from live readings', typeof line === 'string' && line.length > 10, String(line));
  const f = await describeFaults();
  check('describeFaults() returns a sentence', typeof f === 'string' && f.length > 5, String(f));
  setActiveReader(null);
  check('cleared on disconnect', getActiveReader() === null && (await describeCar()) === null);
  try { reader.destroy?.(); } catch {}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
