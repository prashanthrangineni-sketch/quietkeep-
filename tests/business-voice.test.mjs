// tests/business-voice.test.mjs - attendance / stock / payroll by voice.
// (15 Oct 2026.) Every write is read back and waits for a spoken yes; payroll
// is a draft that writes and pays nothing; personal mode writes no business
// record. Plain node, no packages.
import { readFileSync } from 'node:fs'
import {
  BUSINESS_INTENTS, BIZ_TYPE, BIZ_ASKED, BIZ_ANSWERED, BIZ_WINDOW_MS,
  attendanceStatus, matchStaff, matchItem, normUnit, stockOp,
  planAttendance, attendanceRows, planStock, stockWrites, payrollDraft, payPeriod,
  pendingBiz, readBizAnswer, bizDecision, bizLine, doneLine, istDate,
} from '../src/lib/business-voice.js'
import { LEVEL, DECISION, levelFor, decide, mayActUnasked } from '../src/lib/action-levels.js'
import { INTENTS, buildPrompt, parseBrainResponse } from '../src/lib/aaria-llm.js'
import { whyBrainRun } from '../src/lib/understanding-record.js'

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
  ok ? pass++ : fail++
}
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// 15 Oct 2026, 11:30 IST
const NOW = Date.parse('2026-10-15T06:00:00.000Z')
const TODAY = '2026-10-15'
const STAFF = [
  { id: 'm1', name: 'Ravi' },
  { id: 'm2', name: 'Lakshmi Devi' },
  { id: 'm3', name: 'Raju' },
  { id: 'm4', name: 'Sathish Kumar' },
]
const ITEMS = [
  { id: 'i1', name: 'Rice', unit: 'kg', current_stock: 25 },
  { id: 'i2', name: 'Sugar', unit: 'kg', current_stock: 12 },
  { id: 'i3', name: 'Sunflower Oil', unit: 'litre', current_stock: 8 },
  { id: 'i4', name: 'Soap', unit: 'pcs', current_stock: 40 },
]

// ── the brain and the level table ───────────────────────────────────────────
for (const i of ['attendance', 'stock', 'payroll']) {
  check(`brain knows ${i}`, INTENTS.includes(i) && BUSINESS_INTENTS.has(i))
}
check('attendance -> spoken yes', levelFor({ type: BIZ_TYPE.attendance }) === LEVEL.SPOKEN_YES)
check('stock -> spoken yes', levelFor({ type: BIZ_TYPE.stock }) === LEVEL.SPOKEN_YES)
check('payroll draft -> read back (writes nothing)', levelFor({ type: BIZ_TYPE.payroll }) === LEVEL.READ_BACK)
check('stock question -> read back (writes nothing)', levelFor({ type: 'stock_check' }) === LEVEL.READ_BACK)
check('paying salary -> PIN', levelFor({ type: BIZ_TYPE.pay_salary }) === LEVEL.PIN)
check('attendance may not happen unasked', !mayActUnasked('attendance'))
check('stock may not happen unasked', !mayActUnasked('stock'))
check('paying salary may not happen unasked', !mayActUnasked('salary_payment'))
{
  const r = decide({ type: 'salary_payment' }, { spokenYes: true, unlocked: true, pin: false }, { doneThisHour: 0 })
  check('a spoken yes never pays salary (asks for the PIN)', r.decision === DECISION.ASK_PIN, JSON.stringify(r))
}

// ── the parser carries the new details ───────────────────────────────────────
{
  const parse = (o) => parseBrainResponse(JSON.stringify(o), { clean: 'x', nowISO: new Date(NOW).toISOString(), language: 'en-IN', model: 'm' }).result
  const a = parse({ intent: 'attendance', confidence: 0.9, entities: { person: 'Ravi', status: 'Absent' } })
  check('parser: attendance status', a.intent === 'attendance' && a.entities.status === 'absent', JSON.stringify(a.entities))
  const s = parse({ intent: 'stock', confidence: 0.9, entities: { item: 'rice', quantity: 20, unit: 'kg', stock_op: 'add' } })
  check('parser: stock quantity / unit / op', s.entities.quantity === 20 && s.entities.unit === 'kg' && s.entities.stockOp === 'add', JSON.stringify(s.entities))
  const r = parse({ intent: 'reminder', confidence: 0.9, entities: {} })
  check('parser: other intents get nulls', r.entities.status === null && r.entities.quantity === null && r.entities.stockOp === null)
}

