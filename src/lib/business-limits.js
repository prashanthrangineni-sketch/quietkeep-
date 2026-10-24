// src/lib/business-limits.js
//
// QUIETKEEP BUSINESS: AUTO-REPLY AND PROMOTION LIMITS ENFORCED IN CODE.
// (CARD AG-AARIA-25, founder decision 4, "plan as per market".)
//
// Pure safety rules module with database helper functions.
//
// RULES ENFORCED:
//   1. Automatic replies to customers are allowed ONLY for: FAQs, shop timings,
//      location, and item availability/price as stored in QuietKeep.
//      Everything else (complaints, negotiation, refunds, legal/medical/financial
//      advice, anything unclear) is NOT auto-sent — queued for owner with
//      one-tap "Send / Edit / Ignore".
//   2. Orders and bookings: never confirmed automatically; always a one-tap
//      owner confirmation before the customer is told "confirmed".
//   3. Never by automation: payments, refunds, payouts, discounts above owner
//      limit, or legal advice. Hard block in code with clear owner message.
//   4. Promotion limits (per business):
//        - at most 250 promo messages/day in first 30 days (default 1000/day after,
//          or owner-set limit);
//        - at most 1 per customer per day and 4 per customer per week;
//        - only between 10:00 and 21:00 India time (IST);
//        - customer who replied STOP / "వద్దు" / "बंद करो" is never messaged again (opt-out stored);
//        - transactional replies are not promotions.
//   5. Every blocked or queued item is logged for the owner (who/what/why)
//      without storing message bodies longer than needed.

export const TZ_INDIA = 'Asia/Kolkata';

// ── 4. PROMOTION LIMIT CONSTANTS ─────────────────────────────────────────────
export const PROMO_CONSTANTS = Object.freeze({
  NEW_BIZ_DAYS: 30,
  NEW_BIZ_DAILY_MAX: 250,
  DEFAULT_DAILY_MAX: 1000,
  PER_CUSTOMER_DAILY_MAX: 1,
  PER_CUSTOMER_WEEKLY_MAX: 4,
  WINDOW_START_HOUR: 10,
  WINDOW_START_MINUTE: 0,
  WINDOW_END_HOUR: 21,
  WINDOW_END_MINUTE: 0,
});

// ── 1. ALLOWED & DISALLOWED AUTO-REPLY TOPICS ────────────────────────────────
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
  'unclear',
]));

// ── 3. HARD-BLOCKED AUTOMATIONS ──────────────────────────────────────────────
export const HARD_BLOCKED_AUTOMATIONS = Object.freeze(new Set([
  'payment',
  'refund',
  'payout',
  'excess_discount',
  'legal_advice',
]));

// ── 4. TIME WINDOW HELPER (India Time) ───────────────────────────────────────
/**
 * Decompose a date into year, month, day, hour, minute, second in Asia/Kolkata.
 */
export function getIstParts(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date passed to getIstParts');
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_INDIA,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(d).map((p) => [p.type, p.value])
  );
  const hour = parseInt(parts.hour, 10) === 24 ? 0 : parseInt(parts.hour, 10);
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
    dateString: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * Are we within the promotional sending window: 10:00 to 21:00 India time?
 * Edges:
 *   09:59 IST -> false (blocked)
 *   10:00 IST -> true  (allowed)
 *   21:00 IST -> true  (allowed at 21:00:00)
 *   21:01 IST -> false (blocked)
 */
export function isWithinPromoHours(date = new Date()) {
  const { hour, minute, second } = getIstParts(date);
  const totalSeconds = hour * 3600 + minute * 60 + second;
  const startSeconds = PROMO_CONSTANTS.WINDOW_START_HOUR * 3600 + PROMO_CONSTANTS.WINDOW_START_MINUTE * 60; // 36000
  const endSeconds = PROMO_CONSTANTS.WINDOW_END_HOUR * 3600 + PROMO_CONSTANTS.WINDOW_END_MINUTE * 60;       // 75600
  return totalSeconds >= startSeconds && totalSeconds <= endSeconds;
}

