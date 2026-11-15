// tests/share-link-lookup.test.mjs - the list of share links is never read from
// the browser.
//
// 15 November 2026: the share page read the share_tokens table directly, which
// needed a database rule letting anyone read every share link (21 links from 3
// accounts were listable without signing in). The page now asks the database
// for one link by its exact code through get_share_by_token.
import { readFileSync, readdirSync, statSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name); ok ? pass++ : fail++; }
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const code = (s) => s.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir, out = []) {
  for (const name of readdirSync(new URL(dir, root))) {
    const p = dir + name;
    if (statSync(new URL(p, root)).isDirectory()) walk(p + '/', out);
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const page = code(read('src/app/share/[token]/page.jsx'));
check('share page looks a link up by its code', /rpc\('get_share_by_token', \{ p_token: token \}\)/.test(page));
check('share page never reads the share_tokens table', !/share_tokens/.test(page));

const readers = walk('src/').filter((p) => /from\('share_tokens'\)\s*\.select/.test(code(read(p)).replace(/\n\s*/g, '')));
check('no browser or server code lists share links (' + (readers.join(', ') || 'none') + ')', readers.length === 0);

const sql = read('supabase/migrations/20261115_share_link_lookup.sql');
check('lookup needs the exact code', /where s\.token = p_token and s\.is_active = true/.test(sql));
check('lookup is not open to every database role by default', /revoke all on function public\.get_share_by_token\(text\) from public/.test(sql));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
