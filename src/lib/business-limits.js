// src/lib/business-limits.js
// QuietKeep Business: Auto-Reply, Order Handling, and Promotion Limits Enforced in Code
// Founder Decision 4 ("plan as per market") — CARD AG-AARIA-25.

// ── CONSTANTS & POLICIES ─────────────────────────────────────────────────────

export const TZ_INDIA = 'Asia/Kolkata';

export const PROMO_CONSTANTS = Object.freeze({
  NEW_BIZ_DAYS: 30,             // first 30 days of business (< 30)
  NEW_BIZ_DAILY_MAX: 250,       // at most 250 promo messages/day in first 30 days
  DEFAULT_DAILY_MAX: 1000,      // default 1000 promo messages/day after 30 days
  MAX_PER_CUSTOMER_DAILY: 1,    // at most 1 promo message per customer per day
  MAX_PER_CUSTOMER_WEEKLY: 4,   // at most 4 promo messages per customer per week
  START_HOUR_IST: 10,           // 10:00 IST
  END_HOUR_IST: 21,             // 21:00 IST
});

export const ALLOWED_AUTOREPLY_TOPICS = Object.freeze(new Set([
  'faq',
  'timings',
  'location',
  'item_availability',
  'item_price',
]));

export const DISALLOWED_AUTOREPLY_TOPICS = Object.freeze(new Set([
  'complaint',
  'negotiation',
  'refund',
  'legal_advice',
  'medical_advice',
  'financial_advice',
  'order_request',
  'booking_request',
  'unclear',
]));

export const HARD_BLOCKED_AUTOMATIONS = Object.freeze(new Set([
  'payment',
  'refund',
  'payout',
  'legal_advice',
  'excess_discount',
]));

// ── PHONE NORMALISATION & MASKING (E.164 +91...) ─────────────────────────────

/**
 * Normalise a phone number into strict E.164 format (+91... for Indian numbers).
 * Strips whitespace, dashes, parens, leading 0s, and handles 10-digit Indian numbers.
 */
export function normalizePhoneNumber(raw) {
  if (!raw) return '';
  let cleaned = String(raw).trim().replace(/[\s\-\(\)\.]+/g, '');
  if (!cleaned) return '';

  if (cleaned.startsWith('whatsapp:')) {
    cleaned = cleaned.slice('whatsapp:'.length);
  }

  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1).replace(/\D/g, '');
    if (!digits) return '';
    return '+' + digits;
  }

  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return '';

  // 10-digit Indian mobile (e.g. 9876543210)
  if (digits.length === 10) {
    return '+91' + digits;
  }

  // 11 digits starting with 0 (e.g. 09876543210)
  if (digits.length === 11 && digits.startsWith('0')) {
    return '+91' + digits.slice(1);
  }

  // 12 digits starting with 91 (e.g. 919876543210)
  if (digits.length === 12 && digits.startsWith('91')) {
    return '+' + digits;
  }

  return '+' + digits;
}

/**
 * Mask a phone number to show only the last 4 digits (e.g. ******3210).
 */
export function maskPhoneNumber(phone) {
  const norm = normalizePhoneNumber(phone);
  if (!norm || norm.length <= 4) return '****';
  const last4 = norm.slice(-4);
  const prefixLength = Math.max(4, norm.length - 4);
  return '*'.repeat(prefixLength) + last4;
}

// ── TIME WINDOW HELPERS (IST) ────────────────────────────────────────────────

export function getIstParts(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_INDIA,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(d);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
  };
}

export function isWithinPromoHours(date = new Date()) {
  const { hour, minute } = getIstParts(date);
  if (hour < PROMO_CONSTANTS.START_HOUR_IST) return false;
  if (hour > PROMO_CONSTANTS.END_HOUR_IST) return false;
  if (hour === PROMO_CONSTANTS.END_HOUR_IST && minute > 0) return false;
  return true;
}

// ── OPT-OUT DETECTION (EXACT WHOLE-MESSAGE MATCHING) ──────────────────────────

