/**
 * src/lib/offlineVoice.ts
 *
 * BLOCK 5: Offline Voice Fallback
 *
 * When network is unavailable, voice commands are processed locally:
 *   - Navigation commands ("open dashboard", "show reminders")
 *   - Simple note creation (queued for sync when online)
 *   - Status queries ("what time is it", "how many keeps")
 *
 * HOW IT WORKS:
 * 1. VoiceCapture.jsx calls orchestrate() → which calls /api/voice/capture
 * 2. If that fails with network error, orchestrate() calls processOffline() here
 * 3. processOffline() matches against local command patterns
 * 4. Navigation commands fire immediately via router
 * 5. Create commands queue to localStorage for sync on reconnect
 * 6. On reconnect (online event), flushOfflineQueue() syncs to /api/voice/capture
 *
 * COMMANDS SUPPORTED OFFLINE:
 *   "open [section]"       → navigate to section
 *   "note [text]"          → queue keep for sync
 *   "remind me [text]"     → queue reminder for sync
 *   "what time is it"      → read current time via TTS
 *   "how many keeps"       → count from localStorage cache
 */

export interface OfflineResult {
  handled:    boolean;
  action:     string;
  message?:   string;  // TTS response
  navigate?:  string;  // path to navigate to
  queued?:    boolean; // was queued for later sync
}

interface QueuedCommand {
  id:          string;
  text:        string;
  source:      string;
  created_at:  string;
  attempts:    number;
}

const QUEUE_KEY = 'qk_offline_queue';
const CACHE_KEY = 'qk_keep_count';

// ── Navigation patterns ──────────────────────────────────────────────────────
const NAV_ROUTES: Array<{ patterns: RegExp[]; path: string; label: string }> = [
  { patterns: [/\b(home|dashboard|main)\b/i],              path: '/dashboard',    label: 'dashboard' },
  { patterns: [/\breminder[s]?\b/i],                       path: '/reminders',    label: 'reminders' },
  { patterns: [/\bcalendar\b/i],                           path: '/calendar',     label: 'calendar' },
  { patterns: [/\bbrief\b|\bdaily\b/i],                    path: '/daily-brief',  label: 'daily brief' },
  { patterns: [/\bfinance\b|\bexpense[s]?\b|\bmoney\b/i],  path: '/finance',      label: 'finance' },
  { patterns: [/\btrip[s]?\b|\btravel\b/i],                path: '/trips',        label: 'trips' },
  { patterns: [/\bdocument[s]?\b/i],                       path: '/documents',    label: 'documents' },
  { patterns: [/\bhealth\b/i],                             path: '/health',       label: 'health' },
  { patterns: [/\bfamily\b/i],                             path: '/family',       label: 'family' },
  { patterns: [/\bmemor(y|ies)\b/i],                       path: '/memories',     label: 'memories' },
  { patterns: [/\bchat\b|\bmessage[s]?\b/i],               path: '/b/chat',       label: 'chat' },
  { patterns: [/\bsetting[s]?\b/i],                        path: '/settings',     label: 'settings' },
  { patterns: [/\bgeo\b|\blocation\b/i],                   path: '/geo',          label: 'location' },
  { patterns: [/\bwarrant(y|ies)\b/i],                     path: '/warranty',     label: 'warranty' },
  { patterns: [/\bnews\b/i],                               path: '/news',         label: 'news' },
  { patterns: [/\bmore\b/i],                               path: '/more',         label: 'more' },
];

// ── Create patterns (queued for sync) ────────────────────────────────────────
const CREATE_PATTERNS: Array<{ pattern: RegExp; intentType: string }> = [
  { pattern: /^(?:note|remember|save)[:\s]+(.+)/i,           intentType: 'note'     },
  { pattern: /^(?:remind me|reminder)[:\s]+(.+)/i,           intentType: 'reminder' },
  { pattern: /^(?:task|todo|add task)[:\s]+(.+)/i,           intentType: 'task'     },
  { pattern: /^(?:buy|purchase|shopping)[:\s]+(.+)/i,        intentType: 'purchase' },
  { pattern: /^(?:call|contact|ring)[:\s]+(.+)/i,            intentType: 'contact'  },
];

