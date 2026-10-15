// tests/brain-turn.test.mjs - confirm / delete / pay / none / trip / compliance.
// (15 Oct 2026.) Each new intent may reply, ask, or read back; none of them
// acts unasked. Plain node, no packages.
import { readFileSync } from 'node:fs'
import {
  BRAIN_TYPE, NO_KEEP_INTENTS, DELETE_ASKED, DELETE_ANSWERED, DELETE_WINDOW_MS,
  planNoKeepTurn, isStrayConfirmation, matchKeepForDelete, deleteQuestion,
  pendingDelete, readDeleteAnswer, deleteDecision, archivePatch,
} from '../src/lib/brain-turn.js'
import { LEVEL, DECISION, levelFor, decide, mayActUnasked, isSpokenYes, isSpokenNo } from '../src/lib/action-levels.js'
import { INTENTS, parseBrainResponse } from '../src/lib/aaria-llm.js'

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
  ok ? pass++ : fail++
}
const parse = (obj) => parseBrainResponse(JSON.stringify(obj), { clean: 'x', nowISO: '2026-10-15T06:00:00.000Z', language: 'en-IN', model: 'm' }).result

// ── the brain knows the new words; out-of-scope ones are untouched ──────────
for (const i of ['trip', 'compliance', 'confirm', 'delete', 'pay', 'none']) {
  check(`brain intent list has ${i}`, INTENTS.includes(i))
  check(`parser keeps ${i} (not filed as note)`, parse({ intent: i, confidence: 0.9 }).intent === i)
}
for (const i of ['attendance', 'stock', 'payroll']) {
  check(`${i} is still not a brain intent (out of scope)`, !INTENTS.includes(i))
  check(`${i} still parses to note, exactly as before`, parse({ intent: i, confidence: 0.9 }).intent === 'note')
}

// ── the level table ─────────────────────────────────────────────────────────
check('delete -> delete_note, spoken yes', BRAIN_TYPE.delete === 'delete_note' && levelFor({ type: 'delete_note' }) === LEVEL.SPOKEN_YES)
check('pay -> money_transfer, PIN', BRAIN_TYPE.pay === 'money_transfer' && levelFor({ type: 'money_transfer' }) === LEVEL.PIN)
check('none -> no action', levelFor({ type: 'none' }) === LEVEL.NO_ACTION)
check('confirm -> no action', levelFor({ type: 'confirm' }) === LEVEL.NO_ACTION)
check('trip -> read back', levelFor({ type: 'trip' }) === LEVEL.READ_BACK)
check('compliance -> read back', levelFor({ type: 'compliance' }) === LEVEL.READ_BACK)
check('attendance / stock / payroll stay unlisted (never)', ['attendance', 'stock', 'payroll'].every((t) => levelFor({ type: t }) === LEVEL.NEVER))
{
  const r = decide({ type: 'none' }, { spokenYes: true, unlocked: true, pin: true })
  check('no action is never "do", even with every proof', r.decision === DECISION.NOTHING, JSON.stringify(r))
  check('confirm is never "do"', decide({ type: 'confirm' }, { spokenYes: true, unlocked: true }).decision === DECISION.NOTHING)
  check('none / confirm may not happen unasked', !mayActUnasked('none') && !mayActUnasked('confirm'))
  check('a voice delete may not happen unasked', !mayActUnasked('delete_note'))
  check('a payment may not happen unasked', !mayActUnasked('money_transfer'))
  check('remote off-switch still wins over no-action', decide({ type: 'none' }, {}, { settings: { actions_paused: true } }).decision === DECISION.REFUSE)
}
check('the four no-keep intents', ['none', 'confirm', 'pay', 'delete'].every((i) => NO_KEEP_INTENTS.has(i)) && NO_KEEP_INTENTS.size === 4)
check('trip and compliance DO save', !NO_KEEP_INTENTS.has('trip') && !NO_KEEP_INTENTS.has('compliance'))

// ── a stray yes / no answers nothing ─────────────────────────────────────────
for (const t of ['yes', 'avunu', 'haan', 'అవును', 'हाँ, ठीक है', 'sare, cheyyi', 'ok', 'no', 'nahi, rehne do', 'No, వద్దు cancel', 'नहीं']) {
  check(`stray confirmation: "${t}"`, isStrayConfirmation(t))
}
for (const t of ['yes remind me to call Ravi tomorrow', 'haan paise bhejo', 'avunu repu Ravi ki call cheyyi', 'no milk today', 'thank you']) {
  check(`a real sentence is not a stray confirmation: "${t}"`, !isStrayConfirmation(t))
}
{
  const p = planNoKeepTurn({ intent: 'confirm', language: 'en-IN' })
  check('stray "yes" with nothing pending: saves nothing', p.saves === false && p.kind === 'confirm')
  check('stray "yes": asks what they mean', /What would you like/.test(p.tts), p.tts)
  check('stray "yes": the decision is nothing', p.safety.decision === DECISION.NOTHING)
  const te = planNoKeepTurn({ intent: 'confirm', language: 'te-IN' })
  check('stray "avunu": asked in Telugu', /ఏం చేయమంటారు/.test(te.tts), te.tts)
  const hi = planNoKeepTurn({ intent: 'confirm', language: 'hi-IN' })
  check('stray "haan": asked in Hindi', /क्या करना है/.test(hi.tts), hi.tts)
  const pend = planNoKeepTurn({ intent: 'confirm', language: 'en-IN', pendingQuestionText: 'When should I remind you?' })
  check('a yes while a question is open: that question is asked again', pend.tts === 'When should I remind you?')
}

