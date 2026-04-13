/**
 * src/lib/orchestrator.ts
 *
 * BLOCK 6: Central AI Orchestration Layer
 *
 * The unified intelligence coordinator for QuietKeep.
 * ALL intent-driven actions flow through this — voice, chat, geo, perception.
 *
 * ARCHITECTURE:
 *
 *   [Voice Input]  [Chat Input]  [Geo Trigger]  [Perception Signal]
 *         │              │              │                │
 *         └──────────────┴──────────────┴────────────────┘
 *                                │
 *                     ┌──────────▼──────────┐
 *                     │    orchestrate()    │  ← single entry point
 *                     └──────────┬──────────┘
 *                                │
 *              ┌─────────────────┼─────────────────┐
 *              ▼                 ▼                 ▼
 *       [Intent Engine]   [Context Engine]  [Decision Engine]
 *              │                 │                 │
 *              └─────────────────┴─────────────────┘
 *                                │
 *                    ┌───────────▼───────────┐
 *                    │   Action Router       │
 *                    │ /api/voice/capture    │
 *                    │ /api/geo/check        │
 *                    │ /api/perception/signal│
 *                    │ /api/ai/summary       │
 *                    └───────────────────────┘
 *
 * USAGE:
 *   import { orchestrate, OrchestratorContext } from '@/lib/orchestrator'
 *
 *   // From voice capture:
 *   const result = await orchestrate({
 *     source: 'voice',
 *     text: transcript,
 *     token: accessToken,
 *     userId: user.id,
 *   })
 *
 *   // From geo trigger:
 *   const result = await orchestrate({
 *     source: 'geo',
 *     lat, lng,
 *     token: accessToken,
 *     userId: user.id,
 *   })
 */

import { detectUserState, isActionable, computePriority, checkDuplicate } from './intent-engine';
import { safeFetch } from './safeFetch';

export type OrchestratorSource = 'voice' | 'text' | 'geo' | 'chat' | 'perception' | 'scheduled';

export interface OrchestratorInput {
  source:       OrchestratorSource;
  text?:        string;           // voice/text input
  lat?:         number;           // geo trigger
  lng?:         number;
  token:        string;           // Supabase access token
  userId:       string;
  workspaceId?: string;           // business mode
  language?:    string;           // STT language code
  userModel?:   Record<string, unknown> | null;  // learned behavior model
  recentKeeps?: Array<{ id: string; content: string; created_at: string }>;
}

export interface OrchestratorResult {
  success:      boolean;
  action:       string;           // what was done
  keep?:        Record<string, unknown>;
  intent?:      Record<string, unknown>;
  ttsResponse?: string;
  followUp?:    Record<string, unknown>;
  triggered?:   number;           // geo: number of keeps triggered
  error?:       string;
}

const SERVER = typeof window !== 'undefined'
  ? ''
  : 'https://quietkeep.com';

/**
 * Main orchestration entry point.
 * Routes input to the correct API based on source and context.
 */
export async function orchestrate(input: OrchestratorInput): Promise<OrchestratorResult> {
  try {
    switch (input.source) {
      case 'voice':
      case 'text':
        return await _handleVoiceText(input);

      case 'geo':
        return await _handleGeo(input);

      case 'perception':
        return await _handlePerception(input);

      case 'chat':
        return await _handleChat(input);

      default:
        return { success: false, action: 'noop', error: 'Unknown source' };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Orchestrator] error:', msg);
    return { success: false, action: 'error', error: msg };
  }
}

// ── Voice/Text handler ────────────────────────────────────────────────────────

async function _handleVoiceText(input: OrchestratorInput): Promise<OrchestratorResult> {
  if (!input.text?.trim()) {
    return { success: false, action: 'noop', error: 'Empty input' };
  }

  // 1. Client-side duplicate check before hitting the API
  if (input.recentKeeps?.length) {
    const { isDuplicate } = checkDuplicate(input.text, input.recentKeeps);
    if (isDuplicate) {
      return { success: false, action: 'duplicate', error: 'Duplicate intent' };
    }
  }

  // 2. Client-side context enrichment
  const userState  = detectUserState(input.userModel as Parameters<typeof detectUserState>[0] ?? null);

  // 3. Route to voice/capture API
  const { data, error } = await safeFetch(`${SERVER}/api/voice/capture`, {
    method: 'POST',
    body: JSON.stringify({
      transcript:   input.text.trim(),
      source:       input.source,
      workspace_id: input.workspaceId ?? null,
      language:     input.language ?? 'en-IN',
      user_state:   userState,
    }),
    token: input.token,
  });

  if (error || !data) {
    return { success: false, action: 'capture_failed', error: error ?? 'No response' };
  }

  return {
    success:     true,
    action:      'keep_created',
    keep:        data.keep ?? data.intent,
    intent:      data.intent,
    ttsResponse: data.tts_response,
    followUp:    data.follow_up,
  };
}

