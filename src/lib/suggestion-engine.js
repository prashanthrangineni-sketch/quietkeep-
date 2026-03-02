export function generateSuggestions(intent) {
  const suggestions = []

  if (intent.intent_type === 'task') {
    suggestions.push('Add to task list')
    suggestions.push('Schedule for later')
    suggestions.push('Set as priority')
  } else if (intent.intent_type === 'reminder') {
    suggestions.push('Set reminder for tomorrow')
    suggestions.push('Repeat daily')
    suggestions.push('Add to calendar')
  } else if (intent.intent_type === 'meeting') {
    suggestions.push('Send meeting invite')
    suggestions.push('Add attendees')
    suggestions.push('Schedule video call')
  } else if (intent.intent_type === 'purchase') {
    suggestions.push('Add to shopping list')
    suggestions.push('Find best price')
    suggestions.push('Set price alert')
  } else if (intent.intent_type === 'communication') {
    suggestions.push('Send email')
    suggestions.push('Schedule call')
    suggestions.push('Draft message')
  } else {
    suggestions.push('Create note')
    suggestions.push('Save for later')
  }

  return suggestions.slice(0, 3)
}
