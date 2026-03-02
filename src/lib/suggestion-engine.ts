import type { Intent } from '@/components/IntentCard'

type IntentType = 'task' | 'reminder' | 'note' | 'meeting' | 'purchase' | 'communication' | 'goal' | 'unknown'

// Templates per intent type — Tier 1 (rule-based, no external API needed)
const TEMPLATES: Record<IntentType, (intent: Intent) => string[]> = {
  task: (i) => [
    `Create a task: "${i.subject}"`,
    `Add "${i.subject}" to your to-do list with today's date`,
    `Break "${i.subject}" into smaller subtasks and schedule each`,
    `Set a deadline for "${i.subject}" and block time in your calendar`,
  ],
  reminder: (i) => {
    const timeRef = (i as unknown as { metadata?: { time_ref?: string } }).metadata?.time_ref
    return [
      `Set a reminder: "${i.subject}"${timeRef ? ` — ${timeRef}` : ''}`,
      `Add "${i.subject}" to your calendar as a reminder`,
      `Pin "${i.subject}" and set a notification alert`,
    ]
  },
  note: (i) => [
    `Save note: "${i.subject}"`,
    `Add "${i.subject}" to your notes and tag it for later reference`,
    `Archive this thought: "${i.subject}"`,
  ],
  meeting: (i) => [
    `Schedule a meeting: "${i.subject}"`,
    `Send a calendar invite for "${i.subject}" with agenda`,
    `Block 30 minutes on your calendar for "${i.subject}"`,
    `Create a meeting link and share with participants for "${i.subject}"`,
  ],
  purchase: (i) => [
    `Add to shopping list: "${i.subject}"`,
    `Search and compare prices for "${i.subject}"`,
    `Save "${i.subject}" to your wishlist for later`,
  ],
  communication: (i) => [
    `Draft a message: "${i.subject}"`,
    `Send a quick note about "${i.subject}"`,
    `Schedule a follow-up for "${i.subject}"`,
    `Create an email draft for "${i.subject}"`,
  ],
  goal: (i) => [
    `Add goal: "${i.subject}"`,
    `Break down "${i.subject}" into weekly milestones`,
    `Track progress on "${i.subject}" with a checklist`,
    `Set a review date for goal: "${i.subject}"`,
  ],
  unknown: (i) => [
    `Log this intention: "${i.subject}"`,
    `Review and clarify: "${i.subject}"`,
    `Assign a category to "${i.subject}" for better tracking`,
  ],
}

// Confidence-based filtering
function filterByConfidence(suggestions: string[], confidence: number): string[] {
  // High confidence: offer all suggestions
  if (confidence >= 0.8) return suggestions.slice(0, 4)
  // Medium: top 3
  if (confidence >= 0.6) return suggestions.slice(0, 3)
  // Low: top 2, prepend a clarification suggestion
  return [
    `Clarify and rephrase: "${suggestions[0]}"`,
    ...suggestions.slice(0, 2),
  ]
}

export function generateSuggestions(intent: Intent): string[] {
  const type = (intent.intent_type as IntentType) ?? 'unknown'
  const templateFn = TEMPLATES[type] ?? TEMPLATES.unknown
  const raw = templateFn(intent)
  return filterByConfidence(raw, intent.confidence)
}
