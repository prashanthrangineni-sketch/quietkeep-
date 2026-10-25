// tests/business-limits.test.mjs
// Unit tests for QuietKeep Business limits module (CARD AG-AARIA-25, Founder Decision 4).

import {
  isCustomerOptedOutInDb,
  isWithinPromoHours,
  isOptOutMessage,
  cleanTextForOptOut,
  normalizePhoneNumber,
  maskPhoneNumber,
  classifyInboundTopic,
  sanitizeSnippet,
  evaluateAutoReply,
  evaluateOrderBooking,
  evaluateAutomationAction,
  evaluatePromotionSend,
  buildOwnerAuditLog,
  ALLOWED_AUTOREPLY_TOPICS,
  DISALLOWED_AUTOREPLY_TOPICS,
  HARD_BLOCKED_AUTOMATIONS,
} from '../src/lib/business-limits.js';

import {
  levelFor,
  mayActUnasked,
  decide,
  LEVEL,
  DECISION,
} from '../src/lib/action-levels.js';

let pass = 0;
let fail = 0;

function check(name, ok, extra = '') {
  if (ok) {
    console.log(`PASS  ${name}`);
    pass++;
  } else {
    console.error(`FAIL  ${name} ${extra}`);
    fail++;
  }
}

// ── PHONE NORMALISATION & MASKING (Item D & J) ──────────────────────────────
{
  check('normalize 10-digit Indian: "9876543210"', normalizePhoneNumber('9876543210') === '+919876543210');
  check('normalize 11-digit leading 0: "09876543210"', normalizePhoneNumber('09876543210') === '+919876543210');
  check('normalize 12-digit leading 91: "919876543210"', normalizePhoneNumber('919876543210') === '+919876543210');
  check('normalize spaces & dashes: "+91 98765-43210"', normalizePhoneNumber('+91 98765-43210') === '+919876543210');
  check('normalize parens: "(098) 765-43210"', normalizePhoneNumber('(098) 765-43210') === '+919876543210');
  check('normalize whatsapp: prefix', normalizePhoneNumber('whatsapp:+919876543210') === '+919876543210');
  check('normalize international: "+14155238886"', normalizePhoneNumber('+14155238886') === '+14155238886');

  const masked = maskPhoneNumber('9876543210');
  check('mask customer phone (last 4 digits only)', masked.endsWith('3210') && masked.startsWith('****') && !masked.includes('9876'));
  const maskedIntl = maskPhoneNumber('+14155238886');
  check('mask international phone (last 4 digits only)', maskedIntl.endsWith('8886') && !maskedIntl.includes('415'));
}

