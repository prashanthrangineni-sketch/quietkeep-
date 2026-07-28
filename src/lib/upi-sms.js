// src/lib/upi-sms.js
// Parse an Indian UPI / bank / card payment SMS (or payment-app notification)
// into a structured expense. Best-effort, regex-based, no deps. Handles the
// common formats: "Rs.500 debited ... to RAMESH via UPI", "INR 250 sent to
// merchant@upi", "Rs 1,200 spent on your ICICI Card", "Received Rs.500 from X".
// Returns { amount, direction, party, method, category, ref, isPayment, raw }.

const CATEGORY_HINTS = [
  [/swiggy|zomato|restaurant|cafe|food|dominos|kfc|mcdonald|dinner|lunch|hotel/i, 'food'],
  [/uber|ola|rapido|fuel|petrol|diesel|metro|irctc|redbus|\bbus\b|fastag|toll|parking/i, 'transport'],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|\bshop\b|store|\bmall\b/i, 'shopping'],
  [/grocery|bigbasket|blinkit|zepto|dmart|jiomart|kirana|supermarket/i, 'groceries'],
  [/electricity|water|\bgas\b|recharge|broadband|\bdth\b|\bbill\b|postpaid|\bjio\b|airtel|\bvi\b/i, 'bills'],
  [/pharmacy|apollo|medplus|hospital|clinic|medical|\bhealth\b|doctor/i, 'health'],
  [/netflix|prime|hotstar|spotify|jiocinema|subscription/i, 'entertainment'],
];

function toNumber(s) {
  if (!s) return 0;
  return parseFloat(String(s).replace(/,/g, '')) || 0;
}

export function parseUpiSms(raw) {
  const text = String(raw || '').trim();
  const t = text.toLowerCase();

  // Amount: Rs./INR/₹ before or after the number.
  const amtMatch =
    text.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)/i);
  const amount = amtMatch ? toNumber(amtMatch[1]) : 0;

  const debit = /\b(debited|debit|sent|paid|spent|withdrawn|purchase|payment of|txn of)\b/.test(t);
  const credit = /\b(credited|credit|received|deposited|refund)\b/.test(t);
  const direction = debit && !credit ? 'debit' : credit && !debit ? 'credit' : (debit ? 'debit' : credit ? 'credit' : null);

  // Party: to/from NAME (stop at connector words).
  let party = null;
  const pm = text.match(/\b(?:paid to|received from|sent to|to|from|at)\s+([A-Za-z][A-Za-z0-9 .&'@_-]{1,32})/i);
  if (pm) party = pm[1].trim().replace(/\s+(on|via|ref|dated|through|using|a\/c).*$/i, '').trim();

  let method = 'upi';
  if (/\bcard\b|credit card|debit card/.test(t)) method = 'card';
  else if (/neft|imps|net ?banking/.test(t)) method = 'netbanking';
  else if (/wallet/.test(t)) method = 'wallet';
  else if (/upi/.test(t)) method = 'upi';

  let category = 'other';
  for (const [re, cat] of CATEGORY_HINTS) { if (re.test(text)) { category = cat; break; } }

  const ref = (text.match(/(?:ref|rrn|txn|utr)[:\s#]*([A-Za-z0-9]{6,})/i) || [])[1] || null;

  const isPayment = amount > 0 && !!direction;
  return { amount, direction, party, method, category, ref, isPayment, raw: text };
}
