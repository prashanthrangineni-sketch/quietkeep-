// src/lib/keep-dedup.js
// Guard against duplicate keep insertions (same user + same text + same time within 60 s = one keep).

export function isDuplicateKeep({
  userId,
  text,
  reminderAt = null,
  recentKeeps = [],
  windowMs = 60000,
  now = Date.now(),
}) {
  if (!userId || !text || !Array.isArray(recentKeeps)) return null;

  const normalizedInput = String(text).trim().toLowerCase();

  for (const k of recentKeeps) {
    if (k.user_id && k.user_id !== userId) continue;

    // Check age of recent keep
    const createdAt = k.created_at ? new Date(k.created_at).getTime() : 0;
    if (createdAt && (now - createdAt > windowMs || createdAt - now > windowMs)) {
      continue;
    }

    const voiceText = String(k.voice_text || '').trim().toLowerCase();
    const content = String(k.content || '').trim().toLowerCase();

    const textMatches = voiceText === normalizedInput || content === normalizedInput;
    if (!textMatches) continue;

    // If both have reminder times, check if they are for the same instant within 60s
    if (reminderAt && k.reminder_at) {
      const r1 = new Date(reminderAt).getTime();
      const r2 = new Date(k.reminder_at).getTime();
      if (!isNaN(r1) && !isNaN(r2) && Math.abs(r1 - r2) > 60000) {
        continue;
      }
    }

    return k;
  }

  return null;
}
