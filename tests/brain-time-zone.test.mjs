// tests/brain-time-zone.test.mjs - a brain time with no zone is India time.
// (15 Oct 2026.) Run 38726346076: the model answered "2026-10-16T08:00:00"
// with no offset in 2 of 48 timed sentences; on a UTC server that became
// 1:30 PM IST. Plain node, no packages. Runs as a UTC server would.
process.env.TZ = 'UTC'
import { withIndiaZone, parseBrainResponse } from '../src/lib/aaria-llm.js'

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
  ok ? pass++ : fail++
}
const utc = (v) => { const d = new Date(v); return isNaN(d.getTime()) ? String(d) : d.toISOString() }

check('process runs in UTC', new Date('2026-10-16T08:00:00').toISOString() === '2026-10-16T08:00:00.000Z')

check('bare date-time with seconds -> 02:30Z', utc(withIndiaZone('2026-10-16T08:00:00')) === '2026-10-16T02:30:00.000Z', utc(withIndiaZone('2026-10-16T08:00:00')))
check('bare date-time without seconds -> 05:30Z', utc(withIndiaZone('2026-10-16T11:00')) === '2026-10-16T05:30:00.000Z', utc(withIndiaZone('2026-10-16T11:00')))
check('fractional seconds also get the zone', withIndiaZone('2026-10-16T08:00:00.000') === '2026-10-16T08:00:00.000+05:30')
check('surrounding spaces trimmed', withIndiaZone('  2026-10-16T08:00:00 ') === '2026-10-16T08:00:00+05:30')
check('Z unchanged', withIndiaZone('2026-10-16T02:30:00Z') === '2026-10-16T02:30:00Z')
check('+05:30 unchanged', withIndiaZone('2026-10-16T08:00:00+05:30') === '2026-10-16T08:00:00+05:30')
check('other offset unchanged', withIndiaZone('2026-10-16T08:00:00-04:00') === '2026-10-16T08:00:00-04:00')
check('null -> null', withIndiaZone(null) === null)
check('undefined -> null', withIndiaZone(undefined) === null)
check('empty -> null', withIndiaZone('') === null)
check('blank -> null', withIndiaZone('   ') === null)
check('date-only unchanged', withIndiaZone('2026-10-16') === '2026-10-16')

const parse = (ents) => parseBrainResponse(JSON.stringify({ intent: 'reminder', confidence: 0.9, entities: ents }),
  { clean: 'x', nowISO: '2026-10-15T06:00:00.000Z', language: 'en-IN', model: 'm' }).result
{
  const r = parse({ datetime_iso: '2026-10-16T08:00:00' })
  check('parser: bare 08:00 reads as 02:30Z', utc(r.entities.datetimeISO) === '2026-10-16T02:30:00.000Z', String(r.entities.datetimeISO))
}
{
  const r = parse({ datetime_iso: '2026-10-16T08:00:00+05:30' })
  check('parser: zoned time untouched', r.entities.datetimeISO === '2026-10-16T08:00:00+05:30', String(r.entities.datetimeISO))
}
{
  const r = parse({ datetime_iso: '2026-10-16T08:00:00', relative_minutes: 5 })
  check('parser: relative_minutes still wins', r.entities.datetimeISO === '2026-10-15T06:05:00.000Z', String(r.entities.datetimeISO))
}
{
  const r = parse({})
  check('parser: no time stays null', r.entities.datetimeISO === null, String(r.entities.datetimeISO))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
