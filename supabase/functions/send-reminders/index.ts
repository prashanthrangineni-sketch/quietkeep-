// supabase/functions/send-reminders/index.ts
//
// THIS FILE WAS NOT IN THE REPOSITORY UNTIL 26 SEPTEMBER 2026.
//
// It ran in production, on a five-minute pg_cron tick, and existed only inside
// Supabase. No history, no review, no way to see any of what follows by reading
// this repo. That is why the bug below survived for months.
//
// ─── THE BUG ────────────────────────────────────────────────────────────────
//
// Signing in by mobile number gives the account a SYNTHETIC email address:
//
//     919515479595@quietkeep.com
//
// quietkeep.com is the domain this function sends FROM. It does not receive.
// There is no such mailbox and there never was. But the domain is verified with
// Resend, so Resend accepts the message, returns 200, and sendEmail() reports
// success. This function then wrote reminder_sent to audit_log and set
// is_active = false.
//
// So the whole chain LOOKED healthy from every angle a database query can see:
// the reminder existed, it was linked to its keep, it was marked sent, it was
// deactivated on schedule. And the user's phone stayed silent. Confirmed on
// 26 September 2026: three Telugu reminders due at 09:00 and 10:00 IST, all
// three recorded as sent at 08:55 and 09:55, none of them received.
//
// Marking an undeliverable reminder as sent is worse than failing loudly. It
// destroys the only signal anyone had.
//
// ─── WHAT THIS VERSION DOES ─────────────────────────────────────────────────
//
//   * An address that cannot receive mail is detected BEFORE sending. Nothing
//     is sent, nothing is marked sent, the reminder stays active, and the
//     failure is recorded with a reason that names the cause.
//   * De-duplication uses notifications_sent.source_id, added in the migration
//     alongside this change. The old code wrote keeps.id into intent_id, which
//     carries a foreign key to intents(id) and rejected every insert — so the
//     de-dup ledger was always empty and every reminder went out twice, one
//     tick apart.
//
// ─── WHAT THIS VERSION STILL DOES NOT DO ────────────────────────────────────
//
// It does not deliver to a phone-only account. Email is the only channel here,
// and a phone-only account has no email. That needs a real channel (push, SMS
// or WhatsApp) and is deliberately NOT smuggled into this change: the point of
// this one is to stop the system lying about it. Until that channel exists,
// these reminders sit active and visibly failing, which is the honest state.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// No hardcoded fallback: the key that used to sit here was revoked, so falling
// back to it meant every send failed silently.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const FROM = 'QuietKeep <reminders@quietkeep.com>'

// The domain QuietKeep sends FROM. Anything addressed here is a placeholder
// created by the sign-in flow, not a mailbox. Kept as a constant so that if the
// sending domain ever changes, this check changes with it.
const SENDING_DOMAIN = 'quietkeep.com'

/**
 * Can this address actually receive an email?
 *
 * Returns the reason it cannot, or null when it can. Only structural checks —
 * no mailbox probing — because the failure we are catching is structural: an
 * address on our own send-only domain, usually the user's phone number.
 */
function undeliverableReason(email: string | undefined | null): string | null {
  const address = String(email || '').trim().toLowerCase()
  if (!address || !address.includes('@')) return 'no_email_on_account'
  const [local, domain] = address.split('@')
  if (domain === SENDING_DOMAIN) {
    // e.g. 919515479595@quietkeep.com from phone-OTP sign-in.
    return /^\d+$/.test(local)
      ? 'synthetic_phone_email_cannot_receive'
      : 'address_on_send_only_domain'
  }
  return null
}

// --- cron authorisation -------------------------------------------------
// This function is invoked only by pg_cron, which sends X-DISPATCH-SECRET.
// The expected value lives in Supabase Vault; check_dispatch_secret() is a
// SECURITY DEFINER RPC executable by service_role only.
async function isAuthorisedCaller(req: Request): Promise<boolean> {
  const secret = req.headers.get('x-dispatch-secret')
  if (!secret) return false
  const { data, error } = await supabase.rpc('check_dispatch_secret', { p_secret: secret })
  if (error) { console.error('[send-reminders] secret check failed:', error.message); return false }
  return data === true
}