// ── RULE 1: AUTO-REPLIES ALLOWED ONLY FOR TIMINGS, LOCATION, PRICE, STOCK, FAQ
{
  const allowedTopics = ['faq', 'timings', 'location', 'item_availability', 'item_price'];
  for (const t of allowedTopics) {
    check(`allowed topic is registered: ${t}`, ALLOWED_AUTOREPLY_TOPICS.has(t));
  }

  // 1. FAQ
  const faqRes = evaluateAutoReply({
    topic: 'faq',
    text: 'do you accept UPI?',
    workspaceInfo: { faqReply: 'Yes, we accept Google Pay, PhonePe, and Paytm.' },
  });
  check('auto-reply allowed: FAQ', faqRes.allowed && faqRes.decision === 'auto_reply_allowed');

  // 2. Shop timings
  const timingsRes = evaluateAutoReply({
    topic: 'timings',
    text: 'when do you open today?',
    workspaceInfo: { timings: 'Monday to Saturday, 9:00 AM - 9:00 PM' },
  });
  check('auto-reply allowed: Shop timings', timingsRes.allowed && timingsRes.decision === 'auto_reply_allowed');

  // 3. Location
  const locationRes = evaluateAutoReply({
    topic: 'location',
    text: 'where is your store located?',
    workspaceInfo: { address: 'Shop 4, Main Bazar, Guntur, Andhra Pradesh' },
  });
  check('auto-reply allowed: Location', locationRes.allowed && locationRes.decision === 'auto_reply_allowed');

  // 4. Item availability (stored in QuietKeep)
  const availRes = evaluateAutoReply({
    topic: 'item_availability',
    text: 'is Sona Masoori rice in stock?',
    inventoryMatch: { found: true, name: 'Sona Masoori Rice 25kg', inStock: true, price: 1450 },
  });
  check('auto-reply allowed: Item availability (in stock)', availRes.allowed && availRes.suggestedReply.includes('in stock'));

  // 5. Item price (stored in QuietKeep)
  const priceRes = evaluateAutoReply({
    topic: 'item_price',
    text: 'how much is Sunflower Oil 1L?',
    inventoryMatch: { found: true, name: 'Freedom Sunflower Oil 1L', inStock: true, price: 135 },
  });
  check('auto-reply allowed: Item price', priceRes.allowed && priceRes.suggestedReply.includes('₹135'));

  // ── DISALLOWED / QUEUED CASES (One-tap Send / Edit / Ignore) ───────────────
  const queuedTopics = [
    { topic: 'complaint', text: 'the rice bag I bought yesterday has weevils in it! worst store!' },
    { topic: 'negotiation', text: 'if I buy 5 bags can you give at 1200 instead of 1450?' },
    { topic: 'refund', text: 'cancel my order and return my money immediately' },
    { topic: 'legal_advice', text: 'my tenant is not paying rent, can I lock them out?' },
    { topic: 'medical_advice', text: 'what medicine should I take for high fever?' },
    { topic: 'financial_advice', text: 'should I invest in this stock or crypto?' },
    { topic: 'unclear', text: 'hello there abc xyz 123' },
  ];

  for (const q of queuedTopics) {
    const res = evaluateAutoReply({ topic: q.topic, text: q.text });
    check(`${q.topic} NOT auto-sent: queued for owner`, !res.allowed && res.queuedForOwner && res.decision === 'queue_for_owner');
    check(`${q.topic} has one-tap Send / Edit / Ignore`, Array.isArray(res.actions) && res.actions.includes('Send') && res.actions.includes('Edit') && res.actions.includes('Ignore'));
  }

  // Unstored inventory item inquiry must be queued for owner
  const unstoredRes = evaluateAutoReply({
    topic: 'item_availability',
    text: 'do you have organic jaggery powder?',
    inventoryMatch: { found: false },
  });
  check('unstored inventory item NOT auto-sent: queued for owner', !unstoredRes.allowed && unstoredRes.queuedForOwner && unstoredRes.actions.includes('Send'));

  // Unconfigured timings/location must be queued for owner
  const noTimingsRes = evaluateAutoReply({ topic: 'timings', text: 'shop timings', workspaceInfo: {} });
  check('unconfigured timings queued for owner', !noTimingsRes.allowed && noTimingsRes.queuedForOwner);

  const noLocationRes = evaluateAutoReply({ topic: 'location', text: 'shop address', workspaceInfo: {} });
  check('unconfigured location queued for owner', !noLocationRes.allowed && noLocationRes.queuedForOwner);
}

// ── RULE 2: ORDERS & BOOKINGS NEVER CONFIRMED AUTOMATICALLY ─────────────────
{
  const orderUnconfirmed = evaluateOrderBooking({
    type: 'order',
    isOwnerConfirmed: false,
    customerName: 'Ravi',
    details: { item: 'Rice 25kg', qty: 2 },
  });
  check('order is never confirmed automatically', !orderUnconfirmed.allowed && !orderUnconfirmed.isConfirmed);
  check('order reason marks owner confirmation required', orderUnconfirmed.reason.includes('never confirmed automatically'));
  check('order customer notice is not "confirmed"', !orderUnconfirmed.customerNotice.includes('Your order is confirmed'));

  const bookingUnconfirmed = evaluateOrderBooking({
    type: 'booking',
    isOwnerConfirmed: false,
    customerName: 'Suresh',
    details: { service: 'AC Repair', slot: '4 PM' },
  });
  check('booking is never confirmed automatically', !bookingUnconfirmed.allowed && !bookingUnconfirmed.isConfirmed);

  const orderConfirmed = evaluateOrderBooking({
    type: 'order',
    isOwnerConfirmed: true,
    customerName: 'Ravi',
    details: { item: 'Rice 25kg', qty: 2 },
  });
  check('order confirmed after owner one-tap', orderConfirmed.allowed && orderConfirmed.isConfirmed && orderConfirmed.customerNotice.includes('confirmed'));

  const bookingConfirmed = evaluateOrderBooking({
    type: 'booking',
    isOwnerConfirmed: true,
    customerName: 'Suresh',
    details: { service: 'AC Repair', slot: '4 PM' },
  });
  check('booking confirmed after owner one-tap', bookingConfirmed.allowed && bookingConfirmed.isConfirmed);
}