// ── the prompt ───────────────────────────────────────────────────────────────
{
  const p = buildPrompt({ text: 'x', language: 'en-IN', nowISO: new Date(NOW).toISOString(), timezone: 'Asia/Kolkata', workspaceMode: 'business' })
  check('prompt names attendance / stock / payroll', /"attendance"/.test(p) && /"stock"/.test(p) && /"payroll"/.test(p))
  check('prompt: money direction is who gave to whom', /WHO GAVE TO WHOM/.test(p))
  for (const w of ['received 500 from Gupta', 'Gupta ji ne 500 de diye', 'Ravi nundi 500 vacchindi', 'Ravi paid me 300', 'Ravi ki 500 ichanu', 'Ravi ko 500 diye', 'gave Gupta 500']) {
    check(`prompt carries the direction example "${w}"`, p.includes(w))
  }
  check('prompt: paying salary now is "pay"', /Paying salary NOW is "pay"/.test(p))
}

// ── the brain runs on these sentences ────────────────────────────────────────
for (const t of ['out of stock: oil', 'mark Ravi absent today', 'prepare this month\'s salary', 'Ravi ki entha jeetham']) {
  const r = whyBrainRun({ parsed: { type: 'task', confidence: 0.95 }, text: t, language: 'en-IN', reminderAt: new Date() })
  check(`brain runs on "${t}" even when the regex is sure`, r.run && r.reasons.includes('business_shaped'), JSON.stringify(r))
}

// ── attendance ───────────────────────────────────────────────────────────────
check('status: absent', attendanceStatus('absent') === 'absent')
check('status: "Ravi ki half day" from the words', attendanceStatus(null, 'Ravi ki half day') === 'half_day')
check('status: "sab present hain"', attendanceStatus(null, 'sab present hain') === 'present')
check('status: Telugu "రాలేదు" -> absent', attendanceStatus(null, 'రవి ఈరోజు రాలేదు') === 'absent')
check('status: Hindi "छुट्टी" -> leave', attendanceStatus(null, 'आज रमेश की छुट्टी लगा दो') === 'leave')
check('status: nothing said -> null (Aaria asks)', attendanceStatus(null, 'Ravi') === null)

check('staff: "Ravi"', matchStaff(STAFF, 'Ravi').match?.id === 'm1')
check('staff: "Lakshmi" matches "Lakshmi Devi"', matchStaff(STAFF, 'Lakshmi').match?.id === 'm2')
check('staff: "Raaju" matches "Raju"', matchStaff(STAFF, 'Raaju').match?.id === 'm3')
check('staff: "Satish" matches "Sathish Kumar"', matchStaff(STAFF, 'Satish').match?.id === 'm4')
check('staff: "all" -> everyone', matchStaff(STAFF, 'all').all === true)
check('staff: "sab present hain" with no name -> everyone', matchStaff(STAFF, null, 'sab present hain').all === true)
check('staff: unknown name -> none', matchStaff(STAFF, 'Gopal').none === true)
check('staff: no staff -> empty', matchStaff([], 'Ravi').empty === true)