// ── Query patterns (local response) ──────────────────────────────────────────
type QueryHandler = (text: string) => string;
const QUERY_PATTERNS: Array<{ pattern: RegExp; handler: QueryHandler }> = [
  {
    pattern: /what(?:'s| is) the time|current time/i,
    handler: () => {
      const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      return `The time is ${t}`;
    },
  },
  {
    pattern: /what(?:'s| is) today(?:'s| the) date|today's date/i,
    handler: () => {
      const d = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
      return `Today is ${d}`;
    },
  },
  {
    pattern: /how many keeps|number of keeps/i,
    handler: () => {
      if (typeof localStorage === 'undefined') return 'Cannot count keeps offline';
      const count = parseInt(localStorage.getItem(CACHE_KEY) || '0', 10);
      return `You have ${count} keeps saved`;
    },
  },
  {
    pattern: /are you online|network|connection/i,
    handler: () => {
      const online = typeof navigator !== 'undefined' && navigator.onLine;
      return online ? 'Network is available' : 'You are offline. Commands will sync when reconnected.';
    },
  },
];

/**
 * Process a voice command offline.
 * Returns { handled: true, ... } if command was handled locally.
 * Returns { handled: false } if should fall through to network call.
 */
export function processOffline(text: string): OfflineResult {
  const clean = text.trim().toLowerCase();

  // 1. Navigation: "open [section]" or just section name
  const isNav = /^(?:open|go to|show|navigate to|take me to)\s+/i.test(clean) ||
                NAV_ROUTES.some(r => r.patterns.some(p => p.test(clean)));

  if (isNav) {
    for (const route of NAV_ROUTES) {
      if (route.patterns.some(p => p.test(clean))) {
        return {
          handled:  true,
          action:   'navigate',
          navigate: route.path,
          message:  `Opening ${route.label}`,
        };
      }
    }
  }

  // 2. Query commands (answer locally)
  for (const q of QUERY_PATTERNS) {
    if (q.pattern.test(clean)) {
      return {
        handled: true,
        action:  'query',
        message: q.handler(clean),
      };
    }
  }

  // 3. Create commands (queue for sync)
  for (const cp of CREATE_PATTERNS) {
    const match = text.match(cp.pattern);
    if (match) {
      const content = match[1]?.trim();
      if (content) {
        _queueCommand(content, cp.intentType);
        return {
          handled: true,
          action:  'queued',
          queued:  true,
          message: `Saved offline. Will sync when connected.`,
        };
      }
    }
  }

  // 4. Generic: any input gets queued as a note
  if (clean.length > 5) {
    _queueCommand(text, 'note');
    return {
      handled: true,
      action:  'queued',
      queued:  true,
      message: 'Saved offline. Will sync when reconnected.',
    };
  }

  return { handled: false, action: 'noop' };
}

// ── Queue helpers ─────────────────────────────────────────────────────────────

function _queueCommand(text: string, intentType: string): void {
  if (typeof localStorage === 'undefined') return;
  const queue: QueuedCommand[] = _getQueue();
  queue.push({
    id:         `offline_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    text:       `[${intentType}] ${text}`,
    source:     'offline_voice',
    created_at: new Date().toISOString(),
    attempts:   0,
  });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-50))); // max 50 offline commands
}

function _getQueue(): QueuedCommand[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch { return []; }
}

/**
 * Flush offline queue to the server.
 * Call this when the online event fires or on app resume.
 * token: current Supabase access token
 */
export async function flushOfflineQueue(token: string): Promise<number> {
  if (!token) return 0;
  const queue = _getQueue();
  if (!queue.length) return 0;

  let synced = 0;
  const remaining: QueuedCommand[] = [];

  for (const cmd of queue) {
    try {
      const res = await fetch('/api/voice/capture', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          transcript:  cmd.text,
          source:      cmd.source,
          language:    'en-IN',
          offline_id:  cmd.id,
          created_at:  cmd.created_at,
        }),
      });

      if (res.ok) {
        synced++;
      } else if (res.status >= 500) {
        // Server error — retry later
        remaining.push({ ...cmd, attempts: cmd.attempts + 1 });
      }
      // 4xx → discard (bad request, auth issue)
    } catch {
      // Network still down — keep for later
      remaining.push({ ...cmd, attempts: cmd.attempts + 1 });
    }
  }

  if (remaining.length > 0) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  } else {
    localStorage.removeItem(QUEUE_KEY);
  }

  return synced;
}

/**
 * Get count of pending offline commands.
 */
export function getOfflineQueueCount(): number {
  return _getQueue().length;
}

/**
 * Register online/offline event listeners.
 * Call once from layout or dashboard.
 * Returns cleanup function.
 */
export function registerConnectivityHandlers(
  token: string,
  onSync?: (count: number) => void,
  onOffline?: () => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleOnline = async () => {
    const synced = await flushOfflineQueue(token);
    if (synced > 0) onSync?.(synced);
  };

  const handleOffline = () => {
    onOffline?.();
  };

  window.addEventListener('online',  handleOnline);
  window.addEventListener('offline', handleOffline);

  // Flush on register if already online and queue is non-empty
  if (navigator.onLine && getOfflineQueueCount() > 0) {
    handleOnline();
  }

  return () => {
    window.removeEventListener('online',  handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