// ── 4. OPT-OUT WORDS (English, Telugu, Hindi) ────────────────────────────────
// A customer who replied STOP / "వద్దు" / "बंद करो" is never messaged again.
const OPT_OUT_EN = /^(stop|unsubscribe|cancel|quit|end|optout|opt-out|stopall)$/i;
const OPT_OUT_TE = /^(వద్దు|ఆపండి|వద్దండి|వద్దు ఇక|ఆపండి ఇక|వద్దు బాబోయ్)$/iu;
const OPT_OUT_HI = /^(बंद\s*करो|बंद\s*करें|रोकें|रोको|मत\s*भेजो|बस\s*करो|बंद\s*कर\s*दो)$/iu;

// Also match within short messages (<= 4 words)
const OPT_OUT_PATTERNS = [
  /\b(stop|unsubscribe|quit|optout|opt-out)\b/i,
  /వద్దు|ఆపండి|వద్దండి/u,
  /बंद\s*करो|बंद\s*करें|रोकें|रोको|मत\s*भेजो/u,
];

/**
 * Is this inbound message an opt-out command?
 * Supports English, Telugu ("వద్దు", "ఆపండి"), Hindi ("बंद करो", "रोकें", "मत भेजो").
 */
export function isOptOutMessage(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  // Clean punctuation at borders
  const clean = raw.replace(/^[\s,.!?;:'"()[\]{}<>«»]+|[\s,.!?;:'"()[\]{}<>«»]+$/gu, '').trim();
  if (!clean) return false;

  // Exact command match
  if (OPT_OUT_EN.test(clean) || OPT_OUT_TE.test(clean) || OPT_OUT_HI.test(clean)) {
    return true;
  }

  // Short messages under 5 words containing opt-out words
  const words = clean.split(/\s+/);
  if (words.length <= 4) {
    for (const pat of OPT_OUT_PATTERNS) {
      if (pat.test(clean)) return true;
    }
  }

  return false;
}

// ── 1. CLASSIFY INBOUND CUSTOMER TOPIC ───────────────────────────────────────
const RE_TIMINGS = /\b(timings?|opening\s*hours?|closing\s*time|open\s*today|shop\s*hours?|hours\s*of\s*operation|when\s*do\s*you\s*(open|close)|are\s*you\s*open)\b|సమయం|ఎప్పుడు\s*(తెరుస్తారు|మూస్తారు)|దुकान\s*कब\s*(खुलती|बंद)|समय\s*क्या/i;
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

/**
 * Classify customer message into a topic.
 */
export function classifyInboundTopic(text) {
  const t = String(text || '').trim();
  if (!t) return 'unclear';

  // Check dangerous/sensitive topics first
  if (RE_LEGAL.test(t)) return 'legal_advice';
  if (RE_MEDICAL.test(t)) return 'medical_advice';
  if (RE_FINANCIAL.test(t)) return 'financial_advice';
  if (RE_REFUND.test(t)) return 'refund';
  if (RE_COMPLAINT.test(t)) return 'complaint';
  if (RE_NEGOTIATION.test(t)) return 'negotiation';

  // Orders / Bookings
  if (RE_ORDER_BOOKING.test(t)) {
    if (/\b(book|booking|reserve|reservation)\b|బుకింగ్|बुकिंग/i.test(t)) return 'booking';
    return 'order';
  }

  // Safe informational topics
  if (RE_TIMINGS.test(t)) return 'timings';
  if (RE_LOCATION.test(t)) return 'location';
  if (RE_AVAIL_PRICE.test(t)) {
    if (/\b(price|cost|rate|how\s*much)\b|ధర|ఎంత|कितने|दाम|भाव/i.test(t)) return 'item_price';
    return 'item_availability';
  }
  if (RE_FAQ.test(t)) return 'faq';

  return 'unclear';
}

// ── 5. SNIPPET SANITIZER ─────────────────────────────────────────────────────
/**
 * Truncate and sanitize message snippet for owner logging without storing
 * long bodies.
 */
export function sanitizeSnippet(text, maxLen = 80) {
  const clean = String(text || '')
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ');
  if (!clean) return '';
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 3)}...` : clean;
}

// ── 1. RULE 1: EVALUATE AUTO-REPLY ───────────────────────────────────────────
/**
 * Automatic replies to customers are allowed ONLY for:
 *   - FAQs
 *   - shop timings
 *   - location
 *   - item availability/price as stored in QuietKeep
 * Everything else is queued for the owner with one-tap "Send / Edit / Ignore".
 */
export function evaluateAutoReply({
  topic = null,
  text = '',
  storedItem = null,
  workspaceInfo = {},
}) {
  const resolvedTopic = topic || classifyInboundTopic(text);
  const snippet = sanitizeSnippet(text);

  // If topic is disallowed -> Queue for owner with one-tap Send / Edit / Ignore
  if (!ALLOWED_AUTOREPLY_TOPICS.has(resolvedTopic)) {
    const reason =
      resolvedTopic === 'complaint'
        ? 'complaints_must_be_reviewed'
        : resolvedTopic === 'negotiation'
        ? 'negotiation_must_be_reviewed'
        : resolvedTopic === 'refund'
        ? 'refund_must_be_reviewed'
        : resolvedTopic === 'legal_advice'
        ? 'legal_advice_prohibited'
        : resolvedTopic === 'medical_advice'
        ? 'medical_advice_prohibited'
        : resolvedTopic === 'financial_advice'
        ? 'financial_advice_prohibited'
        : resolvedTopic === 'order' || resolvedTopic === 'booking'
        ? 'order_booking_needs_owner_confirmation'
        : 'unclear_message_queued';

    return {
      allowed: false,
      decision: 'queue_for_owner',
      topic: resolvedTopic,
      reason,
      actions: ['Send', 'Edit', 'Ignore'],
      snippet,
      ownerMessage: `Message regarding ${resolvedTopic.replace(/_/g, ' ')} queued for review: "${snippet}".`,
      suggestedReply: null,
    };
  }

  // Allowed topics: must have matching stored data in QuietKeep
  if (resolvedTopic === 'timings') {
    const timings = workspaceInfo?.timings;
    if (!timings) {
      return {
        allowed: false,
        decision: 'queue_for_owner',
        topic: resolvedTopic,
        reason: 'timings_not_configured',
        actions: ['Send', 'Edit', 'Ignore'],
        snippet,
        ownerMessage: 'Customer asked for shop timings, but none are configured.',
        suggestedReply: null,
      };
    }
    return {
      allowed: true,
      decision: 'auto_reply',
      topic: resolvedTopic,
      reply: `Our shop timings: ${timings}.`,
      snippet,
    };
  }

  if (resolvedTopic === 'location') {
    const address = workspaceInfo?.address;
    if (!address) {
      return {
        allowed: false,
        decision: 'queue_for_owner',
        topic: resolvedTopic,
        reason: 'location_not_configured',
        actions: ['Send', 'Edit', 'Ignore'],
        snippet,
        ownerMessage: 'Customer asked for store location, but address is not set.',
        suggestedReply: null,
      };
    }
    return {
      allowed: true,
      decision: 'auto_reply',
      topic: resolvedTopic,
      reply: `Our location: ${address}.`,
      snippet,
    };
  }

  if (resolvedTopic === 'faq') {
    const faqs = workspaceInfo?.faqs;
    const answer = typeof faqs === 'object' && faqs !== null ? faqs[text] || faqs.default : null;
    if (!answer) {
      return {
        allowed: false,
        decision: 'queue_for_owner',
        topic: resolvedTopic,
        reason: 'faq_not_found',
        actions: ['Send', 'Edit', 'Ignore'],
        snippet,
        ownerMessage: `Customer question not matched in stored FAQs: "${snippet}".`,
        suggestedReply: null,
      };
    }
    return {
      allowed: true,
      decision: 'auto_reply',
      topic: resolvedTopic,
      reply: answer,
      snippet,
    };
  }

  if (resolvedTopic === 'item_availability' || resolvedTopic === 'item_price') {
    if (!storedItem) {
      return {
        allowed: false,
        decision: 'queue_for_owner',
        topic: resolvedTopic,
        reason: 'item_not_in_inventory',
        actions: ['Send', 'Edit', 'Ignore'],
        snippet,
        ownerMessage: `Item not found in stored inventory for inquiry: "${snippet}".`,
        suggestedReply: null,
      };
    }

    const stock = Number(storedItem.current_stock || 0);
    const unit = storedItem.unit ? ` ${storedItem.unit}` : '';
    const price = storedItem.selling_price ? `₹${storedItem.selling_price}` : null;
    const availText = stock > 0 ? `In stock (${stock}${unit})` : 'Currently out of stock';

    let reply;
    if (resolvedTopic === 'item_price') {
      reply = price
        ? `${storedItem.name} is ${price}${unit ? ` per ${storedItem.unit}` : ''}. (${availText})`
        : `${storedItem.name}: ${availText}. Please contact us for pricing.`;
    } else {
      reply = `${storedItem.name}: ${availText}.${price ? ` Price: ${price}${unit ? ` per ${storedItem.unit}` : ''}.` : ''}`;
    }

    return {
      allowed: true,
      decision: 'auto_reply',
      topic: resolvedTopic,
      reply,
      snippet,
      storedItem: { name: storedItem.name, stock, price: storedItem.selling_price },
    };
  }

  // Fallback safe queue
  return {
    allowed: false,
    decision: 'queue_for_owner',
    topic: 'unclear',
    reason: 'unclear_message_queued',
    actions: ['Send', 'Edit', 'Ignore'],
    snippet,
    ownerMessage: `Inbound customer message queued: "${snippet}".`,
    suggestedReply: null,
  };
}

// ── 2. RULE 2: ORDERS & BOOKINGS ─────────────────────────────────────────────
/**
 * Orders and bookings: NEVER confirmed automatically.
 * Always a one-tap owner confirmation before customer is told "confirmed".
 */
export function evaluateOrderBooking({
  type = 'order',
  isOwnerConfirmed = false,
  customerName = 'Customer',
  details = {},
}) {
  const normType = String(type).toLowerCase().includes('book') ? 'booking' : 'order';

  if (isOwnerConfirmed !== true) {
    return {
      allowed: false,
      decision: 'queue_for_owner',
      status: 'pending_owner_confirmation',
      type: normType,
      reason: 'order_booking_never_auto_confirmed',
      actions: ['Confirm', 'Edit', 'Reject'],
      ownerMessage: `New ${normType} from ${customerName} requires one-tap owner confirmation before customer is told confirmed.`,
      customerNotice: `We have received your ${normType} request and are confirming it shortly.`,
      details,
    };
  }

  return {
    allowed: true,
    decision: 'confirmed_by_owner',
    status: 'confirmed',
    type: normType,
    ownerMessage: `${normType === 'booking' ? 'Booking' : 'Order'} confirmed by owner.`,
    customerNotice: `Your ${normType} has been confirmed!`,
    details,
  };
}

// ── 3. RULE 3: NEVER BY AUTOMATION ───────────────────────────────────────────
/**
 * Never by automation: payments, refunds, payouts, discounts above owner limit,
 * or legal advice. Hard block in code with clear owner-facing message.
 */
export function evaluateAutomationAction({
  action,
  discountPercent = 0,
  ownerMaxDiscount = 0,
}) {
  const act = String(action || '').toLowerCase().trim();

  if (act === 'payment') {
    return {
      allowed: false,
      decision: 'hard_block',
      action: act,
      reason: 'automated_payment_prohibited',
      ownerMessage: 'Payments cannot be initiated by automation. The owner must approve all payments directly.',
    };
  }

  if (act === 'refund') {
    return {
      allowed: false,
      decision: 'hard_block',
      action: act,
      reason: 'automated_refund_prohibited',
      ownerMessage: 'Refunds cannot be issued automatically. Owner action and verification is required.',
    };
  }

  if (act === 'payout') {
    return {
      allowed: false,
      decision: 'hard_block',
      action: act,
      reason: 'automated_payout_prohibited',
      ownerMessage: 'Salary and staff payouts cannot be made by automation. Owner PIN authorization is required.',
    };
  }

  if (act === 'legal_advice') {
    return {
      allowed: false,
      decision: 'hard_block',
      action: act,
      reason: 'automated_legal_advice_prohibited',
      ownerMessage: 'Legal advice cannot be provided by automated systems.',
    };
  }

  if (act === 'discount' || act === 'excess_discount') {
    const disc = Number(discountPercent || 0);
    const maxAllowed = Number(ownerMaxDiscount || 0);
    if (disc > maxAllowed) {
      return {
        allowed: false,
        decision: 'hard_block',
        action: 'excess_discount',
        reason: 'discount_exceeds_owner_limit',
        discountPercent: disc,
        ownerMaxDiscount: maxAllowed,
        ownerMessage: `Automated discount of ${disc}% exceeds the owner limit of ${maxAllowed}%. Hard blocked.`,
      };
    }
    return {
      allowed: true,
      decision: 'allowed',
      action: 'discount',
      discountPercent: disc,
      ownerMaxDiscount: maxAllowed,
    };
  }

  // Any other unknown financial transfer / advice
  return {
    allowed: true,
    decision: 'allowed',
    action: act,
  };
}

// ── 4. RULE 4: PROMOTION LIMITS ──────────────────────────────────────────────
/**
 * Evaluate promotion limits:
 *   - at most 250 promo messages/day in first 30 days (default 1000/day after, or owner-set limit)
 *   - at most 1 per customer per day
 *   - at most 4 per customer per week
 *   - only between 10:00 and 21:00 India time (IST)
 *   - customer who replied STOP / "వద్దు" / "बंद करो" is never messaged again (opt-out stored)
 *   - transactional replies are not promotions
 */
export function evaluatePromotionSend({
  businessCreatedAt,
  ownerDailyLimit = null,
  businessSentToday = 0,
  customerSentToday = 0,
  customerSentThisWeek = 0,
  isCustomerOptedOut = false,
  isTransactional = false,
  now = new Date(),
}) {
  const nowDate = now instanceof Date ? now : new Date(now);

  // Transactional replies are exempt from promotional limits & time windows
  if (isTransactional === true) {
    return {
      allowed: true,
      decision: 'send_transactional',
      isPromotion: false,
      reason: null,
    };
  }

  // 1. Opt-out check: never messaged again
  if (isCustomerOptedOut === true) {
    return {
      allowed: false,
      decision: 'blocked',
      isPromotion: true,
      reason: 'customer_opted_out',
      ownerMessage: 'Customer has opted out (STOP / వద్దు / बंद करो). Never messaged again.',
    };
  }

  // 2. Time window check: 10:00 to 21:00 India time
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

  // 3. Business daily cap (250/day in first 30 days, owner limit or default 1000/day after)
  let bizAgeDays = 0;
  if (businessCreatedAt) {
    const createdDate = new Date(businessCreatedAt);
    if (!isNaN(createdDate.getTime())) {
      bizAgeDays = Math.max(0, Math.floor((nowDate.getTime() - createdDate.getTime()) / (24 * 3600 * 1000)));
    }
  }

  const isNewBusiness = bizAgeDays <= PROMO_CONSTANTS.NEW_BIZ_DAYS;
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

  // 4. Per-customer daily cap: at most 1 per customer per day
  if (customerSentToday >= PROMO_CONSTANTS.PER_CUSTOMER_DAILY_MAX) {
    return {
      allowed: false,
      decision: 'blocked',
      isPromotion: true,
      reason: 'customer_daily_limit_reached',
      limit: PROMO_CONSTANTS.PER_CUSTOMER_DAILY_MAX,
      sentToday: customerSentToday,
      ownerMessage: 'At most 1 promotional message per customer per day.',
    };
  }

  // 5. Per-customer weekly cap: at most 4 per customer per week
  if (customerSentThisWeek >= PROMO_CONSTANTS.PER_CUSTOMER_WEEKLY_MAX) {
    return {
      allowed: false,
      decision: 'blocked',
      isPromotion: true,
      reason: 'customer_weekly_limit_reached',
      limit: PROMO_CONSTANTS.PER_CUSTOMER_WEEKLY_MAX,
      sentThisWeek: customerSentThisWeek,
      ownerMessage: 'At most 4 promotional messages per customer per week.',
    };
  }

  return {
    allowed: true,
    decision: 'send_promotional',
    isPromotion: true,
    limit: businessDailyLimit,
    sentToday: businessSentToday,
  };
}

// ── 5. RULE 5: LOGGING BUILDER ───────────────────────────────────────────────
/**
 * Build owner audit log entry (who/what/why) with bounded snippet length.
 */
export function buildOwnerAuditLog({
  workspaceId,
  who = 'unknown',
  what,
  why,
  rawMessage = null,
  metadata = {},
}) {
  const snippet = sanitizeSnippet(rawMessage, 80);
  return {
    workspace_id: workspaceId || null,
    action: what,
    description: `${what}: ${why} [${who}]${snippet ? ` - "${snippet}"` : ''}`,
    entity_type: 'customer_message',
    metadata: {
      who,
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
  try {
    const { data: optOut } = await supabase
      .from('business_customer_opt_outs')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('phone', phone)
      .maybeSingle();
    if (optOut) return true;

    // Also check business_customers.whatsapp_opted_in flag
    const { data: cust } = await supabase
      .from('business_customers')
      .select('whatsapp_opted_in')
      .eq('workspace_id', workspaceId)
      .eq('phone', phone)
      .maybeSingle();

    if (cust && cust.whatsapp_opted_in === false) {
      return true;
    }
  } catch (e) {
    console.warn('[business-limits] isCustomerOptedOutInDb error:', e?.message || e);
  }
  return false;
}

/**
 * Record customer opt-out in database permanently.
 */
export async function recordCustomerOptOutInDb(supabase, workspaceId, phone, customerId = null, keyword = 'STOP') {
  if (!supabase || !workspaceId || !phone) return;
  try {
    // 1. Insert into business_customer_opt_outs
    await supabase.from('business_customer_opt_outs').upsert({
      workspace_id: workspaceId,
      customer_id: customerId || null,
      phone,
      keyword: String(keyword).slice(0, 50),
      opted_out_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,phone' });

    // 2. Update business_customers.whatsapp_opted_in = false
    await supabase.from('business_customers').update({
      whatsapp_opted_in: false,
    }).eq('workspace_id', workspaceId).eq('phone', phone);

    // 3. Log to activity log
    await supabase.from('business_activity_log').insert({
      workspace_id: workspaceId,
      action: 'customer_opt_out',
      description: `Customer ${phone} opted out via "${keyword}".`,
      entity_type: 'customer_message',
      metadata: { phone, keyword },
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[business-limits] recordCustomerOptOutInDb error:', e?.message || e);
  }
}

/**
 * Log blocked or queued event for the owner.
 */
export async function logBusinessLimitEvent(supabase, workspaceId, event) {
  if (!supabase || !workspaceId || !event) return;
  try {
    const log = buildOwnerAuditLog({
      workspaceId,
      who: event.who,
      what: event.what,
      why: event.why,
      rawMessage: event.rawMessage,
      metadata: event.metadata,
    });

    await supabase.from('business_activity_log').insert({
      workspace_id: workspaceId,
      action: log.action,
      description: log.description,
      entity_type: log.entity_type,
      metadata: log.metadata,
      created_at: log.created_at,
    });
  } catch (e) {
    console.warn('[business-limits] logBusinessLimitEvent error:', e?.message || e);
  }
}

/**
 * Queue item for owner review with one-tap "Send / Edit / Ignore".
 */
export async function queueForOwnerReview(supabase, {
  workspaceId,
  userId = null,
  who = 'unknown',
  what = 'customer_message',
  why = 'requires_review',
  rawMessage = '',
  suggestedReply = null,
  actions = ['Send', 'Edit', 'Ignore'],
}) {
  if (!supabase || !workspaceId) return null;
  try {
    const snippet = sanitizeSnippet(rawMessage, 100);
    const payload = {
      who,
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

    if (!error) {
      await logBusinessLimitEvent(supabase, workspaceId, {
        who,
        what: 'queued_for_owner',
        why,
        rawMessage,
        metadata: { approval_id: data?.id, allowed_actions: actions },
      });
      return data;
    }
  } catch (e) {
    console.warn('[business-limits] queueForOwnerReview error:', e?.message || e);
  }
  return null;
}