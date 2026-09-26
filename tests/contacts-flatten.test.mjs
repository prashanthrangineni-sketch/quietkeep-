// tests/contacts-flatten.test.mjs
// The phonebook -> API conversion, which is the only thing standing between
// "Aaria reads the reminder out" and "Aaria dials the person named in it".
//
// Run: node tests/contacts-flatten.test.mjs
import { flattenContacts, MAX_CONTACTS } from '../src/lib/contacts-flatten.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${label}`); return; }
  failures += 1;
  console.log(`  FAIL ${label}\n       expected ${e}\n       got      ${a}`);
}

console.log('flattenContacts — native plugin shape');

check('one contact, one number',
  flattenContacts([{ name: 'Aravind', phones: ['+91 98765 43210'], emails: [] }]),
  [{ name: 'Aravind', phone: '+91 98765 43210', email: null }]);

check('two numbers become two rows, email only on the first',
  flattenContacts([{
    name: 'Aravind',
    phones: ['+91 98765 43210', '040 2345 6789'],
    emails: ['aravind@example.com'],
  }]),
  [
    { name: 'Aravind', phone: '+91 98765 43210', email: 'aravind@example.com' },
    { name: 'Aravind', phone: '040 2345 6789', email: null },
  ]);

check('the same number written two ways is kept once',
  flattenContacts([{ name: 'Surya', phones: ['+91 98765 43210', '098765 43210', '9876543210'] }]),
  [{ name: 'Surya', phone: '+91 98765 43210', email: null }]);

check('names are trimmed',
  flattenContacts([{ name: '  Venu  ', phones: [' 9876543210 '] }]),
  [{ name: 'Venu', phone: '9876543210', email: null }]);

console.log('flattenContacts — what must be dropped');

check('no name',      flattenContacts([{ name: '', phones: ['9876543210'] }]), []);
check('name only',    flattenContacts([{ name: 'Amma', phones: [], emails: ['a@b.com'] }]), []);
check('no number at all', flattenContacts([{ name: 'Amma' }]), []);
check('not an array', flattenContacts(null), []);
check('undefined',    flattenContacts(undefined), []);
check('empty array',  flattenContacts([]), []);
check('junk entries', flattenContacts([null, undefined, 7, 'x']), []);

console.log('flattenContacts — flat shape (web picker / older inline code)');

check('flat phone + email',
  flattenContacts([{ name: 'Ravi', phone: '9876543210', email: 'r@x.com' }]),
  [{ name: 'Ravi', phone: '9876543210', email: 'r@x.com' }]);

check('flat and array forms mixed on one contact, array first',
  flattenContacts([{ name: 'Ravi', phones: ['9000000001'], phone: '9000000002' }]),
  [
    { name: 'Ravi', phone: '9000000001', email: null },
    { name: 'Ravi', phone: '9000000002', email: null },
  ]);

console.log('flattenContacts — two people with the same number stay separate');

check('shared landline, different names',
  flattenContacts([
    { name: 'Amma', phones: ['040 2345 6789'] },
    { name: 'Nanna', phones: ['040 2345 6789'] },
  ]),
  [
    { name: 'Amma', phone: '040 2345 6789', email: null },
    { name: 'Nanna', phone: '040 2345 6789', email: null },
  ]);

console.log('flattenContacts — batch cap');

const many = Array.from({ length: MAX_CONTACTS + 50 }, (_, i) => ({
  name: `Person ${i}`, phones: [`90000${String(i).padStart(5, '0')}`],
}));
check('never sends more rows than the API accepts',
  flattenContacts(many).length, MAX_CONTACTS);

check('an explicit lower limit is honoured mid-contact',
  flattenContacts([{ name: 'Aravind', phones: ['9000000001', '9000000002', '9000000003'] }], { limit: 2 }),
  [
    { name: 'Aravind', phone: '9000000001', email: null },
    { name: 'Aravind', phone: '9000000002', email: null },
  ]);

console.log('flattenContacts — Telugu and Hindi names survive unchanged');

check('Telugu name',
  flattenContacts([{ name: 'అరవింద్', phones: ['9876543210'] }]),
  [{ name: 'అరవింద్', phone: '9876543210', email: null }]);

check('Hindi name',
  flattenContacts([{ name: 'सूर्या', phones: ['9876543210'] }]),
  [{ name: 'सूर्या', phone: '9876543210', email: null }]);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall contacts-flatten assertions passed');