const EXACT_OPT_OUT_SET = Object.freeze(new Set([
  'stop',
  'stop all',
  'unsubscribe',
  'opt out',
  'optout',
  'వద్దు',
  'మెసేజ్ వద్దు',
  'बंद करो',
  'मैसेज बंद करो',
  'बंद',
]));

/**
 * Clean text for opt-out matching: trimmed, lowercased, punctuation removed, internal whitespace collapsed.
 */
export function cleanTextForOptOut(text) {
  if (!text) return '';
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '')
    .replace(/[\s\u2000-\u200B]+/g, ' ')
    .trim();
}

/**
 * Is this message an explicit opt-out command?
 * Matches ONLY when the whole message (trimmed, lowercase, punctuation removed)
 * matches STOP, STOP ALL, UNSUBSCRIBE, OPT OUT, వద్దు, మెసేజ్ వద్దు, बंद करो, मैसेज बंद करो, बंद.
 * Deliberately does NOT match "cancel", "end", "ఉల్లిపాయ వద్దు", "bus stop where?", "cancel my order".
 */
export function isOptOutMessage(text) {
  const clean = cleanTextForOptOut(text);
  if (!clean) return false;
  return EXACT_OPT_OUT_SET.has(clean);
}

// ── 1. CLASSIFY INBOUND CUSTOMER TOPIC ───────────────────────────────────────

const RE_TIMINGS = /\b(timings?|opening\s*hours?|closing\s*time|open\s*today|shop\s*hours?|hours\s*of\s*operation|when\s*do\s*you\s*(open|close)|are\s*you\s*open)\b|సమయం|ఎప్పుడు\s*(తెరుస్తారు|మూస్తారు)|दुकान\s*कब\s*(खुलती|बंद)|समय\s*क्या/i;
const RE_LOCATION = /\b(location|address|directions?|landmark|where\s*(is|are)\s*(your\s*)?(shop|store)|how\s*to\s*reach)\b|చిరునామా|ఎక్కడ\s*ఉంది|షాప్\s*ఎక్కడ|पता\s*क्या|कहाँ\s*है|दुकान\s*कहाँ/i;
const RE_AVAIL_PRICE = /\b(price|cost|rate|how\s*much\s*is|available|in\s*stock|do\s*you\s*have|stock\s*of)\b|ధర|ఎంత|ఉందా|స్టాక్|कितने\s*का|दाम|भाव|उपलब्ध/i;
const RE_COMPLAINT = /\b(complaint|damaged|broken|spoiled|defective|bad\s*(service|quality)|poor\s*service|worst|cheated|fraud|wrong\s*item|ruined)\b|ఫిర్యాదు|పాడైపోయింది|చెడిపోయింది|ఖరాబ్|शिकायत|खराब|टूटा|धोखा/i;
const RE_NEGOTIATION = /\b(discount|reduce\s*price|lower\s*price|bargain|best\s*rate|kam\s*karo|tagginchu|cheapest|last\s*price)\b|తగ్గించు|డిస్కౌంట్|రేటు\s*తగ్గించు|कम\s*करो|छूट|डिस्काउंट/i;
const RE_REFUND = /\b(refund|return\s*money|money\s*back|cancel\s*and\s*refund|paise\s*wapas)\b|డబ్బులు\s*తిరిగి|రిఫండ్|पैसे\s*वापस|रिफंड/i;
const RE_LEGAL = /\b(legal\s*advice|court|lawyer|advocate|lawsuit|notice|police|fir)\b|న్యాయ\s*సలహా|కోర్టు|నోటీసు|कानूनी\s*सलाह|वकील|मुकदमा/i;
const RE_MEDICAL = /\b(medical\s*advice|prescription|cure|disease|symptoms|medicine\s*for|doctor)\b|మందులు|రోగానికి|వైద్యం|दवा|इलाज|डॉक्टर/i;
const RE_FINANCIAL = /\b(financial\s*advice|tax\s*evasion|stock\s*tip|invest\s*in|crypto\s*tip)\b|పెట్టుబడి|ఆర్థిక\s*సలహా|वित्तीय\s*सलाह|निवेश/i;
const RE_FAQ = /\b(faq|payment\s*methods?|upi\s*accepted|card\s*accepted|home\s*delivery|shipping\s*policy|return\s*policy)\b/i;
const RE_ORDER_BOOKING = /\b(order|book|booking|reserve|reservation|buy\s*now|place\s*order)\b|ఆర్డర్|బుకింగ్|ऑर्डर|बुकिंग/i;

