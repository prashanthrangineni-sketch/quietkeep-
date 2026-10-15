// scripts/check-home-html.mjs
//
// Fetches "/" with no cookies (a signed-out visitor, Google, a WhatsApp link
// preview) and checks the HTML the server sends - before any JavaScript runs.
//
// WHY THIS EXISTS
// For months the server HTML for "/" was a lock emoji and "Verifying…": the
// biometric gate in layout.jsx held the whole page back until a check that
// only runs in the browser. Search engines and link previews saw an empty
// login check. This fails if that ever comes back.
//
// Usage:  node scripts/check-home-html.mjs [base-url]   (default http://localhost:3000)
const base = (process.argv[2] || process.env.HOME_URL || 'http://localhost:3000').replace(/\/$/, '');

const res = await fetch(`${base}/`, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
const html = await res.text();
// Text a visitor reads, without tags (React splits text nodes with comments).
const text = html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

let fail = 0;
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fail++;
}

check(`GET / answers 200 (got ${res.status})`, res.status === 200);
const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1].replace(/<[^>]+>/g, ' ');
check('headline "Meet Aaria" is in the page <h1>', /Meet\s+Aaria/.test(h1));
check('"Start free" button is in the HTML', /Start free/.test(text));
check('Google Play link is in the HTML', html.includes('https://play.google.com/store/apps/details?id=com.pranix.quietkeep'));
check('no "Verifying" screen in the HTML', !/Verifying/.test(html));
check('counters show real numbers, not 0', /languages measured/.test(text) && !/>0<\/span>/.test(html) && !/>0%</.test(html));
check('footer names the company', /A product of Pranix AI Labs Private Limited/.test(text));
check('no pranix.in link', !html.includes('pranix.in'));
check('<title> matches the headline', /<title>[^<]*Meet Aaria[^<]*<\/title>/.test(html));
check('search/sharing description is set', /<meta name="description" content="[^"]*Aaria/.test(html) && /<meta property="og:description"/.test(html));

if (fail) {
  console.log(`\n${fail} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