{
  const p = planAttendance({ members: STAFF, person: 'Ravi', status: 'absent', text: 'mark Ravi absent today', language: 'en-IN', nowMs: NOW })
  check('read back: "Mark Ravi absent today? Yes or no?"', p.tts === 'Mark Ravi absent today? Yes or no?', p.tts)
  check('read back holds Ravi, absent, today', p.pending?.status === 'absent' && p.pending?.date === TODAY && p.pending?.members.length === 1 && p.pending.members[0].id === 'm1')
  const rows = attendanceRows(p.pending, { workspaceId: 'w1', userId: 'u1' })
  check('after yes: one attendance_logs row', rows.length === 1 && rows[0].workspace_id === 'w1' && rows[0].member_id === 'm1' && rows[0].log_date === TODAY && rows[0].status === 'absent' && rows[0].marked_by === 'u1', JSON.stringify(rows))
  check('done line', doneLine(p.pending, 'en-IN') === 'Marked Ravi absent today.', doneLine(p.pending, 'en-IN'))
}
{
  const p = planAttendance({ members: STAFF, person: 'Ravi', status: null, text: 'Ravi ki half day', language: 'en-IN', nowMs: NOW })
  check('"Ravi ki half day" read back', p.tts === 'Mark Ravi half day today? Yes or no?', p.tts)
  const all = planAttendance({ members: STAFF, person: 'all', status: 'present', text: 'sab present hain', language: 'hi-IN', nowMs: NOW })
  check('"sab present hain": everyone, read back in Hindi', all.pending?.members.length === 4 && /सबको/.test(all.tts) && /हाँ या ना/.test(all.tts), all.tts)
  check('everyone -> four rows after yes', attendanceRows(all.pending, { workspaceId: 'w1', userId: 'u1' }).length === 4)
  const te = planAttendance({ members: STAFF, person: 'Ravi', status: 'absent', text: 'రవి ఈరోజు రాలేదు', language: 'te-IN', nowMs: NOW })
  check('Telugu read back', /Ravi ని ఈరోజు ఆబ్సెంట్/.test(te.tts) && /అవును లేదా వద్దు/.test(te.tts), te.tts)
  const y = planAttendance({ members: STAFF, person: 'Ravi', status: 'absent', datetimeISO: '2026-10-14T09:00:00+05:30', text: '', language: 'en-IN', nowMs: NOW })
  check('a named day: "yesterday"', y.tts === 'Mark Ravi absent yesterday? Yes or no?' && y.pending.date === '2026-10-14', y.tts)
  const noStatus = planAttendance({ members: STAFF, person: 'Ravi', status: null, text: 'Ravi', language: 'en-IN', nowMs: NOW })
  check('no status -> asks, nothing to confirm', !noStatus.pending && /present, absent, half day or on leave/.test(noStatus.tts), noStatus.tts)
  const unknown = planAttendance({ members: STAFF, person: 'Gopal', status: 'absent', text: '', language: 'en-IN', nowMs: NOW })
  check('unknown staff -> asks, nothing to confirm', !unknown.pending && /Gopal/.test(unknown.tts))
  const none = planAttendance({ members: [], person: 'Ravi', status: 'absent', text: '', language: 'en-IN', nowMs: NOW })
  check('no staff yet -> says so', !none.pending && /No staff/.test(none.tts))
}