export function classifyInboundTopic(text) {
  const t = String(text || '').trim();
  if (!t) return 'unclear';

  if (RE_ORDER_BOOKING.test(t)) return 'order_request';
  if (RE_REFUND.test(t)) return 'refund';
  if (RE_COMPLAINT.test(t)) return 'complaint';
  if (RE_NEGOTIATION.test(t)) return 'negotiation';
  if (RE_LEGAL.test(t)) return 'legal_advice';
  if (RE_MEDICAL.test(t)) return 'medical_advice';
  if (RE_FINANCIAL.test(t)) return 'financial_advice';
  if (RE_TIMINGS.test(t)) return 'timings';
  if (RE_LOCATION.test(t)) return 'location';
  if (RE_AVAIL_PRICE.test(t)) return 'item_availability';
  if (RE_FAQ.test(t)) return 'faq';

  return 'unclear';
}

export function sanitizeSnippet(body, maxLen = 80) {
  if (!body) return '';
  const singleLine = String(body).replace(/[\r\n\t]+/g, ' ').trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen - 3) + '...';
}

// ── RULE 1: AUTO-REPLY EVALUATOR ─────────────────────────────────────────────

export function evaluateAutoReply({
  topic,
  text,
  inventoryMatch = null,
  workspaceInfo = null,
}) {
  const isAllowedTopic = ALLOWED_AUTOREPLY_TOPICS.has(topic);

  if (!isAllowedTopic) {
    return {
      allowed: false,
      topic,
      decision: 'queue_for_owner',
      reason: `Topic "${topic}" requires manual owner review (Rule 1).`,
      actions: ['Send', 'Edit', 'Ignore'],
      suggestedReply: null,
      queuedForOwner: true,
      ownerNotice: `Customer message on "${topic}" was queued for review. Tap Send / Edit / Ignore to respond.`,
    };
  }

  if (topic === 'item_availability' || topic === 'item_price') {
    if (!inventoryMatch || inventoryMatch.found !== true) {
      return {
        allowed: false,
        topic,
        decision: 'queue_for_owner',
        reason: 'Item availability or price is not stored in QuietKeep.',
        actions: ['Send', 'Edit', 'Ignore'],
        suggestedReply: null,
        queuedForOwner: true,
        ownerNotice: 'Item inquiry not found in QuietKeep stock records. Queued for owner response.',
      };
    }

    const pricePart = inventoryMatch.price ? ` Price: ₹${inventoryMatch.price}.` : '';
    const stockPart = inventoryMatch.inStock ? ' Yes, currently in stock.' : ' Currently out of stock.';
    return {
      allowed: true,
      topic,
      decision: 'auto_reply_allowed',
      reason: 'Stored inventory availability and price match.',
      actions: [],
      suggestedReply: `${inventoryMatch.name}:${stockPart}${pricePart}`,
      queuedForOwner: false,
      ownerNotice: null,
    };
  }

  if (topic === 'timings') {
    if (!workspaceInfo?.timings) {
      return {
        allowed: false,
        topic,
        decision: 'queue_for_owner',
        reason: 'Shop timings not configured in QuietKeep.',
        actions: ['Send', 'Edit', 'Ignore'],
        suggestedReply: null,
        queuedForOwner: true,
        ownerNotice: 'Customer asked for timings but shop timings are unconfigured.',
      };
    }
    return {
      allowed: true,
      topic,
      decision: 'auto_reply_allowed',
      reason: 'Standard shop timings available.',
      actions: [],
      suggestedReply: `Our shop timings are: ${workspaceInfo.timings}`,
      queuedForOwner: false,
      ownerNotice: null,
    };
  }

  if (topic === 'location') {
    if (!workspaceInfo?.address) {
      return {
        allowed: false,
        topic,
        decision: 'queue_for_owner',
        reason: 'Shop location/address not configured in QuietKeep.',
        actions: ['Send', 'Edit', 'Ignore'],
        suggestedReply: null,
        queuedForOwner: true,
        ownerNotice: 'Customer asked for location but address is unconfigured.',
      };
    }
    return {
      allowed: true,
      topic,
      decision: 'auto_reply_allowed',
      reason: 'Standard shop location available.',
      actions: [],
      suggestedReply: `Our shop is located at: ${workspaceInfo.address}`,
      queuedForOwner: false,
      ownerNotice: null,
    };
  }

  if (topic === 'faq') {
    return {
      allowed: true,
      topic,
      decision: 'auto_reply_allowed',
      reason: 'Standard FAQ question.',
      actions: [],
      suggestedReply: workspaceInfo?.faqReply || 'Thank you for asking. For details please visit our shop or contact us directly.',
      queuedForOwner: false,
      ownerNotice: null,
    };
  }

  return {
    allowed: false,
    topic: 'unclear',
    decision: 'queue_for_owner',
    reason: 'Unclear inquiry requires manual owner review.',
    actions: ['Send', 'Edit', 'Ignore'],
    suggestedReply: null,
    queuedForOwner: true,
    ownerNotice: 'Unclear customer inquiry queued for owner response.',
  };
}