// ── RULE 3: NEVER BY AUTOMATION (HARD BLOCKED) ──────────────────────────────
{
  const blockedActions = ['payment', 'refund', 'payout', 'legal_advice'];
  for (const act of blockedActions) {
    const res = evaluateAutomationAction({ action: act });
    check(`${act} by automation is hard blocked`, !res.allowed && res.decision === 'hard_block');
    check(`${act} has clear owner message`, typeof res.ownerMessage === 'string' && res.ownerMessage.length > 20);
  }

  // Discount above owner limit
  const excessDiscount = evaluateAutomationAction({
    action: 'discount',
    discountPercent: 15,
    maxAllowedDiscount: 10,
  });
  check('discount above owner limit (15% > 10%) is hard blocked', !excessDiscount.allowed && excessDiscount.reason === 'discount_exceeds_owner_limit');
  check('discount block explains owner limit', excessDiscount.ownerMessage.includes('15% exceeds the owner-configured limit of 10%'));

  // Discount within owner limit
  const validDiscount = evaluateAutomationAction({
    action: 'discount',
    discountPercent: 8,
    maxAllowedDiscount: 10,
  });
  check('discount within owner limit (8% <= 10%) is allowed', validDiscount.allowed && validDiscount.decision === 'discount_allowed');
}

