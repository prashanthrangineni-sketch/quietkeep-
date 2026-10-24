// tests/business-limits.test.mjs
// QuietKeep Business: Auto-reply and promotion limits enforced in code.
// (CARD AG-AARIA-25, founder decision 4, "plan as per market".)
// Plain node script, no external packages.

import {
  TZ_INDIA,
  PROMO_CONSTANTS,
  ALLOWED_AUTOREPLY_TOPICS,
  DISALLOWED_AUTOREPLY_TOPICS,
  HARD_BLOCKED_AUTOMATIONS,
  getIstParts,
  isWithinPromoHours,
  isOptOutMessage,
  classifyInboundTopic,
  sanitizeSnippet,
  evaluateAutoReply,
  evaluateOrderBooking,
  evaluateAutomationAction,
  evaluatePromotionSend,
  buildOwnerAuditLog,
} from '../src/lib/business-limits.js';
import { LEVEL, DECISION, levelFor, decide, mayActUnasked } from '../src/lib/action-levels.js';

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

// ── Helpers to construct exact IST timestamps ────────────────────────────────
function makeIstDate(year, month, day, hour, minute, second = 0) {
  // IST is UTC+05:30. Convert to UTC:
  const pad = (n) => String(n).padStart(2, '0');
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+05:30`;
  return new Date(iso);
}

// ── RULE 1: AUTO-REPLY ALLOWED ONLY FOR FAQs, TIMINGS, LOCATION, STOCKED ITEMS
{
  const mockWorkspace = {
    name: 'Sri Krishna General Store',
    timings: '09:00 AM - 09:30 PM (Mon-Sat), 10:00 AM - 02:00 PM (Sun)',
    address: 'Shop #4, Main Bazaar, Near Old Bus Stand, Vijayawada',
    faqs: {
      default: 'We accept UPI (PhonePe, Google Pay, Paytm) and Cash.',
      'do you accept upi': 'Yes, UPI QR code is available at the counter.',
    },
  };

  const mockItem = {
    name: 'Sona Masoori Rice',
    current_stock: 40,
    unit: 'kg',
    selling_price: 65,
  };

  // 1. FAQs
  const rFaq = evaluateAutoReply({
    topic: 'faq',
    text: 'do you accept upi',
    workspaceInfo: mockWorkspace,
  });
  check('auto-reply allowed: FAQ', rFaq.allowed && rFaq.decision === 'auto_reply' && rFaq.reply.includes('UPI'));

  // 2. Shop Timings
  const rTimings = evaluateAutoReply({
    text: 'What are your shop timings today?',
    workspaceInfo: mockWorkspace,
  });
  check('auto-reply allowed: Shop timings', rTimings.allowed && rTimings.decision === 'auto_reply' && rTimings.reply.includes('09:00 AM'));

  // 3. Shop Location
  const rLocation = evaluateAutoReply({
    text: 'Where is your shop located?',
    workspaceInfo: mockWorkspace,
  });
  check('auto-reply allowed: Location', rLocation.allowed && rLocation.decision === 'auto_reply' && rLocation.reply.includes('Vijayawada'));

  // 4. Item availability (stored in QuietKeep)
  const rAvail = evaluateAutoReply({
    text: 'Do you have Sona Masoori Rice in stock?',
    storedItem: mockItem,
    workspaceInfo: mockWorkspace,
  });
  check('auto-reply allowed: Item availability (in stock)', rAvail.allowed && rAvail.decision === 'auto_reply' && rAvail.reply.includes('In stock'));

  // 5. Item price (stored in QuietKeep)
  const rPrice = evaluateAutoReply({
    text: 'What is the price of Sona Masoori Rice?',
    storedItem: mockItem,
    workspaceInfo: mockWorkspace,
  });
  check('auto-reply allowed: Item price', rPrice.allowed && rPrice.decision === 'auto_reply' && rPrice.reply.includes('₹65'));
}

// ── RULE 1: AUTO-REPLY DISALLOWED (QUEUED FOR OWNER WITH SEND / EDIT / IGNORE)
{
  const mockWorkspace = {
    timings: '10am - 8pm',
    address: 'Station Road',
    faqs: {},
  };

  // 1. Complaint: NOT auto-sent, queued with Send / Edit / Ignore
  const rComplaint = evaluateAutoReply({
    text: 'The milk packet I bought today was spoiled and smelled awful! Very bad quality.',
    workspaceInfo: mockWorkspace,
  });
  check('complaints NOT auto-sent: queued for owner', !rComplaint.allowed && rComplaint.decision === 'queue_for_owner');
  check('complaint has one-tap Send / Edit / Ignore actions', JSON.stringify(rComplaint.actions) === JSON.stringify(['Send', 'Edit', 'Ignore']));
  check('complaint reason identifies review requirement', rComplaint.reason === 'complaints_must_be_reviewed');

  // 2. Negotiation: NOT auto-sent, queued
  const rNegotiate = evaluateAutoReply({
    text: 'Can you give 20% discount if I buy 5 packets? Please reduce price.',
    workspaceInfo: mockWorkspace,
  });
  check('negotiations NOT auto-sent: queued for owner', !rNegotiate.allowed && rNegotiate.decision === 'queue_for_owner');
  check('negotiation has one-tap Send / Edit / Ignore', rNegotiate.actions.includes('Send') && rNegotiate.actions.includes('Edit') && rNegotiate.actions.includes('Ignore'));

  // 3. Refund request: NOT auto-sent, queued
  const rRefund = evaluateAutoReply({
    text: 'I want a refund for my order #104. Return my money please.',
    workspaceInfo: mockWorkspace,
  });
  check('refund request NOT auto-sent: queued for owner', !rRefund.allowed && rRefund.decision === 'queue_for_owner');
  check('refund reason recorded', rRefund.reason === 'refund_must_be_reviewed');

  // 4. Legal / medical / financial advice: NOT auto-sent, queued
  const rLegal = evaluateAutoReply({
    text: 'Can you give me legal advice regarding my GST court notice?',
    workspaceInfo: mockWorkspace,
  });
  check('legal advice NOT auto-sent: queued for owner', !rLegal.allowed && rLegal.reason === 'legal_advice_prohibited');

  const rMedical = evaluateAutoReply({
    text: 'Which medicine or prescription should I take for high fever?',
    workspaceInfo: mockWorkspace,
  });
  check('medical advice NOT auto-sent: queued for owner', !rMedical.allowed && rMedical.reason === 'medical_advice_prohibited');

  const rFinancial = evaluateAutoReply({
    text: 'Can you give me investment advice or tax evasion tips?',
    workspaceInfo: mockWorkspace,
  });
  check('financial advice NOT auto-sent: queued for owner', !rFinancial.allowed && rFinancial.reason === 'financial_advice_prohibited');

  // 5. Unclear message: NOT auto-sent, queued
  const rUnclear = evaluateAutoReply({
    text: 'asdfghjk hello blue tree banana?',
    workspaceInfo: mockWorkspace,
  });
  check('unclear message NOT auto-sent: queued for owner', !rUnclear.allowed && rUnclear.decision === 'queue_for_owner' && rUnclear.reason === 'unclear_message_queued');

  // 6. Item availability inquiry for item NOT stored in QuietKeep: queued for owner
  const rUnstoredItem = evaluateAutoReply({
    text: 'Do you have Basmati Supreme Gold 5kg?',
    storedItem: null, // NOT in QuietKeep
    workspaceInfo: mockWorkspace,
  });
  check('unstored inventory item NOT auto-sent: queued for owner', !rUnstoredItem.allowed && rUnstoredItem.reason === 'item_not_in_inventory');

  // 7. Timings asked but not configured: queued for owner
  const rNoTimings = evaluateAutoReply({
    text: 'What are your shop timings?',
    workspaceInfo: { address: 'Main road' }, // timings missing
  });
  check('unconfigured timings queued for owner', !rNoTimings.allowed && rNoTimings.reason === 'timings_not_configured');

  // 8. Location asked but not configured: queued for owner
  const rNoLocation = evaluateAutoReply({
    text: 'Where is your shop address?',
    workspaceInfo: { timings: '9am - 9pm' }, // address missing
  });
  check('unconfigured location queued for owner', !rNoLocation.allowed && rNoLocation.reason === 'location_not_configured');
}

// ── RULE 2: ORDERS AND BOOKINGS NEVER CONFIRMED AUTOMATICALLY ────────────────
{
  // 1. Order without owner confirmation -> NEVER told confirmed
  const rOrderAuto = evaluateOrderBooking({
    type: 'order',
    isOwnerConfirmed: false,
    customerName: 'Kavitha',
    details: { items: ['2 kg rice', '1 packet sugar'] },
  });
  check('order is never confirmed automatically', !rOrderAuto.allowed && rOrderAuto.status === 'pending_owner_confirmation');
  check('order reason marks owner confirmation required', rOrderAuto.reason === 'order_booking_never_auto_confirmed');
  check('order customer notice is not "confirmed"', !rOrderAuto.customerNotice.toLowerCase().includes('has been confirmed'));

  // 2. Booking without owner confirmation -> NEVER told confirmed
  const rBookingAuto = evaluateOrderBooking({
    type: 'booking',
    isOwnerConfirmed: false,
    customerName: 'Suresh',
    details: { service: 'Haircut', time: '4:00 PM' },
  });
  check('booking is never confirmed automatically', !rBookingAuto.allowed && rBookingAuto.status === 'pending_owner_confirmation');

  // 3. Order WITH owner one-tap confirmation -> Confirmed
  const rOrderConfirmed = evaluateOrderBooking({
    type: 'order',
    isOwnerConfirmed: true,
    customerName: 'Kavitha',
  });
  check('order confirmed after owner one-tap', rOrderConfirmed.allowed && rOrderConfirmed.status === 'confirmed');

  // 4. Booking WITH owner one-tap confirmation -> Confirmed
  const rBookingConfirmed = evaluateOrderBooking({
    type: 'booking',
    isOwnerConfirmed: true,
    customerName: 'Suresh',
  });
  check('booking confirmed after owner one-tap', rBookingConfirmed.allowed && rBookingConfirmed.status === 'confirmed');
}

// ── RULE 3: NEVER BY AUTOMATION (HARD BLOCKS) ────────────────────────────────
{
  // 1. Payments: hard block
  const rPay = evaluateAutomationAction({ action: 'payment' });
  check('payment by automation is hard blocked', !rPay.allowed && rPay.decision === 'hard_block');
  check('payment has clear owner message', rPay.ownerMessage.includes('Payments cannot be initiated by automation'));

  // 2. Refunds: hard block
  const rRef = evaluateAutomationAction({ action: 'refund' });
  check('refund by automation is hard blocked', !rRef.allowed && rRef.decision === 'hard_block');
  check('refund has clear owner message', rRef.ownerMessage.includes('Refunds cannot be issued automatically'));

  // 3. Payouts: hard block
  const rPayout = evaluateAutomationAction({ action: 'payout' });
  check('payout by automation is hard blocked', !rPayout.allowed && rPayout.decision === 'hard_block');
  check('payout has clear owner message', rPayout.ownerMessage.includes('Salary and staff payouts cannot be made by automation'));

  // 4. Legal advice: hard block
  const rLegal = evaluateAutomationAction({ action: 'legal_advice' });
  check('legal advice by automation is hard blocked', !rLegal.allowed && rLegal.decision === 'hard_block');
  check('legal advice has clear owner message', rLegal.ownerMessage.includes('Legal advice cannot be provided'));

  // 5. Discounts above owner set limit: hard block
  const rDiscAbove = evaluateAutomationAction({
    action: 'discount',
    discountPercent: 15,
    ownerMaxDiscount: 10,
  });
  check('discount above owner limit (15% > 10%) is hard blocked', !rDiscAbove.allowed && rDiscAbove.decision === 'hard_block');
  check('discount block explains owner limit', rDiscAbove.ownerMessage.includes('exceeds the owner limit of 10%'));

  // 6. Discount within owner set limit: allowed
  const rDiscOk = evaluateAutomationAction({
    action: 'discount',
    discountPercent: 8,
    ownerMaxDiscount: 10,
  });
  check('discount within owner limit (8% <= 10%) is allowed', rDiscOk.allowed && rDiscOk.decision === 'allowed');
}

// ── RULE 4: PROMOTION LIMITS ─────────────────────────────────────────────────
{
  const NEW_BIZ_CREATED = '2026-10-10T00:00:00.000Z'; // ~14 days old on 24 Oct
  const OLD_BIZ_CREATED = '2026-08-01T00:00:00.000Z'; // ~84 days old (> 30 days)

  // ── A. TIME-WINDOW EDGES (09:59 / 10:00 / 21:00 / 21:01 IST) ───────────────
  const t0959 = makeIstDate(2026, 10, 24, 9, 59, 0);
  const t1000 = makeIstDate(2026, 10, 24, 10, 0, 0);
  const t2100 = makeIstDate(2026, 10, 24, 21, 0, 0);
  const t2101 = makeIstDate(2026, 10, 24, 21, 1, 0);

  check('time window helper: 09:59 IST is false', !isWithinPromoHours(t0959));
  check('time window helper: 10:00 IST is true', isWithinPromoHours(t1000));
  check('time window helper: 21:00 IST is true', isWithinPromoHours(t2100));
  check('time window helper: 21:01 IST is false', !isWithinPromoHours(t2101));

  const promo0959 = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    now: t0959,
  });
  check('promotion at 09:59 IST is BLOCKED', !promo0959.allowed && promo0959.reason === 'outside_promo_hours');

  const promo1000 = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    now: t1000,
  });
  check('promotion at 10:00 IST is ALLOWED', promo1000.allowed && promo1000.decision === 'send_promotional');

  const promo2100 = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    now: t2100,
  });
  check('promotion at 21:00 IST is ALLOWED', promo2100.allowed && promo2100.decision === 'send_promotional');

  const promo2101 = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    now: t2101,
  });
  check('promotion at 21:01 IST is BLOCKED', !promo2101.allowed && promo2101.reason === 'outside_promo_hours');

  // ── B. BUSINESS DAILY LIMIT (250/day in first 30 days, default 1000/day after)
  const validTime = t1000;

  // New business (< 30 days old): 249 sent -> allowed, 250 sent -> blocked
  const newBiz249 = evaluatePromotionSend({
    businessCreatedAt: NEW_BIZ_CREATED,
    businessSentToday: 249,
    now: validTime,
  });
  check('new business with 249 sent is ALLOWED', newBiz249.allowed && newBiz249.limit === 250);

  const newBiz250 = evaluatePromotionSend({
    businessCreatedAt: NEW_BIZ_CREATED,
    businessSentToday: 250,
    now: validTime,
  });
  check('new business with 250 sent is BLOCKED (250/day cap)', !newBiz250.allowed && newBiz250.reason === 'new_business_daily_limit_reached');

  // Established business (> 30 days old): 250 sent -> allowed, 999 sent -> allowed, 1000 sent -> blocked
  const oldBiz250 = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    businessSentToday: 250,
    now: validTime,
  });
  check('established business with 250 sent is ALLOWED (past 30-day cap)', oldBiz250.allowed && oldBiz250.limit === 1000);

  const oldBiz999 = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    businessSentToday: 999,
    now: validTime,
  });
  check('established business with 999 sent is ALLOWED', oldBiz999.allowed);

  const oldBiz1000 = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    businessSentToday: 1000,
    now: validTime,
  });
  check('established business with 1000 sent is BLOCKED (default 1000/day cap)', !oldBiz1000.allowed && oldBiz1000.reason === 'business_daily_limit_reached');

  // Established business with custom owner cap (e.g. 500)
  const oldBizCustom500 = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    ownerDailyLimit: 500,
    businessSentToday: 500,
    now: validTime,
  });
  check('established business respects custom owner cap (500)', !oldBizCustom500.allowed && oldBizCustom500.limit === 500);

  // ── C. PER-CUSTOMER DAILY CAP (max 1/day) ────────────────────────────────────
  const cust0Today = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    customerSentToday: 0,
    now: validTime,
  });
  check('customer with 0 sent today is ALLOWED', cust0Today.allowed);

  const cust1Today = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    customerSentToday: 1,
    now: validTime,
  });
  check('customer with 1 sent today is BLOCKED (max 1 per day)', !cust1Today.allowed && cust1Today.reason === 'customer_daily_limit_reached');

  // ── D. PER-CUSTOMER WEEKLY CAP (max 4/week) ──────────────────────────────────
  const cust3Week = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    customerSentToday: 0,
    customerSentThisWeek: 3,
    now: validTime,
  });
  check('customer with 3 sent this week is ALLOWED', cust3Week.allowed);

  const cust4Week = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    customerSentToday: 0,
    customerSentThisWeek: 4,
    now: validTime,
  });
  check('customer with 4 sent this week is BLOCKED (max 4 per week)', !cust4Week.allowed && cust4Week.reason === 'customer_weekly_limit_reached');

  // ── E. OPT-OUT IN ENGLISH, TELUGU, HINDI ─────────────────────────────────────
  // English
  for (const w of ['STOP', 'stop', 'unsubscribe', 'UNSUBSCRIBE', 'QUIT', 'opt-out']) {
    check(`opt-out detector (en): "${w}"`, isOptOutMessage(w));
  }
  // Telugu
  for (const w of ['వద్దు', 'ఆపండి', 'వద్దండి', 'వద్దు ఇక']) {
    check(`opt-out detector (te): "${w}"`, isOptOutMessage(w));
  }
  // Hindi
  for (const w of ['बंद करो', 'बंद करें', 'रोकें', 'रोको', 'मत भेजो']) {
    check(`opt-out detector (hi): "${w}"`, isOptOutMessage(w));
  }

  // Non opt-outs
  check('non opt-out: "please send catalog"', !isOptOutMessage('please send catalog'));
  check('non opt-out: "rice price"', !isOptOutMessage('rice price'));

  // Opted out customer is NEVER messaged again
  const optedOutPromo = evaluatePromotionSend({
    businessCreatedAt: OLD_BIZ_CREATED,
    isCustomerOptedOut: true,
    now: validTime,
  });
  check('opted-out customer is NEVER messaged again (BLOCKED)', !optedOutPromo.allowed && optedOutPromo.reason === 'customer_opted_out');

  // ── F. TRANSACTIONAL REPLIES ARE NOT PROMOTIONS ─────────────────────────────
  // Allowed outside promo hours (e.g. at 09:59 or 23:00)
  const txnAtNight = evaluatePromotionSend({
    businessCreatedAt: NEW_BIZ_CREATED,
    businessSentToday: 300,       // above promo cap
    customerSentToday: 5,         // above promo cap
    isTransactional: true,        // order update customer asked for
    now: t0959,                   // outside promo hours
  });
  check('transactional reply is exempt from promo hours and caps', txnAtNight.allowed && txnAtNight.decision === 'send_transactional' && !txnAtNight.isPromotion);
}

// ── RULE 5: LOGGING FOR OWNER WITHOUT STORING LONG MESSAGE BODIES ─────────────
{
  const longBody = 'Hello, I wanted to ask about this item and also complaining about the other thing that happened last Friday when I visited your store and the staff was very rude and gave me defective products. Please look into this right away or I will complain to the consumer forum.';
  const snippet = sanitizeSnippet(longBody, 80);
  check('message snippet is bounded in length (<= 80 chars)', snippet.length <= 80 && snippet.endsWith('...'));

  const logRecord = buildOwnerAuditLog({
    workspaceId: 'ws-123',
    who: '+919876543210',
    what: 'auto_reply_queued',
    why: 'complaints_must_be_reviewed',
    rawMessage: longBody,
    metadata: { topic: 'complaint' },
  });

  check('owner log contains who', logRecord.metadata.who === '+919876543210');
  check('owner log contains what', logRecord.action === 'auto_reply_queued');
  check('owner log contains why', logRecord.metadata.why === 'complaints_must_be_reviewed');
  check('owner log snippet is bounded and does NOT contain entire long body', logRecord.metadata.snippet === snippet && logRecord.metadata.snippet.length < longBody.length);
}

// ── ACTION-LEVELS INTEGRATION ────────────────────────────────────────────────
{
  check('action-levels: business_order_confirm is PIN (never voice-only)', levelFor({ type: 'business_order_confirm' }) === LEVEL.PIN);
  check('action-levels: business_booking_confirm is PIN', levelFor({ type: 'business_booking_confirm' }) === LEVEL.PIN);
  check('action-levels: business_refund is NEVER', levelFor({ type: 'business_refund' }) === LEVEL.NEVER);
  check('action-levels: business_payment is NEVER', levelFor({ type: 'business_payment' }) === LEVEL.NEVER);
  check('action-levels: business_payout is NEVER', levelFor({ type: 'business_payout' }) === LEVEL.NEVER);
  check('action-levels: business_legal_advice is NEVER', levelFor({ type: 'business_legal_advice' }) === LEVEL.NEVER);

  check('action-levels: business_order_confirm cannot act unasked', !mayActUnasked('business_order_confirm'));
  check('action-levels: business_refund cannot act unasked', !mayActUnasked('business_refund'));
  check('action-levels: business_payment cannot act unasked', !mayActUnasked('business_payment'));

  const decOrder = decide({ type: 'business_order_confirm' }, { spokenYes: true, unlocked: true, pin: false }, { doneThisHour: 0 });
  check('order confirmation requires owner PIN/approval, never spoken yes alone', decOrder.decision === DECISION.ASK_PIN);

  const decRefund = decide({ type: 'business_refund' }, { spokenYes: true, unlocked: true, pin: true }, { doneThisHour: 0 });
  check('automated refund is refused (NEVER)', decRefund.decision === DECISION.REFUSE);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);