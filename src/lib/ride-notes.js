// src/lib/ride-notes.js
// TASK CARD AG-06: Ride notes on the Drive Mode screen (display only)
//
// In-memory notes of what the ride guard noticed:
// - overtake warnings
// - indicator reminders
// - fatigue level changes
// - hazard warnings
// - report-only anomaly notes
//
// Pure, injectable clock. Nothing is spoken, sent, uploaded or stored outside memory.
// Never includes coordinates or personal data.

export const ALLOWED_KINDS = new Set([
  'overtake',
  'indicator',
  'fatigue',
  'hazard_warning',
  'anomaly',
]);

/**
 * Sanitize text to ensure no numbers with 4+ decimal places (e.g. GPS coordinates)
 * leak into plain words notes.
 */
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/(\d+)\.(\d{4,})/g, (_m, intPart, decPart) => `${intPart}.${decPart.slice(0, 1)}`)
    .trim();
}

/**
 * Convert an anomaly kind code into plain words for the driver.
 */
function plainAnomalyKind(kind) {
  if (!kind || typeof kind !== 'string') return 'anomaly';
  const clean = kind.replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (clean === 'long unexpected stop') return 'unexpected stop';
  return clean || 'anomaly';
}

/**
 * Extract plain-words text for a state event and detail object.
 * Missing or odd detail never throws (returns a safe generic line).
 *
 * @param {string} kind
 * @param {any} detail
 * @returns {string}
 */
export function noteText(kind, detail) {
  try {
    const k = String(kind || '').trim().toLowerCase();

    if (k === 'overtake') {
      if (typeof detail === 'string' && detail.trim()) {
        return sanitizeText(detail);
      }
      const phrase = detail?.phrase || detail?.text || detail?.spoken || detail?.message;
      if (typeof phrase === 'string' && phrase.trim()) {
        return sanitizeText(phrase);
      }
      return 'Overtake warning';
    }

    if (k === 'indicator') {
      if (typeof detail === 'string' && detail.trim()) {
        return sanitizeText(detail);
      }
      const phrase = detail?.phrase || detail?.text || detail?.message;
      if (typeof phrase === 'string' && phrase.trim()) {
        return sanitizeText(phrase);
      }
      return 'Indicator reminder';
    }

    if (k === 'fatigue') {
      let level = null;
      if (typeof detail === 'string' && detail.trim()) {
        level = detail.trim();
      } else if (detail && typeof detail === 'object' && detail.level != null) {
        level = String(detail.level).trim();
      }
      if (level) {
        return sanitizeText(`Tiredness check: you sounded ${level}`);
      }
      return 'Tiredness check';
    }

    if (k === 'hazard_warning') {
      if (typeof detail === 'string' && detail.trim()) {
        return sanitizeText(detail);
      }
      const text = detail?.text || detail?.phrase || detail?.warning || detail?.message;
      if (typeof text === 'string' && text.trim()) {
        return sanitizeText(text);
      }
      return 'Hazard warning ahead';
    }

    if (k === 'anomaly') {
      let anomalyKind = 'anomaly';
      let level = null;
      if (typeof detail === 'string' && detail.trim()) {
        anomalyKind = plainAnomalyKind(detail);
      } else if (detail && typeof detail === 'object') {
        if (detail.kind != null) {
          anomalyKind = plainAnomalyKind(String(detail.kind));
        } else if (detail.type != null) {
          anomalyKind = plainAnomalyKind(String(detail.type));
        }
        if (detail.level != null) {
          level = String(detail.level).trim();
        }
      }
      if (level) {
        return sanitizeText(`Noted (not reported to anyone): ${anomalyKind} — ${level}`);
      }
      return sanitizeText(`Noted (not reported to anyone): ${anomalyKind}`);
    }

    // Generic fallback for any other kind
    const genericText = (detail && typeof detail === 'object')
      ? (detail.text || detail.phrase || detail.message)
      : (typeof detail === 'string' ? detail : null);
    if (typeof genericText === 'string' && genericText.trim()) {
      return sanitizeText(genericText);
    }
    return 'Note';
  } catch {
    return 'Note';
  }
}

/**
 * Pure factory for in-memory ride notes collection.
 * Keeps only the five supported kinds, stores newest first, up to max items.
 *
 * @param {object} [options]
 * @param {number} [options.max=20]
 * @param {(() => number)|{now: () => number}} [options.clock]
 */
export function createRideNotes({ max = 20, clock } = {}) {
  const getTime = typeof clock === 'function'
    ? clock
    : (clock && typeof clock.now === 'function' ? () => clock.now() : () => Date.now());
  const maxItems = typeof max === 'number' && max > 0 ? max : 20;

  let items = [];

  function add(state, detail) {
    if (!state || typeof state !== 'string') return null;
    const kind = state.trim().toLowerCase();
    if (!ALLOWED_KINDS.has(kind)) {
      return null;
    }

    const text = noteText(kind, detail);
    const entry = {
      kind,
      at: getTime(),
      text,
    };

    items.unshift(entry);
    if (items.length > maxItems) {
      items.length = maxItems;
    }
    return entry;
  }

  function list() {
    return [...items];
  }

  function clear() {
    items = [];
  }

  return {
    add,
    list,
    clear,
  };
}