// ── RULE 4: PROMOTION LIMITS & TIME WINDOWS ──────────────────────────────────
{
  const makeIstDate = (year, month, day, hour, minute) => {
    const utcHour = (hour - 5) - (minute < 30 ? 1 : 0);
    const utcMin = (minute + 30) % 60;
    return new Date(Date.UTC(year, month - 1, day, utcHour, utcMin, 0));
  };

  const t0959 = makeIstDate(2026, 10, 24, 9, 59);
  const t1000 = makeIstDate(2026, 10, 24, 10, 0);
  const t2100 = makeIstDate(2026, 10, 24, 21, 0);
  const t2101 = makeIstDate(2026, 10, 24, 21, 1);

  check('time window helper: 09:59 IST is false', isWithinPromoHours(t0959) === false);
  check('time window helper: 10:00 IST is true', isWithinPromoHours(t1000) === true);
  check('time window helper: 21:00 IST is true', isWithinPromoHours(t2100) === true);
  check('time window helper: 21:01 IST is false', isWithinPromoHours(t2101) === false);

  const validTime = t1000;

  // Time window edges on evaluatePromotionSend
  const at0959 = evaluatePromotionSend({ businessCreatedAt: new Date(Date.now() - 40 * 86400000), now: t0959 });
  check('promotion at 09:59 IST is BLOCKED', !at0959.allowed && at0959.reason === 'outside_promo_hours');

  const at1000 = evaluatePromotionSend({ businessCreatedAt: new Date(Date.now() - 40 * 86400000), now: t1000 });
  check('promotion at 10:00 IST is ALLOWED', at1000.allowed && at1000.decision === 'send_promotional');

  const at2100 = evaluatePromotionSend({ businessCreatedAt: new Date(Date.now() - 40 * 86400000), now: t2100 });
  check('promotion at 21:00 IST is ALLOWED', at2100.allowed && at2100.decision === 'send_promotional');

  const at2101 = evaluatePromotionSend({ businessCreatedAt: new Date(Date.now() - 40 * 86400000), now: t2101 });
  check('promotion at 21:01 IST is BLOCKED', !at2101.allowed && at2101.reason === 'outside_promo_hours');

  // ── 30-DAY BUSINESS CAP: strict < 30 days (Item J) ─────────────────────────
  // Business created 29 days ago -> age 29 < 30 -> new business (250 cap)
  const DAY29_BIZ = new Date(validTime.getTime() - 29 * 24 * 3600 * 1000);
  // Business created 30 days ago -> age 30, not < 30 -> established business (1000 cap)
  const DAY30_BIZ = new Date(validTime.getTime() - 30 * 24 * 3600 * 1000);

  const newBizAllowed = evaluatePromotionSend({ businessCreatedAt: DAY29_BIZ, businessSentToday: 249, now: validTime });
  check('new business (day 29) with 249 sent is ALLOWED', newBizAllowed.allowed);

  const newBizBlocked = evaluatePromotionSend({ businessCreatedAt: DAY29_BIZ, businessSentToday: 250, now: validTime });
  check('new business (day 29) with 250 sent is BLOCKED (< 30 days 250 cap)', !newBizBlocked.allowed && newBizBlocked.reason === 'new_business_daily_limit_reached');

  const day30BizAllowed = evaluatePromotionSend({ businessCreatedAt: DAY30_BIZ, businessSentToday: 250, now: validTime });
  check('business at day 30 with 250 sent is ALLOWED (past 30-day cap, uses 1000 cap)', day30BizAllowed.allowed);

  const day30Biz1000Blocked = evaluatePromotionSend({ businessCreatedAt: DAY30_BIZ, businessSentToday: 1000, now: validTime });
  check('established business with 1000 sent is BLOCKED (default 1000/day cap)', !day30Biz1000Blocked.allowed && day30Biz1000Blocked.reason === 'business_daily_limit_reached');

  const customOwnerCap = evaluatePromotionSend({ businessCreatedAt: DAY30_BIZ, ownerDailyLimit: 500, businessSentToday: 500, now: validTime });
  check('established business respects custom owner cap (500)', !customOwnerCap.allowed && customOwnerCap.limit === 500);

  // ── PER-CUSTOMER CAPS: at most 1/day and 4/week ────────────────────────────
  const cust0Today = evaluatePromotionSend({ businessCreatedAt: DAY30_BIZ, customerSentToday: 0, now: validTime });
  check('customer with 0 sent today is ALLOWED', cust0Today.allowed);

  const cust1Today = evaluatePromotionSend({ businessCreatedAt: DAY30_BIZ, customerSentToday: 1, now: validTime });
  check('customer with 1 sent today is BLOCKED (max 1 per day)', !cust1Today.allowed && cust1Today.reason === 'customer_daily_limit_reached');

  const cust3Week = evaluatePromotionSend({ businessCreatedAt: DAY30_BIZ, customerSentToday: 0, customerSentThisWeek: 3, now: validTime });
  check('customer with 3 sent this week is ALLOWED', cust3Week.allowed);

  const cust4Week = evaluatePromotionSend({ businessCreatedAt: DAY30_BIZ, customerSentToday: 0, customerSentThisWeek: 4, now: validTime });
  check('customer with 4 sent this week is BLOCKED (max 4 per week)', !cust4Week.allowed && cust4Week.reason === 'customer_weekly_limit_reached');

  // ── OPT-OUT EXACT MATCHING (Item E) ─────────────────────────────────────────
  const validOptOuts = [
    'STOP', 'stop', 'STOP ALL', 'stop all', 'Stop All!',
    'UNSUBSCRIBE', 'unsubscribe', 'unsubscribe.',
    'OPT OUT', 'opt out', 'OPTOUT',
    'వద్దు', 'మెసేజ్ వద్దు',
    'बंद करो', 'मैसेज बंद करो', 'बंद',
  ];
  for (const phrase of validOptOuts) {
    check(`opt-out detector (valid): "${phrase}"`, isOptOutMessage(phrase));
  }

  // Non-opt-outs that must NOT match (Item E)
  const invalidOptOuts = [
    'ఉల్లిపాయ వద్దు',
    'bus stop where?',
    'cancel my order',
    'cancel',
    'end',
    'please send catalog',
    'rice price',
    'do you have oil in stock',
  ];
  for (const phrase of invalidOptOuts) {
    check(`opt-out detector (must NOT match): "${phrase}"`, !isOptOutMessage(phrase));
  }

  // ── OPTED-OUT CUSTOMER & TRANSACTIONAL REPLIES (Item F) ─────────────────────
  // 1. Opted out customer receiving marketing/promo -> BLOCKED
  const promoToOptedOut = evaluatePromotionSend({
    businessCreatedAt: DAY30_BIZ,
    isCustomerOptedOut: true,
    isTransactional: false,
    now: validTime,
  });
  check('opted-out customer receiving promo is BLOCKED', !promoToOptedOut.allowed && promoToOptedOut.reason === 'customer_opted_out');

  // 2. Opted out customer receiving unproven "transactional" send -> BLOCKED
  const unprovenTxnToOptedOut = evaluatePromotionSend({
    businessCreatedAt: DAY30_BIZ,
    isCustomerOptedOut: true,
    isTransactional: true,
    isCustomerInitiatedReply: false,
    isOrderUpdate: false,
    now: validTime,
  });
  check('opted-out customer receiving unproven transactional send is BLOCKED', !unprovenTxnToOptedOut.allowed && unprovenTxnToOptedOut.reason === 'customer_opted_out');

  // 3. Opted out customer receiving reply to their own new question -> ALLOWED
  const queryReplyToOptedOut = evaluatePromotionSend({
    businessCreatedAt: DAY30_BIZ,
    isCustomerOptedOut: true,
    isTransactional: true,
    isCustomerInitiatedReply: true,
    now: validTime,
  });
  check('opted-out customer receiving reply to their question is ALLOWED', queryReplyToOptedOut.allowed && queryReplyToOptedOut.decision === 'send_transactional');

  // 4. Opted out customer receiving update to their own order -> ALLOWED
  const orderUpdateToOptedOut = evaluatePromotionSend({
    businessCreatedAt: DAY30_BIZ,
    isCustomerOptedOut: true,
    isTransactional: true,
    isOrderUpdate: true,
    now: validTime,
  });
  check('opted-out customer receiving order update is ALLOWED', orderUpdateToOptedOut.allowed && orderUpdateToOptedOut.decision === 'send_transactional');

  // Non-opted out customer receiving transactional reply outside promo hours (e.g. 09:59)
  const txnAt0959 = evaluatePromotionSend({
    businessCreatedAt: DAY29_BIZ,
    businessSentToday: 300,
    customerSentToday: 5,
    isTransactional: true,
    now: t0959,
  });
  check('transactional reply is exempt from promo hours and caps', txnAt0959.allowed && txnAt0959.decision === 'send_transactional');
}

