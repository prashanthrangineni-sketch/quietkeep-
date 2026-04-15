/**
 * src/lib/aiRouter.ts  —  Step 4: Bring-Your-Own-AI Provider Router
 *
 * Returns the AI provider to use for a given user. ADVISORY ONLY.
 * Never calls any AI API directly. The existing /api/voice/capture and
 * /api/agent/* routes read the returned id via the X-AI-Provider header.
 *
 * SAFE CONTRACT:
 *   • Pure functions — no side effects, no QK module imports.
 *   • Existing code that ignores this router continues to use 'default'.
 *   • Free tier is locked to 'default' — no accidental key exposure.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type AIProviderType = 'default' | 'openai' | 'gemini' | 'local';

export interface AIProvider {
  id:          AIProviderType;
  name:        string;
  model:       string | undefined;
  hasKey:      boolean;   // user has configured a valid API key
  reason:      string;    // diagnostic
  supportsSTT: boolean;   // can also handle speech-to-text
  supportsTTS: boolean;   // can also handle text-to-speech
}

export interface UserAISettings {
  preferredProvider?: AIProviderType | null;
  hasOpenAIKey?:      boolean;
  hasGeminiKey?:      boolean;
  modelOverride?:     string | null;
  tier?:              'free' | 'pro' | 'team' | 'enterprise';
}

// ── Provider metadata ──────────────────────────────────────────────────────

type ProviderMeta = Omit<AIProvider, 'id' | 'reason' | 'hasKey'>;

const META: Record<AIProviderType, ProviderMeta> = {
  default: { name: 'QuietKeep AI',   model: 'claude-3-5-haiku',   supportsSTT: true,  supportsTTS: true  },
  openai:  { name: 'OpenAI',         model: 'gpt-4o',             supportsSTT: true,  supportsTTS: true  },
  gemini:  { name: 'Google Gemini',  model: 'gemini-1.5-flash',   supportsSTT: false, supportsTTS: false },
  local:   { name: 'Local Model',    model: undefined,            supportsSTT: false, supportsTTS: false },
};

function build(id: AIProviderType, reason: string, hasKey: boolean, modelOverride?: string | null): AIProvider {
  return { id, ...META[id], model: modelOverride ?? META[id].model, hasKey, reason };
}

// ── Main selector ──────────────────────────────────────────────────────────

/**
 * selectAIProvider(userSettings) → AIProvider
 *
 * Decision order:
 *   1. Free tier → always default (protect API keys)
 *   2. OpenAI selected + key present → openai
 *   3. Gemini selected + key present → gemini
 *   4. Local selected → default (not yet implemented)
 *   5. Provider selected but no key → default
 *   6. No preference → default
 */
export function selectAIProvider(settings: UserAISettings = {}): AIProvider {
  const { preferredProvider, hasOpenAIKey = false, hasGeminiKey = false, modelOverride, tier = 'free' } = settings;

  if (tier === 'free' && preferredProvider && preferredProvider !== 'default')
    return build('default', 'Free tier — upgrade to use custom AI', false);

  if (preferredProvider === 'openai' && hasOpenAIKey)
    return build('openai', 'User selected OpenAI with valid key', true, modelOverride);

  if (preferredProvider === 'gemini' && hasGeminiKey)
    return build('gemini', 'User selected Gemini with valid key', true, modelOverride);

  if (preferredProvider === 'local')
    return build('default', 'Local model not yet available — using default', false);

  if (preferredProvider && preferredProvider !== 'default')
    return build('default', `${preferredProvider} selected but no API key configured`, false);

  return build('default', 'Default QuietKeep AI', false);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns HTTP headers to include in API requests for provider routing. */
export function getProviderHeaders(provider: AIProvider): Record<string, string> {
  if (provider.id === 'default') return {};
  const h: Record<string, string> = { 'X-AI-Provider': provider.id };
  if (provider.model) h['X-AI-Model'] = provider.model;
  return h;
}

/** Returns all providers a user can choose from (for settings UI). */
export function listAvailableProviders(settings: UserAISettings = {}): AIProvider[] {
  const list: AIProvider[] = [build('default', 'Built-in', true)];
  if (settings.tier !== 'free') {
    list.push(
      build('openai', 'User-configured', settings.hasOpenAIKey ?? false),
      build('gemini', 'User-configured', settings.hasGeminiKey ?? false),
    );
  }
  list.push(build('local', 'Coming soon', false));
  return list;
}

// ── Step 6: Usage tracking ────────────────────────────────────────────────
// In-memory counter. Supabase daily_usage table handles persistent tracking.
// This is a fast client-side gate to prevent accidental over-use.

interface AIUsageState {
  requests:     number;
  resetAt:      number;  // start of current day (epoch ms)
}

const _usage: AIUsageState = { requests: 0, resetAt: 0 };

const DAILY_LIMITS: Record<string, number> = {
  default:  1000,   // QuietKeep AI — effectively unlimited
  openai:   200,    // User's OpenAI key — rate limit protection
  gemini:   200,    // User's Gemini key — rate limit protection
  local:    9999,   // Local — no limit
};

function todayStart(): number {
  const d = new Date(); d.setHours(0,0,0,0); return d.getTime();
}

/**
 * incrementUsage(providerId) → { allowed: boolean; remaining: number }
 * Step 6: Track AI request count. Call before each AI API call.
 */
export function incrementUsage(providerId: AIProviderType): { allowed: boolean; remaining: number } {
  const now = Date.now();
  if (now > _usage.resetAt + 86_400_000) {
    _usage.requests = 0;
    _usage.resetAt  = todayStart();
  }
  _usage.requests++;
  const limit     = DAILY_LIMITS[providerId] ?? 200;
  const remaining = Math.max(0, limit - _usage.requests);
  const allowed   = _usage.requests <= limit;
  if (!allowed) console.warn(`[QK AI] Daily limit reached for provider: ${providerId}`);
  return { allowed, remaining };
}

/**
 * getUsageStats() → current usage counters
 */
export function getUsageStats(): { requests: number; resetAt: number } {
  return { requests: _usage.requests, resetAt: _usage.resetAt };
}
