// src/lib/step-log.js
//
// 100-TASK STEP LOG RECORDER (Plan item 1, AG-AARIA-37)
// Records execution steps during the 100-task phone evaluation into an on-device
// JSON-lines log. Off by default for all users.
//
// Schema defined in PranixQuick/pranix-aaria docs/TASKS100_RECORDER.md:
//   task_id, step, heard_text, decided_action, action_level, asked_confirmation, result, timestamps{start,end}
//
// HARD RULES:
//   - Default behaviour unchanged: log is OFF unless explicit run is active.
//   - On-device log only (localStorage on web/phone; nothing sent to any server).
//   - heard_text = transcribed text only. NEVER store raw audio or tokens.
//   - action_level MUST be one of the real levels from src/lib/action-levels,js.

import { LEVEL, levelFor, DECISION} from './action-levels.js';

export const RUN_SETTING_KEY = 'qk_tasks100_run';
export const STEPS_STORAGE_KEY = 'qk_tasks100_steps';

export const VALID_LEVELS = Object.freeze(new Set(Object.values(LEVEL)));

export const REQUIRED_FIELDS = Object.freeze([
  'task_id',
  'step',
  'heard_text',
  'decided_action',
  'action_level',
  'asked_confirmation',
  'result',
  'timestamps',
]);

// In-memory steps for Node / server / test environments
let _memorySteps = [];
let _activeRunOverride = null;

/**
 * Check if a 100-task run is active and return its config { task_id }, or null.
 */
export function getActiveRun() {
  if (_activeRunOverride && _activeRunOverride.task_id) {
    return _activeRunOverride;
  }

  // Web / Phone localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(RUN_SETTING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.task_id) {
          return { task_id: String(parsed.task_id).trim() };
        }
        if (typeof parsed === 'string' && parsed.trim()) {
          return { task_id: parsed.trim() };
        }
      }
    } catch {}
  }

  // Test / Node environment flag
  if (typeof process !== 'undefined' && process.env && process.env.QK_TASKS100_RUN) {
    const raw = process.env.QK_TASKS100_RUN.trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.task_id) {
        return { task_id: String(parsed.task_id).trim() };
      }
    } catch {}
    if (raw) {
      return { task_id: raw };
    }
  }

  return null;
}

/**
 * Returns true if a 100-task run is currently active.
 */
export function isRunActive() {
  return getActiveRun() !== null;
}

/**
 * Start a 100-task run with the given task ID.
 * @param {string} taskID
 */
export function startRun(taskId) {
  const tid = String(taskId || '').trim();
  if (!tid) return null;
  const runObj = { task_id: tid };
  _activeRunOverride = runObj;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(RUN_SETTING_KEY, JSON.stringify(runObj));
    } catch {}
  }
  return runObj;
}

/**
 * Stop any currently active 100-task run.
 */
export function stopRun() {
  _activeRunOverride = null;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(RUN_SETTING_KEY);
    } catch {}
  }
}

/**
 * Get all steps recorded so far.
 * @returns {Array<object>}
 */
export function getSteps() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(STEPS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  }
  return [..._memorySteps];
}

/**
 * Save steps to local storage or in-memory.
 * @param {Array<object>} steps
 */
function saveSteps(steps) {
  _memorySteps = [...steps];
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STEPS_STORAGE_KEY, JSON.stringify(steps));
    } catch {}
  }
}

/**
 * Clear all recorded steps.
 */
export function clearSteps() {
  _memorySteps = [];
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STEPS_STORAGE_KEY);
    } catch {}
  }
}

/**
 * Export recorded steps as valid JSON-lines text.
 * Each line is a single JSON object with exactly the 8 specification fields.
 * @returns {string}
 */
export function exportSteps() {
  const steps = getSteps();
  if (!steps.length) return '';
  return steps.map((s) => JSON.stringify(s)).join('\n') + '\n';
}

