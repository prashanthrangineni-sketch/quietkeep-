// tests/ride-session.test.mjs
// Unit tests for ride-session: opening, closing, stale session expiration,
// reusing open sessions within 12h, error safety, and column validation.

import { openRideSession, closeRideSession } from '../src/lib/ride-session.js';

let pass = 0;
let fail = 0;

function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(want)}`);
    console.log(`      got     : ${JSON.stringify(got)}`);
    fail++;
  } else {
    pass++;
  }
}

function ok(name, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) {
    fail++;
  } else {
    pass++;
  }
}

const ALLOWED_COLUMNS = new Set(['user_id', 'started_at', 'ended_at', 'duration_seconds']);

/**
 * Creates an in-memory fake database implementing PostgREST query chaining.
 */
function createFakeDb(initialRows = [], { shouldFail = false, failureMessage = 'db error' } = {}) {
  const rows = initialRows.map(r => ({ ...r }));
  const writes = [];
  let idCounter = initialRows.length + 1;

  function makeQueryBuilder(tableName) {
    let mode = 'select'; // 'select' | 'insert' | 'update'
    let insertPayload = null;
    let updatePayload = null;
    let filters = [];
    let orderSpec = null;
    let limitVal = null;
    let isSingle = false;

    const builder = {
      select(cols) {
        if (!insertPayload) mode = 'select';
        return builder;
      },
      insert(payload) {
        mode = 'insert';
        insertPayload = payload;
        // Record all written keys
        Object.keys(payload).forEach(k => writes.push({ table: tableName, op: 'insert', column: k }));
        return builder;
      },
      update(payload) {
        mode = 'update';
        updatePayload = payload;
        // Record all written keys
        Object.keys(payload).forEach(k => writes.push({ table: tableName, op: 'update', column: k }));
        return builder;
      },
      eq(col, val) {
        filters.push((row) => row[col] === val);
        return builder;
      },
      is(col, val) {
        filters.push((row) => {
          if (val === null) return row[col] === null || row[col] === undefined;
          return row[col] === val;
        });
        return builder;
      },
      lt(col, val) {
        filters.push((row) => {
          if (!row[col]) return false;
          return new Date(row[col]).getTime() < new Date(val).getTime();
        });
        return builder;
      },
      gte(col, val) {
        filters.push((row) => {
          if (!row[col]) return false;
          return new Date(row[col]).getTime() >= new Date(val).getTime();
        });
        return builder;
      },
      order(col, { ascending = true } = {}) {
        orderSpec = { col, ascending };
        return builder;
      },
      limit(n) {
        limitVal = n;
        return builder;
      },
      single() {
        isSingle = true;
        return builder.then((res) => res);
      },
      maybeSingle() {
        isSingle = true;
        return builder.then((res) => res);
      },
      then(resolve, reject) {
        if (shouldFail) {
          return Promise.resolve({ data: null, error: { message: failureMessage } }).then(resolve, reject);
        }

        if (mode === 'insert') {
          const newRow = {
            id: insertPayload.id || `session-${idCounter++}`,
            user_id: insertPayload.user_id,
            started_at: insertPayload.started_at,
            ended_at: null,
            duration_seconds: null,
            ...insertPayload,
          };
          rows.push(newRow);
          const res = isSingle ? newRow : [newRow];
          return Promise.resolve({ data: res, error: null }).then(resolve, reject);
        }

        if (mode === 'update') {
          let matched = rows.filter(r => filters.every(f => f(r)));
          matched.forEach(r => {
            Object.assign(r, updatePayload);
          });
          return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
        }

        // mode === 'select'
        let matched = rows.filter(r => filters.every(f => f(r)));
        if (orderSpec) {
          matched.sort((a, b) => {
            const valA = new Date(a[orderSpec.col] || 0).getTime();
            const valB = new Date(b[orderSpec.col] || 0).getTime();
            return orderSpec.ascending ? valA - valB : valB - valA;
          });
        }
        if (typeof limitVal === 'number') {
          matched = matched.slice(0, limitVal);
        }
        const res = isSingle ? (matched[0] || null) : matched;
        return Promise.resolve({ data: res, error: null }).then(resolve, reject);
      },
    };

    return builder;
  }

  return {
    rows,
    writes,
    from(table) {
      return makeQueryBuilder(table);
    },
  };
}

// ── Run Tests ──────────────────────────────────────────────────────────────────

const BASE_TIME_MS = 1762100000000;
const fakeClock = (ms) => () => new Date(ms);

// 1. New session inserted
{
  const db = createFakeDb([]);
  const clock = fakeClock(BASE_TIME_MS);
  const res = await openRideSession({ db, userId: 'user-abc', clock });

  ok('new session inserted: returns ok=true', res.ok === true);
  ok('new session inserted: returns id', typeof res.id === 'string' && res.id.length > 0);
  eq('new session inserted: db has 1 row', db.rows.length, 1);
  eq('new session inserted: row user_id matches', db.rows[0].user_id, 'user-abc');
  eq('new session inserted: row started_at matches clock', db.rows[0].started_at, new Date(BASE_TIME_MS).toISOString());
  eq('new session inserted: row ended_at is null', db.rows[0].ended_at, null);
  eq('new session inserted: row duration_seconds is null', db.rows[0].duration_seconds, null);
}

// 2. Open session < 12 h reused
{
  const twoHoursAgoIso = new Date(BASE_TIME_MS - 2 * 60 * 60 * 1000).toISOString();
  const db = createFakeDb([
    { id: 'session-existing-1', user_id: 'user-abc', started_at: twoHoursAgoIso, ended_at: null, duration_seconds: null },
  ]);
  const clock = fakeClock(BASE_TIME_MS);
  const res = await openRideSession({ db, userId: 'user-abc', clock });

  ok('open session < 12 h reused: ok=true', res.ok === true);
  eq('open session < 12 h reused: returns existing session id', res.id, 'session-existing-1');
  eq('open session < 12 h reused: no extra row created in db', db.rows.length, 1);
  eq('open session < 12 h reused: ended_at remains null', db.rows[0].ended_at, null);
}

// 3. Stale session > 12 h ended then a new one inserted
{
  const fourteenHoursAgoIso = new Date(BASE_TIME_MS - 14 * 60 * 60 * 1000).toISOString();
  const db = createFakeDb([
    { id: 'session-stale', user_id: 'user-abc', started_at: fourteenHoursAgoIso, ended_at: null, duration_seconds: null },
  ]);
  const clock = fakeClock(BASE_TIME_MS);
  const res = await openRideSession({ db, userId: 'user-abc', clock });

  ok('stale session > 12 h: ok=true', res.ok === true);
  ok('stale session > 12 h: new id returned (different from stale)', res.id !== 'session-stale');
  eq('stale session > 12 h: db has 2 rows', db.rows.length, 2);

  const staleRow = db.rows.find(r => r.id === 'session-stale');
  const newRow = db.rows.find(r => r.id === res.id);

  eq('stale session > 12 h: stale ended_at set to now', staleRow.ended_at, new Date(BASE_TIME_MS).toISOString());
  eq('stale session > 12 h: stale duration_seconds set to null', staleRow.duration_seconds, null);
  eq('stale session > 12 h: new row has ended_at null', newRow.ended_at, null);
  eq('stale session > 12 h: new row started_at is now', newRow.started_at, new Date(BASE_TIME_MS).toISOString());
}

// 4. Close sets ended_at and duration
{
  const startTimeMs = BASE_TIME_MS;
  const closeTimeMs = BASE_TIME_MS + 450 * 1000; // 450 seconds later
  const db = createFakeDb([
    { id: 'session-to-close', user_id: 'user-abc', started_at: new Date(startTimeMs).toISOString(), ended_at: null, duration_seconds: null },
  ]);
  const clock = fakeClock(closeTimeMs);
  const res = await closeRideSession({
    db,
    id: 'session-to-close',
    clock,
    startedAt: new Date(startTimeMs).toISOString(),
  });

  ok('closeRideSession: ok=true', res.ok === true);
  eq('closeRideSession: error is null', res.error, null);
  eq('closeRideSession: ended_at matches close clock', db.rows[0].ended_at, new Date(closeTimeMs).toISOString());
  eq('closeRideSession: duration_seconds matches elapsed 450s', db.rows[0].duration_seconds, 450);
}

// 4b. Close with startedAt as numeric timestamp
{
  const startTimeMs = BASE_TIME_MS;
  const closeTimeMs = BASE_TIME_MS + 120 * 1000; // 120 seconds
  const db = createFakeDb([
    { id: 'session-numeric', user_id: 'user-abc', started_at: new Date(startTimeMs).toISOString(), ended_at: null, duration_seconds: null },
  ]);
  const clock = fakeClock(closeTimeMs);
  const res = await closeRideSession({
    db,
    id: 'session-numeric',
    clock,
    startedAt: startTimeMs,
  });

  ok('close with numeric startedAt: ok=true', res.ok === true);
  eq('close with numeric startedAt: duration_seconds is 120', db.rows[0].duration_seconds, 120);
}

// 4c. Close without startedAt leaves duration_seconds null
{
  const closeTimeMs = BASE_TIME_MS + 60 * 1000;
  const db = createFakeDb([
    { id: 'session-no-start', user_id: 'user-abc', started_at: new Date(BASE_TIME_MS).toISOString(), ended_at: null, duration_seconds: null },
  ]);
  const clock = fakeClock(closeTimeMs);
  const res = await closeRideSession({
    db,
    id: 'session-no-start',
    clock,
  });

  ok('close without startedAt: ok=true', res.ok === true);
  eq('close without startedAt: duration_seconds is null', db.rows[0].duration_seconds, null);
  eq('close without startedAt: ended_at is set', db.rows[0].ended_at, new Date(closeTimeMs).toISOString());
}

// 5. DB error returns { ok: false } and never throws
{
  const failingDb = createFakeDb([], { shouldFail: true, failureMessage: 'PostgREST connection reset' });
  let openThrew = false;
  let openRes = null;
  try {
    openRes = await openRideSession({ db: failingDb, userId: 'user-err', clock: fakeClock(BASE_TIME_MS) });
  } catch {
    openThrew = true;
  }
  ok('openRideSession: never throws on db error', !openThrew);
  eq('openRideSession: returns ok=false on db error', openRes.ok, false);
  ok('openRideSession: returns error string', typeof openRes.error === 'string' && openRes.error.length > 0);

  let closeThrew = false;
  let closeRes = null;
  try {
    closeRes = await closeRideSession({ db: failingDb, id: 'some-id', clock: fakeClock(BASE_TIME_MS) });
  } catch {
    closeThrew = true;
  }
  ok('closeRideSession: never throws on db error', !closeThrew);
  eq('closeRideSession: returns ok=false on db error', closeRes.ok, false);
  ok('closeRideSession: returns error string', typeof closeRes.error === 'string' && closeRes.error.length > 0);

  // Missing arguments check
  const missingArgsOpen = await openRideSession({});
  eq('openRideSession without db/user returns ok=false', missingArgsOpen.ok, false);

  const missingArgsClose = await closeRideSession({});
  eq('closeRideSession without db/id returns ok=false', missingArgsClose.ok, false);

  // Throwing client check (e.g. network failure throwing unexpected error)
  const throwingDb = {
    from() {
      throw new Error('Immediate network crash');
    },
  };
  let openThrowCrash = false;
  let openThrowRes = null;
  try {
    openThrowRes = await openRideSession({ db: throwingDb, userId: 'u' });
  } catch {
    openThrowCrash = true;
  }
  ok('openRideSession: catches throw and returns ok=false', !openThrowCrash && openThrowRes.ok === false);

  let closeThrowCrash = false;
  let closeThrowRes = null;
  try {
    closeThrowRes = await closeRideSession({ db: throwingDb, id: 's' });
  } catch {
    closeThrowCrash = true;
  }
  ok('closeRideSession: catches throw and returns ok=false', !closeThrowCrash && closeThrowRes.ok === false);
}

// 6. Only allowed columns are ever written
{
  const db = createFakeDb([
    { id: 'stale-1', user_id: 'user-cols', started_at: new Date(BASE_TIME_MS - 20 * 3600 * 1000).toISOString(), ended_at: null, duration_seconds: null },
  ]);
  const clock = fakeClock(BASE_TIME_MS);

  // Perform open (which updates stale and inserts new)
  const openRes = await openRideSession({ db, userId: 'user-cols', clock });
  // Perform close
  await closeRideSession({ db, id: openRes.id, clock, startedAt: BASE_TIME_MS });

  // Inspect all written columns across every query
  const writtenColumns = db.writes.map(w => w.column);
  const invalidColumns = writtenColumns.filter(c => !ALLOWED_COLUMNS.has(c));

  eq('only allowed columns written across insert & updates', invalidColumns, []);
  ok('writes occurred and included user_id', writtenColumns.includes('user_id'));
  ok('writes occurred and included started_at', writtenColumns.includes('started_at'));
  ok('writes occurred and included ended_at', writtenColumns.includes('ended_at'));
  ok('writes occurred and included duration_seconds', writtenColumns.includes('duration_seconds'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