// ── none ─────────────────────────────────────────────────────────────────────
{
  const p = planNoKeepTurn({ intent: 'none', brainReply: "You're welcome!", language: 'en-IN' })
  check('none: brain reply used, nothing saved', p.tts === "You're welcome!" && p.saves === false)
  const q = planNoKeepTurn({ intent: 'none', brainReply: '  ', language: 'te-IN' })
  check('none with no reply: a brief default in the user language', q.tts === 'సరే.', q.tts)
}

// ── pay ──────────────────────────────────────────────────────────────────────
{
  const p = planNoKeepTurn({ intent: 'pay', brainReply: 'I will send 500 to Ramesh', language: 'en-IN' })
  check('pay: nothing saved', p.saves === false && p.type === 'money_transfer')
  check('pay: the brain\'s promise is NOT spoken', !/send 500/.test(p.tts), p.tts)
  check('pay: says payments need the app and PIN', /app/.test(p.tts) && /PIN/.test(p.tts), p.tts)
  check('pay: the decision is ask_pin, never do', p.safety.decision === DECISION.ASK_PIN && p.safety.level === LEVEL.PIN, JSON.stringify(p.safety))
  check('pay: Telugu reply', /PIN/.test(planNoKeepTurn({ intent: 'pay', language: 'te-IN' }).tts))
}

// ── delete: which item ───────────────────────────────────────────────────────
const items = [
  { id: 'k1', content: 'Call Ravi tomorrow', contact_name: 'Ravi', intent_type: 'reminder' },
  { id: 'k2', content: 'Go to the gym at 6', intent_type: 'reminder' },
  { id: 'k3', content: 'పాలు కొనాలి', intent_type: 'reminder' },
  { id: 'k4', content: 'Parking on third floor', intent_type: 'note' },
  { id: 'k5', content: 'Call Ravi about the rent', contact_name: 'Ravi', intent_type: 'task' },
  { id: 'k6', content: 'Lunch 450', intent_type: 'expense' },
]
{
  const r = matchKeepForDelete(items, { item: 'gym', text: 'delete the reminder about the gym' })
  check('"delete the reminder about the gym" -> the gym reminder', r.match?.id === 'k2', JSON.stringify(r))
  const t = matchKeepForDelete(items, { item: null, text: 'పాలు కొనాలనే రిమైండర్ తీసేయ్' })
  check('Telugu, inflected: "పాలు కొనాలనే రిమైండర్ తీసేయ్" -> పాలు కొనాలి', t.match?.id === 'k3', JSON.stringify(t))
  const amb = matchKeepForDelete(items, { item: null, person: 'Ravi', text: 'delete the Ravi one' })
  check('two items about Ravi -> ask which one, list both', amb.candidates?.length === 2 && !amb.match, JSON.stringify(amb))
  const narrowed = matchKeepForDelete(items, { item: 'call Ravi tomorrow', person: 'Ravi', text: 'delete call Ravi tomorrow reminder' })
  check('name + words narrow it to one', narrowed.match?.id === 'k1', JSON.stringify(narrowed))
  const none = matchKeepForDelete(items, { item: 'dentist', text: 'delete the dentist reminder' })
  check('nothing matches -> no guess', none.none === true, JSON.stringify(none))
  const nobody = matchKeepForDelete(items, { person: 'Suresh', text: 'Suresh reminder delete karo' })
  check('a name that matches nothing -> no guess', nobody.none === true, JSON.stringify(nobody))
  const last = matchKeepForDelete(items, { text: 'Last expense entry ని delete చెయ్యి' })
  check('"last expense entry" -> the newest expense', last.match?.id === 'k6', JSON.stringify(last))
  check('empty list -> none', matchKeepForDelete([], { text: 'delete gym' }).none === true)

  check('read-back question names the item, asks yes or no',
    deleteQuestion({ match: items[0] }, 'en-IN') === "Delete 'Call Ravi tomorrow'? Yes or no?", deleteQuestion({ match: items[0] }, 'en-IN'))
  check('ambiguous -> "which one"', /Which one/.test(deleteQuestion(amb, 'en-IN')) && /rent/.test(deleteQuestion(amb, 'en-IN')))
  check('not found -> asks which item', /could not find/.test(deleteQuestion(none, 'en-IN')))
  check('Hindi read-back', /हटा दूँ/.test(deleteQuestion({ match: items[1] }, 'hi-IN')))
}

