// tests/t17-edge-language.test.mjs — T17: the wake listener is told the person's language.
const { edgeLangOf, tellEdgeLanguage } = await import('../src/lib/edge-language.js');
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { console.log(`PASS  ${n}`); pass++; } else { console.error(`FAIL  ${n} ${d}`); fail++; } };

check('te-IN -> te', edgeLangOf('te-IN') === 'te');
check('hi -> hi', edgeLangOf('hi') === 'hi');
check('en_IN -> en', edgeLangOf('en_IN') === 'en');
check('nothing -> en', edgeLangOf(undefined) === 'en' && edgeLangOf('') === 'en');
check('rubbish -> en', edgeLangOf('12-x') === 'en');

const calls = [];
const win = { Capacitor: { Plugins: { AariaEdge: { setLanguage: async (o) => { calls.push(o); } } } } };
check('calls setLanguage with te', (await tellEdgeLanguage('te-IN', win)) === 'te' && calls[0]?.lang === 'te');
check('no plugin (web, iPhone) -> does nothing', (await tellEdgeLanguage('te-IN', {})) === null);
const failing = { Capacitor: { Plugins: { AariaEdge: { setLanguage: async () => { throw new Error('aaria_unavailable'); } } } } };
check('plugin not ready -> never throws', (await tellEdgeLanguage('te', failing)) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