// ── Geo handler ───────────────────────────────────────────────────────────────

async function _handleGeo(input: OrchestratorInput): Promise<OrchestratorResult> {
  if (input.lat == null || input.lng == null) {
    return { success: false, action: 'noop', error: 'Missing lat/lng' };
  }

  const { data, error } = await safeFetch(`${SERVER}/api/geo/check`, {
    method: 'POST',
    body: JSON.stringify({ lat: input.lat, lng: input.lng }),
    token: input.token,
  });

  if (error || !data) {
    return { success: false, action: 'geo_check_failed', error: error ?? 'No response' };
  }

  return {
    success:   true,
    action:    'geo_checked',
    triggered: data.triggered ?? 0,
    keep:      data.keeps?.[0],
  };
}

// ── Perception handler ────────────────────────────────────────────────────────

async function _handlePerception(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { data, error } = await safeFetch(`${SERVER}/api/perception/signal`, {
    method: 'POST',
    body: JSON.stringify({
      signal_type: 'app_active',
      payload: { source: 'orchestrator', user_id: input.userId },
    }),
    token: input.token,
  });

  return {
    success: !error,
    action:  'perception_recorded',
    error:   error ?? undefined,
  };
}

// ── Chat handler ──────────────────────────────────────────────────────────────

async function _handleChat(input: OrchestratorInput): Promise<OrchestratorResult> {
  if (!input.text?.trim() || !input.workspaceId) {
    return { success: false, action: 'noop', error: 'Missing text or workspace' };
  }

  // Chat messages with /keyword triggers can spawn keeps
  const text = input.text.trim();
  const isCommand = text.startsWith('/keep ') || text.startsWith('/remind ') || text.startsWith('/task ');

  if (isCommand) {
    const commandText = text.replace(/^\/(keep|remind|task)\s+/i, '');
    return _handleVoiceText({ ...input, source: 'text', text: commandText });
  }

  return { success: true, action: 'chat_message' };
}

// ── Convenience: start perception + location services ────────────────────────

export function startBackgroundServices(token: string, serverUrl = ''): void {
  if (typeof window === 'undefined') return;

  // Start perception loop (30s interval)
  import('./capacitor/perception').then(({ startPerceptionLoop }) => {
    startPerceptionLoop(token, serverUrl, 30_000).catch(() => {});
  });

  // Start location service (via VoicePlugin bridge if on Android)
  const cap = (window as unknown as Record<string, unknown>)?.Capacitor as Record<string, unknown> | undefined;
  const isAndroid = !!(cap as Record<string, unknown> | undefined) && (cap as { getPlatform?: () => string })?.getPlatform?.() === 'android';
  if (!isAndroid) return;

  const VP = ((cap as Record<string, unknown>)?.Plugins as Record<string, unknown> | undefined)?.VoicePlugin as Record<string, (...args: unknown[]) => unknown> | undefined;
  if (!VP?.startLocationService) return;

  (VP.startLocationService({
    auth_token: token,
    server_url: serverUrl || 'https://quietkeep.com',
  }) as Promise<unknown>).catch(() => {});
}

export function stopBackgroundServices(): void {
  if (typeof window === 'undefined') return;

  import('./capacitor/perception').then(({ stopPerceptionLoop }) => {
    stopPerceptionLoop();
  });

  const cap = (window as unknown as Record<string, unknown>)?.Capacitor as Record<string, unknown> | undefined;
  const VP = ((cap as Record<string, unknown>)?.Plugins as Record<string, unknown> | undefined)?.VoicePlugin as Record<string, (...args: unknown[]) => unknown> | undefined;
  void (VP?.stopLocationService?.() as Promise<unknown>)?.catch?.(() => {});
}