// ── RULE 2: ORDERS & BOOKINGS NEVER CONFIRMED AUTOMATICALLY ─────────────────

export function evaluateOrderBooking({
  type = 'order',
  isOwnerConfirmed = false,
  customerName = 'Customer',
  details = {},
}) {
  const normType = type.includes('book') ? 'booking' : 'order';

  if (!isOwnerConfirmed) {
    return {
      allowed: false,
      isConfirmed: false,
      decision: 'pending_owner_confirmation',
      type: normType,
      reason: 'Orders and bookings are never confirmed automatically; requires one-tap owner confirmation (Rule 2).',
      actions: ['Confirm', 'Ignore'],
      customerNotice: `We have received your ${normType} request and are verifying availability with the store owner. We will notify you once confirmed.`,
      ownerNotice: `New ${normType} request from ${customerName}. One-tap Confirm or Ignore required.`,
      details,
    };
  }

  return {
    allowed: true,
    isConfirmed: true,
    decision: 'confirmed_by_owner',
    type: normType,
    reason: 'Owner provided explicit confirmation.',
    actions: [],
    customerNotice: `Your ${normType} is confirmed! Thank you for ordering with us.`,
    ownerNotice: `${normType} confirmed and customer notified.`,
    details,
  };
}

// ── RULE 3: NEVER BY AUTOMATION (HARD BLOCKS) ───────────────────────────────

