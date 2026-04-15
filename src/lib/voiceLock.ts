/**
 * src/lib/voiceLock.ts  —  Step 3: Global Voice Lock
 *
 * Prevents parallel voice execution across:
 *   - Manual mic tap (startVoice)
 *   - Wake word trigger (lotus_wake event)
 *   - Always-on VoiceService callbacks
 *
 * SAFE: Module-level singleton. Pure JS, no React, no Capacitor.
 * Does NOT break existing `listening` state — it is a GUARD that
 * callers check BEFORE starting any voice session.
 *
 * Usage in dashboard:
 *   import { acquireVoiceLock, releaseVoiceLock, isVoiceLocked } from '@/lib/voiceLock';
 *
 *   function startVoice() {
 *     if (!acquireVoiceLock('manual')) return;  // already busy
 *     // ... start recognition
 *   }
 *   function stopVoice() {
 *     recognitionRef.current?.stop();
 *     setListening(false);
 *     releaseVoiceLock();
 *   }
 *
 *   // lotus_wake handler:
 *   function onLotusWake(e) {
 *     if (isVoiceLocked()) {
 *       console.log('[QK] lotus_wake ignored — voice already active');
 *       return;
 *     }
 *     startVoice();
 *   }
 */

export type VoiceLockSource = 'manual' | 'wake' | 'always_on';

interface VoiceLockState {
  locked:    boolean;
  source:    VoiceLockSource | null;
  acquiredAt: number;
}

// ── Module singleton ──────────────────────────────────────────────────────

const _state: VoiceLockState = { locked: false, source: null, acquiredAt: 0 };

/** Maximum time a lock is held before auto-expiry (30s — guards against hung sessions) */
const LOCK_TIMEOUT_MS = 30_000;

// ── API ───────────────────────────────────────────────────────────────────

/**
 * isVoiceLocked() — true if voice is currently active from any source.
 * Expired locks (> 30s) are auto-released.
 */
export function isVoiceLocked(): boolean {
  if (!_state.locked) return false;
  // Auto-expire stale locks
  if (Date.now() - _state.acquiredAt > LOCK_TIMEOUT_MS) {
    releaseVoiceLock();
    return false;
  }
  return true;
}

/**
 * acquireVoiceLock(source) → boolean
 *
 * Returns true if the lock was acquired.
 * Returns false if already locked by a different source (caller should abort).
 * Same source can re-acquire (idempotent — prevents double-lock from re-renders).
 */
export function acquireVoiceLock(source: VoiceLockSource): boolean {
  if (isVoiceLocked()) {
    if (_state.source === source) return true;   // same source — idempotent
    console.log(`[QK VoiceLock] BLOCKED: ${source} tried while ${_state.source} is active`);
    return false;
  }
  _state.locked     = true;
  _state.source     = source;
  _state.acquiredAt = Date.now();
  console.log(`[QK VoiceLock] acquired by: ${source}`);
  return true;
}

/**
 * releaseVoiceLock()
 *
 * Releases the lock. Always safe to call — no-op if not locked.
 */
export function releaseVoiceLock(): void {
  if (_state.locked) {
    console.log(`[QK VoiceLock] released (was: ${_state.source})`);
  }
  _state.locked     = false;
  _state.source     = null;
  _state.acquiredAt = 0;
}

/** getCurrentLockSource() — for diagnostics */
export function getCurrentLockSource(): VoiceLockSource | null {
  return isVoiceLocked() ? _state.source : null;
}