// ── delete: the read-back is a question, the yes is the only key ────────────
{
  const now = Date.parse('2026-10-15T06:00:00.000Z')
  const asked = { action: DELETE_ASKED, details: { keep_id: 'k2', content: 'Go to the gym at 6', lang: 'en-IN' }, created_at: new Date(now - 30_000).toISOString() }
  check('a fresh read-back is pending', pendingDelete([asked], now)?.keep_id === 'k2')
  check('an answered read-back is not pending', pendingDelete([{ action: DELETE_ANSWERED, details: { keep_id: 'k2' }, created_at: asked.created_at }], now) === null)
  check('a stale read-back is not pending', pendingDelete([{ ...asked, created_at: new Date(now - DELETE_WINDOW_MS - 1000).toISOString() }], now) === null)
  check('no rows -> nothing pending', pendingDelete([], now) === null && pendingDelete(null, now) === null)

  for (const t of ['yes', 'avunu', 'haan', 'అవును', 'हाँ']) check(`"${t}" answers yes`, readDeleteAnswer(t) === 'yes')
  for (const t of ['no', 'vaddu', 'nahi', 'వద్దు', 'नहीं']) check(`"${t}" answers no`, readDeleteAnswer(t) === 'no')
  for (const t of ['haan aur Ravi ko call karo', 'remind me to buy milk', 'delete everything']) check(`"${t}" is not an answer`, readDeleteAnswer(t) === 'other')

  check('no yes yet -> ask_yes (the read-back)', deleteDecision({ spokenYes: false, unlocked: true, doneThisHour: 0 }).decision === DECISION.ASK_YES)
  check('yes + phone unlocked -> do', deleteDecision({ spokenYes: true, unlocked: true, doneThisHour: 0 }).decision === DECISION.DO)
  check('yes but phone not known unlocked -> ask_unlock', deleteDecision({ spokenYes: true, unlocked: false, doneThisHour: 0 }).decision === DECISION.ASK_UNLOCK)
  check('yes but hourly count unknown -> refuse', deleteDecision({ spokenYes: true, unlocked: true, doneThisHour: null }).decision === DECISION.REFUSE)

  const patch = archivePatch('2026-10-15T06:00:00.000Z')
  check('carrying it out archives: status closed + archived_at', patch.status === 'closed' && patch.loop_state === 'closed' && patch.archived_at === '2026-10-15T06:00:00.000Z')
}

// ── the capture route: order and shape, read from source ────────────────────
{
  const src = readFileSync(new URL('../src/app/api/voice/capture/route.js', import.meta.url), 'utf8')
  const at = (s) => src.indexOf(s)
  const stray = at('if (isStrayConfirmation(text))')
  const firstParse = at('let parsed = parseIntent(text)')
  const brainCall = at('llmAssist = await aariaUnderstandLLM(')
  const noKeep = at('NO_KEEP_INTENTS.has(llmAssist.intent)')
  const insert = at(".from('keeps')\n    .insert(")
  check('stray yes/no is handled before the regex parser and the brain', stray > 0 && stray < firstParse && stray < brainCall)
  check('the stray yes/no turn returns without saving', /isStrayConfirmation\(text\)\) \{[\s\S]{0,1200}?return NextResponse\.json\(\{\s*ok: true, not_saved: true/.test(src))
  check('confirm / delete / pay / none return before the keep insert', noKeep > brainCall && noKeep < insert)
  check('a pending delete is read before anything else is parsed', at('pendingDelete(deleteRows)') > 0 && at('pendingDelete(deleteRows)') < firstParse)
  check('the archive is gated on the level table saying do', /delSafety\.decision !== DECISION\.DO[\s\S]{0,600}return[\s\S]{0,600}update\(archivePatch\(\)\)/.test(src))
  check('the route never hard-deletes a keep', !/from\('keeps'\)\s*\.delete\(/.test(src))
  check('only readDeleteAnswer (isSpokenYes) leads to the archive', /said === 'yes'[\s\S]{0,1500}archivePatch/.test(src))
  check('a brain trip never auto-opens Maps', /parsed\.type === 'trip' && llmAssist\?\.intent === 'trip'/.test(src))
}

// ── every stray yes / no in the measured cases is caught BEFORE the brain ───
// So in production none of them can become a keep, whatever the brain says.
{
  const cases = JSON.parse(readFileSync(new URL('./fixtures/understanding-cases.json', import.meta.url), 'utf8'))
  const confirms = cases.filter((c) => c.expect?.intent === 'confirm')
  const missed = confirms.filter((c) => !isStrayConfirmation(c.text)).map((c) => c.text)
  check(`all ${confirms.length} stray yes/no cases are answered by the route without the brain`, confirms.length >= 24 && missed.length === 0, JSON.stringify(missed))
}

// ── isSpokenNo matches the same shape as isSpokenYes ────────────────────────
check('"no" is not a yes and "yes" is not a no', !isSpokenYes('no') && !isSpokenNo('yes'))
check('a long sentence is neither', !isSpokenNo('no I want you to remind me tomorrow morning'))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