const UNAUTHORISED = () => new Response(
  JSON.stringify({ error: 'unauthorized' }),
  { status: 401, headers: { 'Content-Type': 'application/json' } },
)
const json = (o: unknown, status = 200) => new Response(
  JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } },
)
// ------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (!(await isAuthorisedCaller(req))) return UNAUTHORISED()

  // Ops probes. Neither ever reveals the key itself.
  //   {"mode":"healthcheck"}          - is a key present and does Resend accept it?
  //   {"mode":"testsend","to":"..."} - send one real test email and report Resend's answer
  let reqBody: Record<string, unknown> = {}
  try { reqBody = await req.json() } catch { reqBody = {} }

  if (reqBody?.mode === 'healthcheck' || reqBody?.mode === 'testsend') {
    const hint = RESEND_API_KEY ? RESEND_API_KEY.slice(0, 9) + '...' : null
    if (!RESEND_API_KEY) return json({ resend_key_present: false, resend_key_hint: null })

    if (reqBody.mode === 'testsend') {
      const to = String(reqBody.to || '').trim()
      if (!to) return json({ error: 'to_required' }, 400)
      // The same guard the real path uses, so a test against a synthetic
      // address reports the truth instead of a misleading 200.
      const why = undeliverableReason(to)
      if (why) return json({ mode: 'testsend', undeliverable: why, resend_status: null, resend_ok: false })
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [to],
          subject: 'QuietKeep delivery test',
          html: '<p>This is an automated delivery test from QuietKeep. If you can read this, reminder emails are working again.</p>',
        }),
      })
      return json({ mode: 'testsend', resend_key_hint: hint, resend_status: r.status, resend_ok: r.ok, detail: (await r.text()).slice(0, 220) })
    }

    let status = 0
    let detail = ''
    try {
      const r = await fetch('https://api.resend.com/domains', { headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` } })
      status = r.status
      detail = (await r.text()).slice(0, 200)
    } catch (e) { detail = String(e) }
    // A sending-only key is REJECTED on /domains with restricted_api_key - that
    // is a healthy key, not a broken one. Only "API key is invalid" is fatal.
    const looks_valid = status === 200 || detail.includes('restricted_api_key')
    return json({ resend_key_present: true, resend_key_hint: hint, resend_status: status, looks_valid, detail })
  }

  if (!RESEND_API_KEY) {
    console.error('[send-reminders] RESEND_API_KEY is not set - refusing to run so reminders are not silently marked as sent')
    return json({ error: 'RESEND_API_KEY not configured', sent: 0 }, 503)
  }

  try {
    const now = new Date()
    const windowStart = new Date(now.getTime() - 5 * 60 * 1000)
    const windowEnd   = new Date(now.getTime() + 5 * 60 * 1000)

    const { data: dueKeeps, error: keepsError } = await supabase
      .from('keeps')
      .select('id, user_id, content, reminder_at, intent_type')
      .not('reminder_at', 'is', null)
      .eq('status', 'open')
      .gte('reminder_at', windowStart.toISOString())
      .lte('reminder_at', windowEnd.toISOString())
    if (keepsError) throw keepsError

    const { data: dueReminders, error: remError } = await supabase
      .from('reminders')
      .select('id, user_id, reminder_text, scheduled_for, recurrence')
      .eq('is_active', true)
      .gte('scheduled_for', windowStart.toISOString())
      .lte('scheduled_for', windowEnd.toISOString())
    if (remError) throw remError

    let sent = 0
    let failed = 0
    // Reminders we refused to pretend to send. Counted separately from `failed`
    // because the cause is different and so is the fix: `failed` means Resend
    // said no, `undeliverable` means there was never anywhere to send it.
    let undeliverable = 0
    // Bookkeeping writes that failed AFTER a successful send. Each dedup or
    // reschedule failure means the same email goes out again on the next tick.
    let dedupFailed = 0
    let auditFailed = 0
    let rescheduleFailed = 0

    for (const keep of (dueKeeps || [])) {
      if (await checkAlreadySent(keep.id, 'keep_reminder')) continue
      const { data: userData } = await supabase.auth.admin.getUserById(keep.user_id)
      const userEmail = userData?.user?.email

      const why = undeliverableReason(userEmail)
      if (why) {
        // Do NOT send, do NOT mark sent. A keep has no is_active flag, so it
        // stays due and will be picked up the moment a real channel exists.
        await markUndeliverable(keep.user_id, keep.id, 'keep_reminder', why)
        undeliverable++
        continue
      }

      const ok = await sendEmail({
        to: userEmail!,
        subject: `⏰ QuietKeep Reminder: ${keep.content.substring(0, 60)}`,
        content: keep.content,
        remindTime: formatIST(keep.reminder_at),
      })
      if (!ok) {
        // Do NOT mark as sent - a failed delivery must stay retryable and visible.
        await markFailed(keep.user_id, keep.id, 'keep_reminder')
        failed++
        continue
      }
      const marked = await markSent(keep.user_id, keep.id, 'keep_reminder', now, { content: keep.content, reminder_at: keep.reminder_at })
      if (!marked.dedupOk) dedupFailed++
      if (!marked.auditOk) auditFailed++
      sent++
    }

    for (const rem of (dueReminders || [])) {
      if (await checkAlreadySent(rem.id, 'reminder')) continue
      const { data: userData } = await supabase.auth.admin.getUserById(rem.user_id)
      const userEmail = userData?.user?.email

      const why = undeliverableReason(userEmail)
      if (why) {
        // Leave is_active TRUE. This is the whole point of the change: the
        // reminder stays visibly outstanding instead of being retired as
        // delivered to an address that cannot receive it.
        await markUndeliverable(rem.user_id, rem.id, 'reminder', why)
        undeliverable++
        continue
      }

      const ok = await sendEmail({
        to: userEmail!,
        subject: `⏰ QuietKeep: ${rem.reminder_text.substring(0, 60)}`,
        content: rem.reminder_text,
        remindTime: formatIST(rem.scheduled_for),
      })
      if (!ok) {
        // Leave is_active/scheduled_for untouched so the next tick retries.
        await markFailed(rem.user_id, rem.id, 'reminder')
        failed++
        continue
      }
      const marked = await markSent(rem.user_id, rem.id, 'reminder', now, { reminder_text: rem.reminder_text, scheduled_for: rem.scheduled_for })
      if (!marked.dedupOk) dedupFailed++
      if (!marked.auditOk) auditFailed++
      // This update is what stops the reminder firing again. If it fails the
      // same email is re-sent on the next five-minute tick.
      if (rem.recurrence && rem.recurrence !== 'none') {
        const { error: rescheduleError } = await supabase.from('reminders')
          .update({ scheduled_for: nextOccurrence(rem.scheduled_for, rem.recurrence) }).eq('id', rem.id)
        if (rescheduleError) { console.error(`[send-reminders] RESCHEDULE FAILED for reminder ${rem.id} - it will re-send next tick: ${rescheduleError.message}`); rescheduleFailed++ }
      } else {
        const { error: deactivateError } = await supabase.from('reminders')
          .update({ is_active: false }).eq('id', rem.id)
        if (deactivateError) { console.error(`[send-reminders] DEACTIVATE FAILED for reminder ${rem.id} - it will re-send next tick: ${deactivateError.message}`); rescheduleFailed++ }
      }
      sent++
    }

    return json({
      sent, failed, undeliverable,
      dedup_failed: dedupFailed, audit_failed: auditFailed, reschedule_failed: rescheduleFailed,
      keeps_due: (dueKeeps || []).length, reminders_due: (dueReminders || []).length,
    }, failed > 0 ? 502 : 200)
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

function formatIST(ts: string): string {
  return new Date(ts).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

function nextOccurrence(current: string, recurrence: string): string {
  const d = new Date(current)
  if (recurrence === 'daily')   d.setDate(d.getDate() + 1)
  if (recurrence === 'weekly')  d.setDate(d.getDate() + 7)
  if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}

// source_id, NOT intent_id. intent_id carries a foreign key to intents(id) and
// a keeps.id or reminders.id is not in that table, so every write through it
// was rejected and this check always answered "not sent yet".
async function checkAlreadySent(sourceId: string, channel: string): Promise<boolean> {
  const { data } = await supabase.from('notifications_sent')
    .select('id').eq('source_id', sourceId).eq('channel', channel).maybeSingle()
  return !!data
}

// The notifications_sent insert is the dedup record read by checkAlreadySent();
// if it fails silently the same reminder is re-sent on the next tick.
async function markSent(
  userId: string, sourceId: string, channel: string, now: Date, payload: object,
): Promise<{ dedupOk: boolean; auditOk: boolean }> {
  const { error: dedupError } = await supabase.from('notifications_sent').insert({
    user_id: userId, source_id: sourceId, channel,
    notification_type: 'email', sent_at: now.toISOString(), payload,
  })
  if (dedupError) console.error(`[send-reminders] DEDUP WRITE FAILED for ${channel} ${sourceId} - it will re-send next tick: ${dedupError.message}`)
  const { error: auditError } = await supabase.from('audit_log').insert({
    user_id: userId, action: 'reminder_sent', service: 'send-reminders',
    details: { source_id: sourceId, channel },
  })
  if (auditError) console.error(`[send-reminders] audit_log insert failed for ${channel} ${sourceId}: ${auditError.message}`)
  return { dedupOk: !dedupError, auditOk: !auditError }
}

async function markFailed(userId: string, sourceId: string, channel: string) {
  const { error } = await supabase.from('audit_log').insert({
    user_id: userId, action: 'reminder_send_failed', service: 'send-reminders',
    details: { source_id: sourceId, channel, reason: 'resend_rejected' },
  })
  if (error) console.error('[send-reminders] could not record failure:', error.message)
}

// Deliberately a DIFFERENT action name from reminder_send_failed. "Resend said
// no" and "there is nowhere to send this" need different fixes, and a single
// action name would hide the second behind the first.
async function markUndeliverable(userId: string, sourceId: string, channel: string, reason: string) {
  console.error(`[send-reminders] UNDELIVERABLE ${channel} ${sourceId}: ${reason} - not sent, not marked sent, still outstanding`)
  const { error } = await supabase.from('audit_log').insert({
    user_id: userId, action: 'reminder_undeliverable', service: 'send-reminders',
    details: { source_id: sourceId, channel, reason },
  })
  if (error) console.error('[send-reminders] could not record undeliverable:', error.message)
}

async function sendEmail(
  { to, subject, content, remindTime }: { to: string; subject: string; content: string; remindTime: string },
): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,sans-serif;"><div style="max-width:520px;margin:0 auto;padding:32px 20px;"><div style="background:#0f0f1a;border:1px solid #1e1e2e;border-radius:16px;padding:24px;margin-bottom:20px;"><div style="font-size:28px;margin-bottom:12px;">⏰</div><div style="font-size:12px;color:#6366f1;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Your Reminder</div><div style="font-size:17px;color:#f1f5f9;font-weight:600;line-height:1.5;margin-bottom:16px;">${content}</div><div style="font-size:12px;color:#475569;">🕐 ${remindTime} IST</div></div><a href="https://quietkeep.com/dashboard" style="display:block;background:#6366f1;color:#fff;text-decoration:none;padding:14px;border-radius:10px;text-align:center;font-size:14px;font-weight:700;">Open QuietKeep →</a></div></body></html>`,
    }),
  })
  if (!res.ok) { console.error('[send-reminders] Resend error', res.status, await res.text()); return false }
  return true
}
