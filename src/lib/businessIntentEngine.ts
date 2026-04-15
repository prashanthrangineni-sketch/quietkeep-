/**
 * src/lib/businessIntentEngine.ts  —  Step 7: Business Automation Engine
 *
 * Handles voice intents specific to the QuietKeep Business workspace.
 * FULLY ISOLATED from the personal dashboard flow.
 *
 * HARD CONTRACT:
 *   • MUST NOT modify dashboard/page.jsx
 *   • MUST NOT import from or modify voiceIntentEngine.ts
 *   • MUST NOT affect the personal voice pipeline in any way
 *   • Returns results identical in shape to IntentResult — callers use them
 *     the same way, but this engine is only called from business mode pages
 *
 * INTEGRATION:
 *   Only the business dashboard (src/app/business/page.jsx or equivalent)
 *   should import and call parseBusinessIntent(). It is never called from
 *   the personal dashboard.
 *
 * USAGE:
 *   import { parseBusinessIntent } from '@/lib/businessIntentEngine';
 *   const result = parseBusinessIntent(transcript, workspaceId);
 *   if (result.handled) { speak(result.response); }
 */

// ── Types (mirrors IntentResult shape — no shared import needed) ──────────

export interface BusinessIntentResult {
  handled:     boolean;
  intentType:  BusinessIntentType;
  response:    string;
  actionKey?:  string;
  entities:    BusinessIntentEntities;
  confidence?: number;
}

export interface BusinessIntentEntities {
  contactName?: string;
  amount?:      string;
  date?:        string;
  taskTitle?:   string;
  clientName?:  string;
  remainder?:   string;
}

export type BusinessIntentType =
  | 'business_invoice'
  | 'business_task'
  | 'business_meeting'
  | 'business_expense'
  | 'business_contact'
  | 'business_report'
  | 'business_follow_up'
  | 'business_cancel'
  | 'business_unknown';

/** Minimum confidence for a business intent to be treated as handled */
export const BUSINESS_CONFIDENCE_THRESHOLD = 0.60;

// ── Normalisation (private, does not import from voiceIntentEngine) ───────

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Business intent patterns ──────────────────────────────────────────────

interface BizPattern {
  intentType:      BusinessIntentType;
  patterns:        RegExp[];
  response:        string;
  actionKey:       string;
}

const BUSINESS_PATTERNS: BizPattern[] = [
  {
    intentType: 'business_invoice',
    patterns: [
      /\bcreate\s+invoice\b/,
      /\bnew\s+invoice\b/,
      /\bsend\s+invoice\b/,
      /\bgenerate\s+invoice\b/,
      /\binvoice\s+(?:for|to)\b/,
    ],
    response:  'Creating invoice.',
    actionKey: 'business:create_invoice',
  },
  {
    intentType: 'business_task',
    patterns: [
      /\badd\s+(?:business\s+)?task\b/,
      /\bnew\s+(?:work\s+)?task\b/,
      /\bcreate\s+(?:work\s+)?task\b/,
      /\bassign\s+task\b/,
      /\btask\s+for\s+\w+/,
    ],
    response:  'Adding business task.',
    actionKey: 'business:create_task',
  },
  {
    intentType: 'business_meeting',
    patterns: [
      /\bschedule\s+(?:a\s+)?meeting\b/,
      /\bset\s+(?:up\s+)?meeting\b/,
      /\bnew\s+meeting\b/,
      /\bbook\s+(?:a\s+)?call\b/,
      /\bschedule\s+call\b/,
    ],
    response:  'Scheduling meeting.',
    actionKey: 'business:schedule_meeting',
  },
  {
    intentType: 'business_expense',
    patterns: [
      /\blog\s+expense\b/,
      /\badd\s+expense\b/,
      /\brecord\s+expense\b/,
      /\bbusiness\s+expense\b/,
      /\bwork\s+expense\b/,
      /\breimburse\b/,
    ],
    response:  'Logging business expense.',
    actionKey: 'business:log_expense',
  },
  {
    intentType: 'business_contact',
    patterns: [
      /\badd\s+(?:business\s+)?client\b/,
      /\bnew\s+client\b/,
      /\badd\s+contact\b/,
      /\bcreate\s+client\b/,
      /\bclient\s+details?\b/,
    ],
    response:  'Adding client contact.',
    actionKey: 'business:add_client',
  },
  {
    intentType: 'business_report',
    patterns: [
      /\bgenerate\s+report\b/,
      /\bshow\s+report\b/,
      /\bbusiness\s+report\b/,
      /\bmonthly\s+report\b/,
      /\bsales\s+report\b/,
      /\brevenue\s+report\b/,
    ],
    response:  'Generating report.',
    actionKey: 'business:generate_report',
  },
  {
    intentType: 'business_follow_up',
    patterns: [
      /\bfollow.?up\b/,
      /\bremind\s+(?:me\s+)?(?:to\s+)?follow/,
      /\bchase\s+(?:up|client|payment)/,
    ],
    response:  'Setting follow-up reminder.',
    actionKey: 'business:follow_up',
  },
  {
    intentType: 'business_cancel',
    patterns: [
      /\bcancel\b/, /\bstop\b/, /\bnever mind\b/, /\bforget it\b/,
    ],
    response:  'Cancelled.',
    actionKey: 'business:cancel',
  },
];