// ── stock ────────────────────────────────────────────────────────────────────
check('unit: kgs -> kg, bori -> bag, units -> pcs', normUnit('kgs') === 'kg' && normUnit('bori') === 'bag' && normUnit('units') === 'pcs')
check('op from words: "out of stock: oil"', stockOp(null, 'out of stock: oil') === 'out')
check('op from words: "sugar stock entha undi"', stockOp(null, 'sugar stock entha undi') === 'check')
check('op from words: "add 20 kg rice to stock"', stockOp(null, 'add 20 kg rice to stock', 20) === 'add')
check('item: "oil" -> Sunflower Oil', matchItem(ITEMS, 'oil').match?.id === 'i3')
{
  const p = planStock({ items: ITEMS, item: 'rice', quantity: 20, unit: 'kg', op: 'add', text: 'add 20 kg rice to stock', language: 'en-IN' })
  check('"add 20 kg rice": read back item, quantity, unit', p.tts === 'Add 20 kg Rice to stock? It will be 45 kg. Yes or no?', p.tts)
  const w = stockWrites(p.pending, { workspaceId: 'w1', nowISO: 'T' })
  check('after yes: rice 25 -> 45 and a +20 movement', w.update.id === 'i1' && w.update.current_stock === 45 && w.movement.change === 20 && w.movement.balance_after === 45 && w.movement.item_id === 'i1' && w.movement.workspace_id === 'w1', JSON.stringify(w))
}
{
  const p = planStock({ items: ITEMS, item: 'oil', quantity: null, unit: null, op: 'out', text: 'out of stock: oil', language: 'en-IN' })
  check('"out of stock: oil" read back', p.tts === 'Mark Sunflower Oil out of stock, zero left? Yes or no?', p.tts)
  const w = stockWrites(p.pending, { workspaceId: 'w1' })
  check('after yes: oil -> 0, movement -8', w.update.current_stock === 0 && w.movement.change === -8)
}
{
  const p = planStock({ items: ITEMS, item: 'sugar', quantity: null, unit: null, op: 'check', text: 'sugar stock entha undi', language: 'en-IN' })
  check('"sugar stock entha undi": answers', p.tts === 'Sugar: 12 kg in stock.', p.tts)
  check('a stock question writes nothing (no read-back to confirm)', p.pending === null && p.readOnly === true)
  const te = planStock({ items: ITEMS, item: 'sugar', op: 'check', text: 'sugar stock entha undi', language: 'te-IN' })
  check('stock answer in Telugu', /Sugar స్టాక్‌లో 12 kg ఉంది/.test(te.tts), te.tts)
}
{
  const p = planStock({ items: ITEMS, item: 'sugar', quantity: 5, unit: 'kg', op: 'remove', text: '', language: 'en-IN' })
  check('remove: read back with what is left', p.tts === 'Take 5 kg Sugar out of stock? It will be 7 kg. Yes or no?', p.tts)
  const tooMuch = planStock({ items: ITEMS, item: 'sugar', quantity: 50, unit: 'kg', op: 'remove', text: '', language: 'en-IN' })
  check('remove more than is there: asks, nothing to confirm', tooMuch.pending === null && /Only 12 kg/.test(tooMuch.tts), tooMuch.tts)
  const unit = planStock({ items: ITEMS, item: 'rice', quantity: 2, unit: 'bags', op: 'add', text: '', language: 'en-IN' })
  check('a different unit (bags into kg): asks, nothing to confirm', unit.pending === null && /counted in kg/.test(unit.tts), unit.tts)
  const howMuch = planStock({ items: ITEMS, item: 'rice', quantity: null, op: 'add', text: 'add rice to stock', language: 'en-IN' })
  check('no quantity: asks how much', howMuch.pending === null && howMuch.tts === 'How much Rice?', howMuch.tts)
  const fresh = planStock({ items: ITEMS, item: 'atta', quantity: 10, unit: 'kg', op: 'add', text: '', language: 'en-IN' })
  check('a new item: read back as new', fresh.pending?.item_id === null && /Atta is not in your stock list. Add it with 10 kg\? Yes or no\?/.test(fresh.tts), fresh.tts)
  const w = stockWrites(fresh.pending, { workspaceId: 'w1' })
  check('new item after yes: insert with 10 kg', w.insertItem?.name === 'Atta' && w.insertItem.current_stock === 10 && w.insertItem.unit === 'kg' && w.insertItem.workspace_id === 'w1')
  const missingRemove = planStock({ items: ITEMS, item: 'atta', quantity: 3, op: 'remove', text: '', language: 'en-IN' })
  check('removing an item that is not there: says so, nothing to confirm', missingRemove.pending === null && /could not find atta/.test(missingRemove.tts))
  check('a write that would go below zero is refused', stockWrites({ type: 'stock', op: 'remove', item_id: 'i1', change: -30, after: -5 }, { workspaceId: 'w1' }) === null)
  const hi = planStock({ items: ITEMS, item: 'rice', quantity: 20, unit: 'kg', op: 'add', text: '', language: 'hi-IN' })
  check('stock read back in Hindi', /Rice के स्टॉक में 20 kg जोड़ दूँ\? कुल 45 kg होगा। हाँ या ना बोलिए।/.test(hi.tts), hi.tts)
}

