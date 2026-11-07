// src/lib/tasks100-guided.js
// Guided 100-Task Run Helper (Card AG-V5)
//
// Manages:
// 1. Static 100-task list loading & normalization
// 2. Sequential navigation: next, skip, back, resume
// 3. Contact name substitution into task utterances
// 4. Local storage state persistence (phone-only, zero network calls)
// 5. Progress tracking and run completion summary

import tasksData from '../data/tasks100.json' with { type: 'json' };

export const GUIDED_INDEX_KEY = 'qk_tasks100_guided_index';
export const GUIDED_CONTACTS_KEY = 'qk_tasks100_guided_contacts';
export const GUIDED_ACTIVE_KEY = 'qk_tasks100_guided_active';

/**
 * Standard person names used across the 100 tasks.
 * Founder can configure exact names saved in his phone contacts (e.g. Mom -> Amma).
 */
export const STANDARD_CONTACT_KEYS = Object.freeze([
  { key: 'Mom', label: 'Mom', defaultVal: 'Mom', aliases: ['mom', 'Mom', 'అమ్మ'] },
  { key: 'Surya Kiran', label: 'Surya Kiran', defaultVal: 'Surya Kiran', aliases: ['Surya Kiran', 'సూర్య కిరణ్'] },
  { key: 'Venu', label: 'Venu', defaultVal: 'Venu', aliases: ['Venu', 'వేణు'] },
  { key: 'Gautam', label: 'Gautam', defaultVal: 'Gautam', aliases: ['Gautam', 'गौतम'] },
  { key: 'Akhilesh', label: 'Akhilesh', defaultVal: 'Akhilesh', aliases: ['Akhilesh'] },
  { key: 'Ravi', label: 'Ravi', defaultVal: 'Ravi', aliases: ['Ravi', 'రవి'] },
]);

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the array of 100 evaluation tasks.
 */
export function getTasksList(source = tasksData) {
  if (Array.isArray(source)) return source;
  if (source && Array.isArray(source.tasks)) return source.tasks;
  return [];
}

/**
 * Substitute configured contact names into the task text shown.
 * Defaults stay as in the task list until set.
 *
 * @param {string} text - The original task utterance (e.g. "call mom")
 * @param {object} contactMap - Key-value map of substitutions (e.g. { Mom: "Amma" })
 * @returns {string} The text with substituted names
 */
export function substituteContactNames(text, contactMap = {}) {
  if (!text || typeof text !== 'string') return text || '';
  if (!contactMap || typeof contactMap !== 'object') return text;

  let result = text;

  // 1. Process standard contact keys
  for (const item of STANDARD_CONTACT_KEYS) {
    // Check if custom name is provided for this key (case-insensitive lookup)
    const userVal = contactMap[item.key] ?? contactMap[item.key.toLowerCase()];
    if (userVal && typeof userVal === 'string') {
      const replacement = userVal.trim();
      // Only substitute if non-empty and different from default
      if (replacement && replacement !== item.defaultVal) {
        for (const alias of item.aliases) {
          if (alias.toLowerCase() === 'mom') {
            // Word boundary match for English 'mom' / 'Mom'
            result = result.replace(/\bmom\b/gi, replacement);
          } else {
            // Exact substring replace for multi-word or non-Latin script names
            result = result.replaceAll(alias, replacement);
          }
        }
      }
    }
  }

  // 2. Process any additional custom key-value pairs
  const standardKeySet = new Set(STANDARD_CONTACT_KEYS.map((k) => k.key.toLowerCase()));
  for (const [rawKey, rawVal] of Object.entries(contactMap)) {
    const key = String(rawKey || '').trim();
    const val = String(rawVal || '').trim();
    if (!key || !val || standardKeySet.has(key.toLowerCase())) continue;
    if (key !== val) {
      const re = new RegExp(`\\b${escapeRegExp(key)}\\b`, 'gi');
      result = result.replace(re, val);
    }
  }

  return result;
}

/**
 * Get saved progress index from localStorage (0-indexed).
 * Clamped between 0 and totalTasks.
 */
export function getSavedIndex(totalTasks = 100) {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  try {
    const raw = window.localStorage.getItem(GUIDED_INDEX_KEY);
    if (raw !== null) {
      const num = parseInt(raw, 10);
      if (!Number.isNaN(num) && num >= 0) {
        return Math.min(num, totalTasks);
      }
    }
  } catch {}
  return 0;
}

/**
 * Save progress index to localStorage.
 */
export function saveIndex(index) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(GUIDED_INDEX_KEY, String(Math.max(0, index)));
  } catch {}
}

/**
 * Clear saved progress index from localStorage.
 */
export function clearSavedIndex() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(GUIDED_INDEX_KEY);
  } catch {}
}

/**
 * Get saved contact mapping from localStorage.
 */
export function getSavedContacts() {
  const defaults = {};
  for (const item of STANDARD_CONTACT_KEYS) {
    defaults[item.key] = item.defaultVal;
  }

  if (typeof window === 'undefined' || !window.localStorage) return defaults;
  try {
    const raw = window.localStorage.getItem(GUIDED_CONTACTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...defaults, ...parsed };
      }
    }
  } catch {}
  return defaults;
}

/**
 * Save contact mapping to localStorage.
 */
export function saveContacts(contactsMap) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(GUIDED_CONTACTS_KEY, JSON.stringify(contactsMap || {}));
  } catch {}
}

/**
 * Calculate next index.
 */
export function getNextIndex(currentIndex, totalTasks) {
  return Math.min(currentIndex + 1, totalTasks);
}

/**
 * Calculate previous index.
 */
export function getPrevIndex(currentIndex) {
  return Math.max(currentIndex - 1, 0);
}

/**
 * Calculate skip index.
 */
export function getSkipIndex(currentIndex, totalTasks) {
  return Math.min(currentIndex + 1, totalTasks);
}

/**
 * Returns formatted progress label (e.g. "Task 37 of 100").
 */
export function formatProgress(index, totalTasks = 100) {
  if (index >= totalTasks) {
    return `Complete (${totalTasks} of ${totalTasks})`;
  }
  return `Task ${index + 1} of ${totalTasks}`;
}

/**
 * Compute summary of 100-task evaluation run.
 */
export function computeRunSummary(tasks, steps = []) {
  const tasksList = getTasksList(tasks);
  const totalTasks = tasksList.length;

  const recordedTaskIds = new Set();
  const stepCountsByTaskId = {};

  for (const s of steps) {
    if (s && s.task_id) {
      recordedTaskIds.add(s.task_id);
      stepCountsByTaskId[s.task_id] = (stepCountsByTaskId[s.task_id] || 0) + 1;
    }
  }

  let measuredTasksCount = 0;
  const unmeasuredTaskIds = [];

  for (const t of tasksList) {
    if (recordedTaskIds.has(t.id)) {
      measuredTasksCount++;
    } else {
      unmeasuredTaskIds.push(t.id);
    }
  }

  return {
    totalTasks,
    measuredCount: measuredTasksCount,
    unmeasuredCount: totalTasks - measuredTasksCount,
    totalSteps: steps.length,
    recordedTaskIds: Array.from(recordedTaskIds),
    unmeasuredTaskIds,
    stepCountsByTaskId,
    isComplete: measuredTasksCount === totalTasks,
  };
}