/**
 * Record one step in the active run.
 *
 * @param {object| params
 *   heard_text / heardText       the transcribed text only (NEVER raw audio)
 *   decided_action / decidedAction the decided action type
 *   level / action_level         the level from decide() / levelFor()
 *   decision                     decision from decide() ('do', 'ask_yes', etc.)
 *   asked_confirmation           explicit boolean, or inferred from decision
 *   result                      result string ('success', 'pending_confirmation', 'refused', etc.)
 *   startTime / endTime          optional ISO timestamps or Date objects
 *   run                          optional run object override { task_id }
 * @returns {object|null} The recorded step object, or null if no run is active
 */
export function recordStep(params = {}) {
  const activeRun = params.run || (params.task_id ? { task_id: params.task_id } : getActiveRun());
  if (!activeRun || !activeRun.task_id) {
    return null; // OFF by default: do nothing when no run is active
  }

  const taskId = String(activeRun.task_id).trim();
  const existingSteps = getSteps();

  // 1-indexed step count for this task_id
  const priorTaskSteps = existingSteps.filter((s) => s.task_id === taskId);
  const stepNumber = (typeof params.step === 'number' && params.step > 0)
    ? params.step
    : (priorTaskSteps.length + 1);

  // heard_text: transcribed text only
  const heardText = String(params.heard_text || params.heardText || '').trim();

  // decided_action
  const decidedAction = String(
    params.decided_action || params.decidedAction || params.type || 'unknown'
  ).trim();

  // action_level: MUST be one of the real levels from src/lib/action-levels.js
  let actionLevel = params.action_level || params.level;
  if (!actionLevel || !VALID_LEVELS.has(actionLevel)) {
    actionLevel = levelFor({ type: decidedAction });
  }
  if (!VALID_LEVELS.has(actionLevel)) {
    actionLevel = LEVEL.NO_ACTION;
  }

  // asked_confirmation: boolean
  let askedConfirmation = false;
  if (params.asked_confirmation !== undefined) {
    askedConfirmation = Boolean(params.asked_confirmation);
  } else if (params.askedConfirmation !== undefined) {
    askedConfirmation = Boolean(params.askedConfirmation);
  } else if (params.decision) {
    askedConfirmation = [
      DECISION.ASK_YES,
      DECISION.ASK_UNLOCK,
      DECISION.ASK_PIN,
    ].includes(params.decision);
  }

  // result: string
  let result = params.result;
  if (!result) {
    if (params.decision === DECISION.DO) {
      result = 'success';
    } else if (
      [DECISION.ASK_YES, DECISION.ASK_UNLOCK, DECISION.ASK_PIN].includes(
        params.decision
      )
    ) {
      result = 'pending_confirmation';
    } else if (params.decision === DECISION.REFUSE) {
      result = 'refused';
    } else {
      result = 'success';
    }
  }

  // timestamps: { start, end }
  const nowISO = new Date().toISOString();
  let startISO = nowISO;
  let endISO = nowISO;
  if (params.timestamps && typeof params.timestamps === 'object') {
    startISO = params.timestamps.start || nowISO;
    endISO = params.timestamps.end || nowISO;
  } else {
    if (params.startTime) {
      startISO =
        params.startTime instanceof Date
          ? params.startTime.toISOString()
          : String(params.startTime);
    }
    if (params.endTime) {
      endISO =
        params.endTime instanceof Date
          ? params.endTime.toISOString()
          : String(params.endTime);
    }
  }

  // Canonical object containing EXACTLY the 8 specification fields
  const stepObj = {
    task_id: taskId,
    step: stepNumber,
    heard_text: heardText,
    decided_action: decidedAction,
    action_level: actionLevel,
    asked_confirmation: askedConfirmation,
    result: String(result),
    timestamps: {
      start: startISO,
      end: endISO,
    },
  };

  // persist:false = build the step but do not store it here (server side).
  // The phone stores it after the reply arrives, so nothing is kept on the server.
  if (params.persist !== false) {
    existingSteps.push(stepObj);
    saveSteps(existingSteps);
  }

  return stepObj;
}