// ── payroll: a draft, never a payment ────────────────────────────────────────
{
  const members = [
    { id: 'm1', name: 'Ravi', salary_type: 'monthly', basic_salary: 13000 },
    { id: 'm2', name: 'Lakshmi Devi', salary_type: 'daily', daily_wage: 500 },
  ]
  const logs = [
    ...Array.from({ length: 10 }, (_, i) => ({ member_id: 'm1', log_date: `2026-10-${String(i + 1).padStart(2, '0')}`, status: 'present' })),
    { member_id: 'm1', log_date: '2026-10-11', status: 'half_day' },
    { member_id: 'm1', log_date: '2026-10-12', status: 'absent' },
    { member_id: 'm2', log_date: '2026-10-01', status: 'present' },
    { member_id: 'm2', log_date: '2026-10-02', status: 'late' },
    { member_id: 'm2', log_date: '2026-09-30', status: 'present' },   // last month: not counted
  ]
  check('pay period: 1 Oct to today', payPeriod(NOW).start === '2026-10-01' && payPeriod(NOW).end === TODAY && payPeriod(NOW).month === 'October')
  const one = payrollDraft({ members, logs, person: 'Ravi', text: 'Ravi ki entha jeetham', nowMs: NOW, language: 'en-IN' })
  check('Ravi: 10.5 days at 13000/26 = 5250', one.draft.rows[0].days_worked === 10.5 && one.draft.rows[0].amount === 5250, JSON.stringify(one.draft.rows[0]))
  check('Ravi: spoken draft', one.tts.startsWith('Draft for October: Ravi, 10.5 days worked, ₹5,250.'), one.tts)
  check('the draft says nothing is paid and payment needs the PIN', /Nothing is paid by voice/.test(one.tts) && /PIN/.test(one.tts))
  check('the draft is marked draft and unpaid', one.draft.status === 'draft' && one.draft.paid === false)
  const all = payrollDraft({ members, logs, person: null, text: "prepare this month's salary", nowMs: NOW, language: 'en-IN' })
  check('everyone: Lakshmi 2 days x 500 = 1000 (late counts, last month does not)', all.draft.rows[1].amount === 1000, JSON.stringify(all.draft.rows[1]))
  check('everyone: total 6250 spoken', all.draft.total === 6250 && /2 staff, ₹6,250 in all/.test(all.tts), all.tts)
  const te = payrollDraft({ members, logs, person: 'Ravi', text: '', nowMs: NOW, language: 'te-IN' })
  check('payroll in Telugu, with the PIN line', /డ్రాఫ్ట్/.test(te.tts) && /PIN/.test(te.tts), te.tts)
  const empty = payrollDraft({ members, logs: [], person: null, text: '', nowMs: NOW, language: 'en-IN' })
  check('no attendance yet: says so', /No attendance is recorded for October/.test(empty.tts))
  const noSalary = payrollDraft({ members: [{ id: 'x', name: 'Gopi', salary_type: 'monthly' }], logs: [{ member_id: 'x', log_date: '2026-10-01', status: 'present' }], person: 'Gopi', nowMs: NOW, language: 'en-IN' })
  check('no salary set: says so', /Gopi has no salary set/.test(noSalary.tts), noSalary.tts)
  check('payroll writes nothing: business-voice has no payroll write', !/payroll_records/.test(src('src/lib/business-voice.js')))
}

// ── the read-back and its answer ─────────────────────────────────────────────
{
  const asked = (ws, at = NOW - 30_000, action = BIZ_ASKED) => [{ action, created_at: new Date(at).toISOString(), details: { workspace_id: ws, pending: { type: 'attendance' }, lang: 'en' } }]
  check('pending in the same workspace', !!pendingBiz(asked('w1'), 'w1', NOW))
  check('NOT pending from another workspace', pendingBiz(asked('w1'), 'w2', NOW) === null)
  check('NOT pending in personal mode', pendingBiz(asked('w1'), null, NOW) === null)
  check('NOT pending once answered', pendingBiz(asked('w1', NOW - 10_000, BIZ_ANSWERED), 'w1', NOW) === null)
  check('NOT pending after the window', pendingBiz(asked('w1', NOW - BIZ_WINDOW_MS - 1000), 'w1', NOW) === null)
  check('"yes" / "avunu" / "haan" -> yes', ['yes', 'avunu', 'haan ji', 'అవును', 'हाँ'].every((t) => readBizAnswer(t) === 'yes'))
  check('"no" / "vaddu" -> no', ['no', 'vaddu', 'nahi'].every((t) => readBizAnswer(t) === 'no'))
  check('"haan salary bhej do" is NOT a yes', readBizAnswer('haan salary bhej do') === 'other')
  check('"yes mark everyone absent" is NOT a yes', readBizAnswer('yes mark everyone absent') === 'other')
}

// ── zero business writes without a spoken yes ────────────────────────────────
for (const type of [BIZ_TYPE.attendance, BIZ_TYPE.stock]) {
  const none = bizDecision(type, { spokenYes: false, unlocked: true, doneThisHour: 0 })
  check(`${type}: no spoken yes -> ask, never do`, none.decision === DECISION.ASK_YES, JSON.stringify(none))
  const locked = bizDecision(type, { spokenYes: true, unlocked: false, doneThisHour: 0 })
  check(`${type}: yes on a locked phone -> not do`, locked.decision === DECISION.ASK_UNLOCK)
  const unknown = bizDecision(type, { spokenYes: true, unlocked: true, doneThisHour: null })
  check(`${type}: hourly count unknown -> refuse`, unknown.decision === DECISION.REFUSE)
  const ok = bizDecision(type, { spokenYes: true, unlocked: true, doneThisHour: 0 })
  check(`${type}: spoken yes + unlocked -> do`, ok.decision === DECISION.DO)
  const paused = decide({ type }, { spokenYes: true, unlocked: true }, { doneThisHour: 0, settings: { actions_paused: true } })
  check(`${type}: remote off-switch wins`, paused.decision === DECISION.REFUSE)
}

