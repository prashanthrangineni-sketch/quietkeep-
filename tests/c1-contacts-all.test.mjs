// tests/c1-contacts-all.test.mjs
// Card C1: Contacts screen shows every contact (Supabase 1,000-row cap bypassed)
// Proves 1,918 rows synced from founder's phone are all returned and searchable.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllContacts, CONTACTS_PAGE_SIZE } from '../src/app/api/contacts/fetchAll.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`PASS  ${name}`);
    pass++;
  } else {
    console.error(`FAIL  ${name}${detail ? ` (${detail})` : ''}`);
    fail++;
  }
}

console.log('── Card C1: Contacts Screen Fetches All Contacts (1,918 rows) ──\n');

// 1. Verify page.jsx references fetchAllContacts
const pagePath = path.join(REPO_ROOT, 'src', 'app', 'contacts', 'page.jsx');
check('src/app/contacts/page.jsx exists on disk', fs.existsSync(pagePath));
const pageSrc = fs.readFileSync(pagePath, 'utf8');
check(
  'src/app/contacts/page.jsx imports fetchAllContacts',
  /import\s+.*fetchAllContacts.*from\s+['"]@\/app\/api\/contacts\/fetchAll['"]/.test(pageSrc)
);
check(
  'src/app/contacts/page.jsx invokes fetchAllContacts',
  /fetchAllContacts\s*\(/.test(pageSrc)
);

// 2. Build mock Supabase client simulating default 1,000-row cap
function createMockSupabase(dbRows, cap = 1000) {
  return {
    from(table) {
      let filters = [];
      let orderCol = null;
      let orderAsc = true;
      let rangeFrom = null;
      let rangeTo = null;
      const queryLog = [];

      const builder = {
        select(cols) {
          return builder;
        },
        eq(col, val) {
          filters.push(r => r[col] === val);
          return builder;
        },
        order(col, opts = {}) {
          orderCol = col;
          orderAsc = opts.ascending !== false;
          return builder;
        },
        range(from, to) {
          rangeFrom = from;
          rangeTo = to;
          return builder;
        },
        then(resolve, reject) {
          let rows = dbRows[table] ? [...dbRows[table]] : [];
          rows = rows.filter(r => filters.every(f => f(r)));

          if (orderCol) {
            rows.sort((a, b) => {
              if (a[orderCol] < b[orderCol]) return orderAsc ? -1 : 1;
              if (a[orderCol] > b[orderCol]) return orderAsc ? 1 : -1;
              return 0;
            });
          }

          // Real Supabase behaviour:
          // If range(from, to) is specified, return slice [from, to] (inclusive).
          // If no range is specified, PostgREST caps at default limit (1,000).
          let slice;
          if (rangeFrom !== null && rangeTo !== null) {
            slice = rows.slice(rangeFrom, rangeTo + 1);
          } else {
            slice = rows.slice(0, cap);
          }

          return Promise.resolve({ data: slice, error: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
}

// 3. Generate 1,918 contacts for target user 'u1' + 50 for another user
const TOTAL_CONTACTS = 1918;
const testContacts = [];
for (let i = 1; i <= TOTAL_CONTACTS; i++) {
  const pad = String(i).padStart(4, '0');
  testContacts.push({
    id: `c_${pad}`,
    user_id: 'u1',
    name: `Contact ${pad}`,
    phone: `+9198765${pad}`,
    email: `contact${pad}@example.com`,
    relation: i % 10 === 0 ? 'Family' : null,
    avatar_emoji: '👤',
    is_favorite: i <= 5,
    source: 'device_sync'
  });
}

// Add decoy contacts for other users
for (let i = 1; i <= 50; i++) {
  testContacts.push({
    id: `other_${i}`,
    user_id: 'u2',
    name: `Other User Contact ${i}`,
    phone: `+9111111${i}`,
    user_id: 'u2'
  });
}

const mockSupabase = createMockSupabase({ contacts: testContacts }, 1000);

// Baseline verification: A standard query without chunking only gets 1,000
const rawResult = await mockSupabase.from('contacts').select('*').eq('user_id', 'u1');
check('Baseline: Unpaged Supabase query returns only 1,000 rows (cap)', rawResult.data.length === 1000);

// 4. Test fetchAllContacts returns all 1,918 rows
const allContacts = await fetchAllContacts(mockSupabase, 'u1');
check('fetchAllContacts returns all 1,918 contacts', allContacts.length === TOTAL_CONTACTS);
check('First contact is returned', allContacts[0]?.id === 'c_0001');
check('Last contact (1,918) is returned', allContacts[TOTAL_CONTACTS - 1]?.id === 'c_1918');

// Verify all contacts belong to user 'u1' and no other user's rows leak
const allBelongToU1 = allContacts.every(c => c.user_id === 'u1');
check('All returned contacts strictly belong to user u1', allBelongToU1);

// 5. Test search across all 1,918 contacts
const searchEarliest = allContacts.filter(c =>
  c.name?.toLowerCase().includes('0001') || c.phone?.includes('0001')
);
check('Search finds earliest contact in full set', searchEarliest.length === 1 && searchEarliest[0].name === 'Contact 0001');

const searchLatest = allContacts.filter(c =>
  c.name?.toLowerCase().includes('1918') || c.phone?.includes('1918')
);
check('Search finds latest contact (#1918) in full set', searchLatest.length === 1 && searchLatest[0].name === 'Contact 1918');

const searchMiddle = allContacts.filter(c =>
  c.name?.toLowerCase().includes('1050')
);
check('Search finds contact beyond the 1,000th boundary (#1050)', searchMiddle.length === 1 && searchMiddle[0].name === 'Contact 1050');

// 6. Test edge cases
const emptySupabase = createMockSupabase({ contacts: [] });
const emptyResult = await fetchAllContacts(emptySupabase, 'u1');
check('Empty phonebook returns empty array []', Array.isArray(emptyResult) && emptyResult.length === 0);

// Exactly 1000 contacts boundary test (chunk returns 1,000 then next chunk returns 0)
const exactly1000 = testContacts.slice(0, 1000);
const exact1000Supabase = createMockSupabase({ contacts: exactly1000 });
const result1000 = await fetchAllContacts(exact1000Supabase, 'u1');
check('Exactly 1,000 contacts boundary returns exactly 1,000 rows', result1000.length === 1000);

// Custom page size (e.g. 500 rows/page over 1,918 rows)
const customPaged = await fetchAllContacts(mockSupabase, 'u1', { pageSize: 500 });
check('Custom page size (500) over 1,918 rows also returns all 1,918 rows', customPaged.length === TOTAL_CONTACTS);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