// ── RULE 5: LOGGING FOR OWNER WITH PHONE MASKING (Item J) ────────────────────
{
  const longBody = 'Hello, I wanted to ask about this item and also complaining about the other thing that happened last Friday when I visited your store and the staff was very rude and gave me defective products. Please look into this right away.';
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

  check('owner log masks customer phone (last 4 digits only)', logRecord.metadata.who.endsWith('3210') && !logRecord.metadata.who.includes('9876'));
  check('owner log contains what', logRecord.action === 'business_limit_auto_reply_queued');
  check('owner log contains why', logRecord.metadata.why === 'complaints_must_be_reviewed');
  check('owner log snippet is bounded and does NOT contain entire long body', logRecord.metadata.snippet === snippet && logRecord.metadata.snippet.length < longBody.length);
}

// ── isCustomerOptedOutInDb UNIT TESTS (Round 4 Item 1) ───────────────────────
{
  // 1. Missing arguments -> returns error
  const resMissing = await isCustomerOptedOutInDb(null, 'ws1', '+919876543210');
  check('isCustomerOptedOutInDb missing supabase returns error', !resMissing.optedOut && !!resMissing.error);

  // 2. Normal opt-out detection
  const mockSupa1 = {
    from: (tbl) => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: () => Promise.resolve({ data: [{ id: 'opt1' }], error: null }),
          }),
        }),
      }),
    }),
  };
  const res1 = await isCustomerOptedOutInDb(mockSupa1, 'ws1', '9876543210');
  check('isCustomerOptedOutInDb detects single opt-out row', res1.optedOut === true && res1.error === null);

  // 3. Two matching rows -> still detected without error (Round 4 Item 1)
  const mockSupa2 = {
    from: (tbl) => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: (n) => Promise.resolve({ data: [{ id: 'opt1' }, { id: 'opt2' }].slice(0, n), error: null }),
          }),
        }),
      }),
    }),
  };
  const res2 = await isCustomerOptedOutInDb(mockSupa2, 'ws1', '9876543210');
  check('isCustomerOptedOutInDb 2 matching rows -> still detected without error', res2.optedOut === true && res2.error === null);

  // 4. DB query error -> returns { optedOut: false, error }
  const mockSupaErr = {
    from: (tbl) => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: () => Promise.resolve({ data: null, error: { message: 'connection timeout', code: 'ETIMEDOUT' } }),
          }),
        }),
      }),
    }),
  };
  const resErr = await isCustomerOptedOutInDb(mockSupaErr, 'ws1', '9876543210');
  check('isCustomerOptedOutInDb DB error returns { optedOut: false, error }', resErr.optedOut === false && !!resErr.error);

  // 5. Opted in customer -> returns { optedOut: false, error: null }
  const mockSupaIn = {
    from: (tbl) => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }),
  };
  const resIn = await isCustomerOptedOutInDb(mockSupaIn, 'ws1', '9876543210');
  check('isCustomerOptedOutInDb customer not opted out returns { optedOut: false, error: null }', resIn.optedOut === false && resIn.error === null);
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