// ── the capture route: the order of things ───────────────────────────────────
{
  const r = src('src/app/api/voice/capture/route.js')
  const block = r.slice(r.indexOf('ATTENDANCE / STOCK / PAYROLL: READ BACK'), r.indexOf("if (llmAssist && llmAssist.confidence >= 0.55) {\n    // Map the brain's vocabulary"))
  check('found the business block', block.length > 500)
  const gate = block.indexOf('if (!bizWorkspaceId)')
  const firstRead = Math.min(...['business_members', 'inventory_items', 'attendance_logs', BIZ_ASKED].map((t) => {
    const i = block.indexOf(t === BIZ_ASKED ? 'BIZ_ASKED' : `'${t}'`); return i < 0 ? Infinity : i
  }))
  check('personal mode returns before any business table is touched', gate > 0 && gate < firstRead)
  check('personal mode reply is business_only and writes no keep', /business_only/.test(block.slice(gate, gate + 400)) && /not_saved: true/.test(block.slice(gate, gate + 400)))
  check('the business block never writes a business table', !/\.(insert|upsert|update)\(/.test(block.replace(/from\('audit_log'\)\.insert/g, '')), 'a write in the ask turn')
  check('permission is checked before reading', block.indexOf('check_biz_permission') > gate && block.indexOf('check_biz_permission') < firstRead)
  check('the business block returns before any keep insert', r.indexOf('ATTENDANCE / STOCK / PAYROLL: READ BACK') < r.indexOf(".from('keeps')\n    .insert("))

  const yes = r.slice(r.indexOf('"MARK RAVI ABSENT TODAY? YES OR NO?"'), r.indexOf('IS THIS THE ANSWER TO THE QUESTION WE JUST ASKED?'))
  const decided = yes.indexOf('bizSafety.decision !== DECISION.DO')
  const writes = ["from('attendance_logs').upsert", "from('inventory_items').insert", "from('inventory_items')\n            .update", "from('stock_movements').insert"]
    .map((w) => yes.indexOf(w))
  check('every business write sits after the safety decision', decided > 0 && writes.every((i) => i > decided), JSON.stringify({ decided, writes }))
  check('the safety decision sits inside the spoken-yes branch', yes.indexOf("said === 'yes'") > 0 && yes.indexOf("said === 'yes'") < decided)
  check('the answer is read with readBizAnswer (isSpokenYes)', /readBizAnswer\(text\)/.test(yes))
  check('a locked phone keeps the question open (not BIZ_ANSWERED)', /action: 'voice\.biz_held'/.test(yes) && !/action: 'voice\.biz_held'/.test(src('src/lib/business-voice.js')) && "voice.biz_held" !== BIZ_ANSWERED)
  check('the pending question is tied to this workspace', /pendingBiz\(deleteRows, bizWorkspaceId\)/.test(yes))
  check('no route path pays salary: payroll_records is never written by voice', !/from\('payroll_records'\)/.test(r))
  // The dock's business_workspace_id reaches ONLY the two business blocks:
  // the older ledger path and the keep insert still read workspace_id alone.
  const outside = r.replace(yes, '').replace(block, '')
  check('bizWorkspaceId is used only in the business blocks (plus its declaration)', (outside.match(/bizWorkspaceId/g) || []).length === 1, String((outside.match(/bizWorkspaceId/g) || []).length))
  check('the ledger path still needs workspace_id itself', /if \(workspace_id && BIZ_INTENT_TYPES\.has\(parsed\.type\)\)/.test(r))
  check('a workspace must look like a uuid', /UUID\.test\(w\)/.test(r))
  const dock = src('src/lib/context/aaria.jsx')
  check('dock sends business_workspace_id, never workspace_id', /business_workspace_id: workspaceId/.test(dock) && !/\bworkspace_id: workspaceId/.test(dock))
  check('dock only resolves a workspace on a /b/ screen', /\/\^\\\/b\(\\\/\|\$\)\/\.test\(pathname/.test(dock))
}

// ── languages ────────────────────────────────────────────────────────────────
for (const lang of ['en-IN', 'te-IN', 'hi-IN']) {
  check(`business-only line in ${lang}`, bizLine('business_only', lang).length > 10)
  check(`never-pays line in ${lang} mentions PIN`, /PIN/.test(bizLine('pay_never', lang)))
}
check('istDate is India time (23:00 UTC is the next day)', istDate(Date.parse('2026-10-15T23:00:00Z')) === '2026-10-16')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