export function evaluateAutomationAction({
  action,
  discountPercent = 0,
  maxAllowedDiscount = 0,
}) {
  if (action === 'payment') {
    return {
      allowed: false,
      action,
      decision: 'hard_block',
      reason: 'automated_payment_prohibited',
      ownerMessage: 'Automatic payments are strictly prohibited (Rule 3). All payments must be executed manually by the owner.',
    };
  }

  if (action === 'refund') {
    return {
      allowed: false,
      action,
      decision: 'hard_block',
      reason: 'automated_refund_prohibited',
      ownerMessage: 'Automatic refunds are strictly prohibited (Rule 3). Refunds require explicit manual review and verification by the owner.',
    };
  }

  if (action === 'payout') {
    return {
      allowed: false,
      action,
      decision: 'hard_block',
      reason: 'automated_payout_prohibited',
      ownerMessage: 'Automatic payouts are strictly prohibited (Rule 3). Payouts must be authorised and initiated directly by the owner.',
    };
  }

  if (action === 'legal_advice') {
    return {
      allowed: false,
      action,
      decision: 'hard_block',
      reason: 'automated_legal_advice_prohibited',
      ownerMessage: 'Providing legal advice by automation is strictly prohibited (Rule 3). Please consult a qualified legal professional.',
    };
  }

  if (action === 'discount') {
    if (discountPercent > maxAllowedDiscount) {
      return {
        allowed: false,
        action,
        decision: 'hard_block',
        reason: 'discount_exceeds_owner_limit',
        requestedDiscount: discountPercent,
        maxAllowedDiscount,
        ownerMessage: `Automated discount of ${discountPercent}% exceeds the owner-configured limit of ${maxAllowedDiscount}% (Rule 3). Blocked.`,
      };
    }
    return {
      allowed: true,
      action,
      decision: 'discount_allowed',
      reason: 'Discount is within owner-configured limit.',
      requestedDiscount: discountPercent,
      maxAllowedDiscount,
      ownerMessage: null,
    };
  }

  return {
    allowed: true,
    action,
    decision: 'allowed',
    reason: 'Action permitted.',
    ownerMessage: null,
  };
}

// ── RULE 4: PROMOTION LIMITS & CAPS ──────────────────────────────────────────

export function evaluatePromotionSend({
  businessCreatedAt,
  ownerDailyLimit = null,
  businessSentToday = 0,
  customerSentToday = 0,
  customerSentThisWeek = 0,
  isCustomerOptedOut = false,
  isTransactional = false,
  isCustomerInitiatedReply = false,
  isOrderUpdate = false,
  now = new Date(),
}) {
  const nowDate = now instanceof Date ? now : new Date(now);

  // Opt-out check:
  // Item F: transactional must not bypass opt-out for promotions;
  // opted-out customers may still get replies to their own new questions and their own order updates, nothing else.
  if (isCustomerOptedOut === true) {
    if (isTransactional && (isCustomerInitiatedReply === true || isOrderUpdate === true)) {
      return {
        allowed: true,
        decision: 'send_transactional',
        isPromotion: false,
        reason: 'customer_initiated_reply',
      };
    }
    return {
      allowed: false,
      decision: 'blocked',
      isPromotion: !isTransactional,
      reason: 'customer_opted_out',
      ownerMessage: 'Customer has opted out (STOP / వద్దు / बंद करो). Never messaged again unless directly replying to their new query or order.',
    };
  }

  // Transactional replies (order updates the customer asked for) are exempt from promo limits
  if (isTransactional === true) {
    return {
      allowed: true,
      decision: 'send_transactional',
      isPromotion: false,
      reason: null,
    };
  }

  // 1. Time window check: 10:00 to 21:00 India time
  if (!isWithinPromoHours(nowDate)) {
    const { hour, minute } = getIstParts(nowDate);
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return {
      allowed: false,
      decision: 'blocked',
      isPromotion: true,
      reason: 'outside_promo_hours',
      currentTimeIst: timeStr,
      ownerMessage: `Promotional messages are only allowed between 10:00 and 21:00 IST. Current time is ${timeStr} IST.`,
    };
  }

  // 2. Business daily cap:
  // Item J: 30-day cap: use < 30 days, not <= 30.
  let bizAgeDays = 0;
  if (businessCreatedAt) {
    const createdDate = new Date(businessCreatedAt);
    if (!isNaN(createdDate.getTime())) {
      bizAgeDays = Math.max(0, Math.floor((nowDate.getTime() - createdDate.getTime()) / (24 * 3600 * 1000)));
    }
  }

  const isNewBusiness = bizAgeDays < PROMO_CONSTANTS.NEW_BIZ_DAYS;
  const businessDailyLimit = isNewBusiness
    ? PROMO_CONSTANTS.NEW_BIZ_DAILY_MAX
    : (typeof ownerDailyLimit === 'number' && ownerDailyLimit > 0
        ? ownerDailyLimit
        : PROMO_CONSTANTS.DEFAULT_DAILY_MAX);

  if (businessSentToday >= businessDailyLimit) {
    const reason = isNewBusiness
      ? 'new_business_daily_limit_reached'
      : 'business_daily_limit_reached';
    return {
      allowed: false,
      decision: 'blocked',
      isPromotion: true,
      reason,
      limit: businessDailyLimit,
      sentToday: businessSentToday,
      bizAgeDays,
      ownerMessage: isNewBusiness
        ? `New business daily promotional limit (${PROMO_CONSTANTS.NEW_BIZ_DAILY_MAX}/day) reached. (Day ${bizAgeDays} of 30)`
        : `Daily promotional limit (${businessDailyLimit}/day) reached for this business.`,
    };
  }

  // 3. Per-customer daily cap: at most 1 per customer per day
  if (customerSentToday >= PROMO_CONSTANTS.MAX_PER_CUSTOMER_DAILY) {
    return {
      allowed: false,
      decision: 'blocked',
      isPromotion: true,
      reason: 'customer_daily_limit_reached',
      limit: PROMO_CONSTANTS.MAX_PER_CUSTOMER_DAILY,
      sentToday: customerSentToday,
      ownerMessage: `Customer promotional daily limit reached (at most ${PROMO_CONSTANTS.MAX_PER_CUSTOMER_DAILY} message per day per customer).`,
    };
  }

  // 4. Per-customer weekly cap: at most 4 per customer per week
  if (customerSentThisWeek >= PROMO_CONSTANTS.MAX_PER_CUSTOMER_WEEKLY) {
    return {
      allowed: false,
      decision: 'blocked',
      isPromotion: true,
      reason: 'customer_weekly_limit_reached',
      limit: PROMO_CONSTANTS.MAX_PER_CUSTOMER_WEEKLY,
      sentThisWeek: customerSentThisWeek,
      ownerMessage: `Customer promotional weekly limit reached (at most ${PROMO_CONSTANTS.MAX_PER_CUSTOMER_WEEKLY} messages per week per customer).`,
    };
  }

  return {
    allowed: true,
    decision: 'send_promotional',
    isPromotion: true,
    reason: null,
    ownerMessage: null,
  };
}