// ── Entity extraction for business context ────────────────────────────────

function extractBusinessEntities(raw: string): BusinessIntentEntities {
  const entities: BusinessIntentEntities = {};

  // Amount: "₹5000", "5000 rupees", "$200"
  const amountMatch = raw.match(/[₹$]?\s*(\d[\d,]+)\s*(?:rupees?|rs\.?|dollars?)?/i);
  if (amountMatch) entities.amount = amountMatch[0].trim();

  // Client/contact name: "for Suresh", "to Acme Corp"
  const clientMatch = raw.match(/\b(?:for|to|from|client|with)\s+([A-Z][a-zA-Z\s]{1,30}?)(?:\s*$|\s+(?:on|at|by|due))/);
  if (clientMatch) entities.clientName = clientMatch[1].trim();

  // Date
  const dateMatch = raw.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+)\b/i);
  if (dateMatch) entities.date = dateMatch[1].toLowerCase();

  // Task title: text after "task:" or "task to"
  const taskMatch = raw.match(/\btask[:\s]+(.+?)(?:\s+(?:for|by|due|on|at)|$)/i);
  if (taskMatch) entities.taskTitle = taskMatch[1].trim();

  return entities;
}

// ── Telugu business keywords ──────────────────────────────────────────────

const TELUGU_BUSINESS_KEYWORDS: Record<string, BusinessIntentType> = {
  'invoice': 'business_invoice', 'bill create': 'business_invoice',
  'pani add': 'business_task',   'task pettu': 'business_task',
  'meeting schedule': 'business_meeting', 'call book': 'business_meeting',
  'expense log': 'business_expense', 'kharchu add': 'business_expense',
  'client add': 'business_contact',
  'report chupinchu': 'business_report',
};

function checkTeluguBusiness(lower: string): BusinessIntentType | null {
  for (const [phrase, type] of Object.entries(TELUGU_BUSINESS_KEYWORDS)) {
    if (lower.includes(phrase)) return type;
  }
  return null;
}

// ── Main business intent parser ───────────────────────────────────────────

/**
 * parseBusinessIntent(rawText, workspaceId?)
 *
 * Parses a voice command in the context of a business workspace.
 * ISOLATED: never called from personal dashboard.
 *
 * @param rawText     Raw transcript (wake word already stripped by caller)
 * @param workspaceId Optional workspace ID for multi-workspace support
 */
export function parseBusinessIntent(
  rawText: string,
  workspaceId?: string
): BusinessIntentResult {
  if (!rawText?.trim()) {
    return {
      handled: false, intentType: 'business_unknown',
      response: '', entities: {}, confidence: 0,
    };
  }

  const norm = normalise(rawText);

  // 1. Telugu business keywords (fast path)
  const teType = checkTeluguBusiness(norm);
  if (teType) {
    const pattern = BUSINESS_PATTERNS.find(p => p.intentType === teType);
    return {
      handled:    true,
      intentType: teType,
      response:   pattern?.response ?? 'Processing.',
      actionKey:  pattern?.actionKey,
      entities:   extractBusinessEntities(rawText),
      confidence: 0.75,
    };
  }

  // 2. English regex patterns (exact match)
  for (const bp of BUSINESS_PATTERNS) {
    if (bp.patterns.some(p => p.test(norm))) {
      return {
        handled:    true,
        intentType: bp.intentType,
        response:   bp.response,
        actionKey:  bp.actionKey,
        entities:   extractBusinessEntities(rawText),
        confidence: 1.0,
      };
    }
  }

  // 3. No match — not handled (caller saves as business keep)
  return {
    handled:    false,
    intentType: 'business_unknown',
    response:   '',
    entities:   extractBusinessEntities(rawText),
    confidence: 0,
  };
}

// ── Action executor helper ────────────────────────────────────────────────

/**
 * getBusinessAction(actionKey, ctx)
 *
 * Returns the navigation/action function for a business intent.
 * Shape mirrors getIntentAction() from voiceIntentEngine for consistency.
 */
export function getBusinessAction(
  actionKey: string | undefined,
  ctx: { router?: any }
): (() => void) | null {
  if (!actionKey) return null;
  const routeMap: Record<string, string> = {
    'business:create_invoice':    '/business/invoices/new',
    'business:create_task':       '/business/tasks/new',
    'business:schedule_meeting':  '/business/calendar/new',
    'business:log_expense':       '/business/expenses/new',
    'business:add_client':        '/business/clients/new',
    'business:generate_report':   '/business/reports',
    'business:follow_up':         '/business/follow-ups',
  };
  const path = routeMap[actionKey];
  if (path && ctx.router) {
    return () => setTimeout(() => ctx.router.push(path), 400);
  }
  return null;
}
