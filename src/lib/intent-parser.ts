export type IntentType =
  | 'task'
  | 'reminder'
  | 'note'
  | 'meeting'
  | 'purchase'
  | 'communication'
  | 'goal'
  | 'unknown'

export interface ParsedIntent {
  type: IntentType
  subject: string
  action: string
  confidence: number
  metadata: Record<string, unknown>
}

// ----- Keyword maps -----
const TYPE_PATTERNS: Array<{ type: IntentType; patterns: RegExp[] }> = [
  {
    type: 'reminder',
    patterns: [
      /\b(remind|reminder|don't forget|remember to|alert me|notify me)\b/i,
      /\b(tomorrow|later today|next week|in \d+ (hours?|days?|minutes?))\b/i,
    ],
  },
  {
    type: 'meeting',
    patterns: [
      /\b(meet|meeting|call|catch up|sync|standup|schedule a|book a|set up a)\b/i,
      /\b(conference|zoom|teams|google meet|video call)\b/i,
    ],
  },
  {
    type: 'purchase',
    patterns: [
      /\b(buy|purchase|order|shop|get me|pick up|add to cart)\b/i,
      /\b(amazon|flipkart|grocery|store|market)\b/i,
    ],
  },
  {
    type: 'communication',
    patterns: [
      /\b(email|send|message|text|reply|respond|write to|contact|reach out|call)\b/i,
      /\b(slack|whatsapp|dm|notify)\b/i,
    ],
  },
  {
    type: 'goal',
    patterns: [
      /\b(goal|target|plan to|want to|intend to|aim to|aspire|achieve|by end of)\b/i,
    ],
  },
  {
    type: 'note',
    patterns: [
      /\b(note|write down|record|log|jot|keep in mind|remember that)\b/i,
    ],
  },
  {
    type: 'task',
    patterns: [
      /\b(do|complete|finish|fix|update|create|build|review|check|follow up|submit|send|deploy|test)\b/i,
    ],
  },
]

// ----- Action verb extraction -----
const ACTION_VERBS = [
  'schedule', 'remind', 'buy', 'order', 'email', 'call', 'send', 'create',
  'build', 'fix', 'review', 'complete', 'finish', 'write', 'check', 'update',
  'deploy', 'test', 'research', 'read', 'watch', 'book', 'meet', 'follow up',
  'reply', 'respond', 'notify', 'message', 'contact', 'record', 'note',
]

function extractAction(text: string): string {
  const lower = text.toLowerCase()
  for (const verb of ACTION_VERBS) {
    if (lower.includes(verb)) return verb
  }
  const words = text.trim().split(/\s+/)
  return words[0]?.toLowerCase() ?? 'do'
}

// ----- Subject extraction -----
function extractSubject(text: string): string {
  // Remove filler words at the start
  const cleaned = text
    .replace(/^(i need to|i want to|i should|please|can you|remind me to|i have to|let me|make sure to)\s+/i, '')
    .trim()

  // Truncate long subjects
  return cleaned.length > 80 ? cleaned.slice(0, 77) + '…' : cleaned
}

// ----- Confidence scoring -----
function scoreConfidence(text: string, type: IntentType, matchCount: number): number {
  let score = 0.4

  // Base boost for match count
  score += Math.min(matchCount * 0.15, 0.3)

  // Length penalty for very short inputs
  const wordCount = text.trim().split(/\s+/).length
  if (wordCount < 3) score -= 0.15
  else if (wordCount >= 5) score += 0.1

  // Type known
  if (type !== 'unknown') score += 0.1

  // Cap between 0.1 and 0.98
  return Math.max(0.1, Math.min(0.98, score))
}

// ----- Main parser -----
export function parseIntent(text: string): ParsedIntent {
  let bestType: IntentType = 'unknown'
  let maxMatches = 0

  for (const { type, patterns } of TYPE_PATTERNS) {
    const matches = patterns.filter(p => p.test(text)).length
    if (matches > maxMatches) {
      maxMatches = matches
      bestType = type
    }
  }

  const action = extractAction(text)
  const subject = extractSubject(text)
  const confidence = scoreConfidence(text, bestType, maxMatches)

  // Extract temporal metadata
  const timeMatch = text.match(
    /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|in \d+ (?:hours?|days?|minutes?))\b/i
  )
  const metadata: Record<string, unknown> = {}
  if (timeMatch) metadata.time_ref = timeMatch[0].toLowerCase()

  return { type: bestType, subject, action, confidence, metadata }
}