// ── RULE 5: OWNER AUDIT LOG BUILDER ──────────────────────────────────────────

export function buildOwnerAuditLog({
  workspaceId,
  who = 'unknown',
  what = 'unknown',
  why = 'unspecified',
  rawMessage = '',
  metadata = {},
}) {
  const normWho = normalizePhoneNumber(who);
  const maskedWho = maskPhoneNumber(normWho);
  const snippet = sanitizeSnippet(rawMessage, 80);

  return {
    workspace_id: workspaceId,
    action: `business_limit_${what}`,
    description: `[${what}] ${maskedWho}: ${why}`,
    entity_type: 'customer_message',
    metadata: {
      who: maskedWho,
      what,
      why,
      snippet: snippet || null,
      ...metadata,
    },
    created_at: new Date().toISOString(),
  };
}

// ── DATABASE HELPERS (SUPABASE INTEGRATION) ───────────────────────────────────

/**
 * Check if a customer is opted out in database.
 */
export async function isCustomerOptedOutInDb(supabase, workspaceId, phone) {
  if (!supabase || !workspaceId || !phone) return false;
  const normPhone = normalizePhoneNumber(phone);

  const { data: optOut, error: err1 } = await supabase
    .from('business_customer_opt_outs')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('phone', normPhone)
    .maybeSingle();

  if (err1) {
    console.error('[business-limits] isCustomerOptedOutInDb query error:', err1.message);
  }
  if (optOut) return true;

  // Also check business_customers.whatsapp_opted_in flag
  const { data: cust, error: err2 } = await supabase
    .from('business_customers')
    .select('whatsapp_opted_in')
    .eq('workspace_id', workspaceId)
    .eq('phone', normPhone)
    .maybeSingle();

  if (err2) {
    console.error('[business-limits] isCustomerOptedOutInDb cust query error:', err2.message);
  }
  if (cust && cust.whatsapp_opted_in === false) {
    return true;
  }

  return false;
}

