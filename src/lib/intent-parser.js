export function parseIntent(text) {
  const lower = text.toLowerCase()
  
  let intentType = 'unknown'
  let action = 'process'
  let subject = text.slice(0, 50)

  if (lower.includes('remind') || lower.includes('remember')) {
    intentType = 'reminder'
    action = 'remind'
  } else if (lower.includes('meet') || lower.includes('meeting') || lower.includes('call')) {
    intentType = 'meeting'
    action = 'schedule'
  } else if (lower.includes('buy') || lower.includes('purchase') || lower.includes('shop')) {
    intentType = 'purchase'
    action = 'buy'
  } else if (lower.includes('task') || lower.includes('todo') || lower.includes('do')) {
    intentType = 'task'
    action = 'execute'
  } else if (lower.includes('tell') || lower.includes('message') || lower.includes('email')) {
    intentType = 'communication'
    action = 'communicate'
  } else if (lower.includes('note') || lower.includes('remember')) {
    intentType = 'note'
    action = 'document'
  }

  const confidence = Math.min(0.95, 0.6 + (text.length / 100))

  return {
    type: intentType,
    subject,
    action,
    confidence,
    metadata: { length: text.length, wordCount: text.split(' ').length },
  }
}