/**
 * Record customer opt-out in database permanently.
 */
export async function recordCustomerOptOutInDb(supabase, workspaceId, phone, customerId = null, keyword = 'STOP') {
  if (!supabase || !workspaceId || !phone) return;
  const normPhone = normalizePhoneNumber(phone);
  const maskedPhone = maskPhoneNumber(normPhone);

  const { error: err1 } = await supabase.from('business_customer_opt_outs').upsert({
    workspace_id: workspaceId,
    customer_id: customerId || null,
    phone: normPhone,
    keyword: String(keyword).slice(0, 50),
    opted_out_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,phone' });

  if (err1) {
    console.error('[business-limits] recordCustomerOptOutInDb upsert error:', err1.message);
  }

  const { error: err2 } = await supabase.from('business_customers').update({
    whatsapp_opted_in: false,
  }).eq('workspace_id', workspaceId).eq('phone', normPhone);

  if (err2) {
    console.error('[business-limits] recordCustomerOptOutInDb cust update error:', err2.message);
  }

  const { error: err3 } = await supabase.from('business_activity_log').insert({
    workspace_id: workspaceId,
    action: 'customer_opt_out',
    description: `Customer ${maskedPhone} opted out via "${cleanTextForOptOut(keyword)}".`,
    entity_type: 'customer_message',
    metadata: { phone: maskedPhone, keyword: String(keyword).slice(0, 50) },
    created_at: new Date().toISOString(),
  });

  if (err3) {
    console.error('[business-limits] recordCustomerOptOutInDb activity log error:', err3.message);
  }
}

/**
 * Log blocked or queued event for the owner.
 */
export async function logBusinessLimitEvent(supabase, workspaceId, event) {
  if (!supabase || !workspaceId || !event) return;
  const maskedWho = maskPhoneNumber(event.who);
  const log = buildOwnerAuditLog({
    workspaceId,
    who: maskedWho,
    what: event.what,
    why: event.why,
    rawMessage: event.rawMessage,
    metadata: {
      ...event.metadata,
      phone: maskedWho,
    },
  });

  const { error } = await supabase.from('business_activity_log').insert({
    workspace_id: workspaceId,
    action: log.action,
    description: log.description,
    entity_type: log.entity_type,
    metadata: log.metadata,
    created_at: log.created_at,
  });

  if (error) {
    console.error('[business-limits] logBusinessLimitEvent error:', error.message);
  }
}

/**
 * Queue item for owner review with one-tap "Send / Edit / Ignore".
 */
export async function queueForOwnerReview(supabase, {
  workspaceId,
  userId = null,
  who = 'unknown',
  what = 'unclear',
  why = 'requires_owner_review',
  rawMessage = '',
  suggestedReply = null,
  actions = ['Send', 'Edit', 'Ignore'],
}) {
  if (!supabase || !workspaceId) return null;
  const normPhone = normalizePhoneNumber(who);
  const snippet = sanitizeSnippet(rawMessage);
  const payload = {
    customerPhone: normPhone,
    who: maskPhoneNumber(normPhone),
    what,
    why,
    snippet,
    suggested_reply: suggestedReply,
    allowed_actions: actions,
  };

  const { data, error } = await supabase.from('business_approvals').insert({
    workspace_id: workspaceId,
    user_id: userId,
    action_type: 'customer_reply',
    action_label: actions.join(' / '),
    payload,
    status: 'pending',
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) {
    console.error('[business-limits] queueForOwnerReview insert error:', error.message);
    return null;
  }

  await logBusinessLimitEvent(supabase, workspaceId, {
    who: normPhone,
    what: 'queued_for_owner',
    why,
    rawMessage,
    metadata: { approval_id: data?.id, allowed_actions: actions },
  });

  return data;
}