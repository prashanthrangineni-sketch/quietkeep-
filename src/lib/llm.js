// src/lib/llm.js
// ─────────────────────────────────────────────────────────────────────────────
// One way to ask a model a question, that keeps working when a model disappears.
//
// WHY THIS EXISTS
// Six routes in this app each opened their own hard-coded connection to
// api.anthropic.com with a hard-coded model name. ANTHROPIC_API_KEY was never
// provisioned, so all six answered 503 in production for months: the daily
// brief, warranty extraction, keep summaries, the AI button on Documents,
// intent parsing, and inbound WhatsApp understanding. Six features, dead,
// each failing quietly in its own file.
//
// The failure was not the provider. It was that a provider name was welded into
// six places, so switching meant six edits and nobody made them.
//
// THE RULE THIS ENFORCES
// A model is a runtime detail, not a dependency. Nothing above this file names
// a provider or a model. When a free model is retired — and free models are
// retired constantly — the fix is one line in MODEL_CHAIN, not a code change in
// six routes.
//
// HOW THE CHAIN WORKS
// Try each entry in order until one answers. Move on when a model is gone
// (404), rate-limited (429), or the provider is having a bad day (5xx). Do NOT
// move on for a bad request (400) — that is our prompt being wrong, and every
// other model will reject it too; retrying just burns time and quota.
//
// Everything degrades to null. These six routes all have a non-AI path, and a
// missing summary is a smaller problem than a 500.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordered fallback chain. First entry that has a key AND answers, wins.
 *
 * OpenRouter first because the founder's decision is free models by default.
 * OpenAI and Groq sit behind it as paid/provisioned safety nets, so a total
 * OpenRouter outage degrades to "slightly more expensive" rather than "dead".
 *
 * Overridable without a deploy via QK_MODEL_CHAIN — a comma-separated list of
 * `provider:model`. When a free model is retired at 2am, that env var is the
 * fix, not a release.
 */
const DEFAULT_CHAIN = [
  // free, via OpenRouter
  'openrouter:meta-llama/llama-3.3-70b-instruct:free',
  'openrouter:google/gemma-2-9b-it:free',
  'openrouter:mistralai/mistral-7b-instruct:free',
  // provisioned fallbacks
  'groq:llama-3.3-70b-versatile',
  'openai:gpt-4o-mini',
];

/**
 * A separate chain for requests carrying an image.
 *
 * Most free text models cannot see. Sending them an image is not a graceful
 * degradation — they either error or, worse, confidently answer about an image
 * they never received. So vision requests get their own list, and it leads with
 * a model that is actually provisioned rather than a free one that may not be.
 *
 * Override with QK_VISION_CHAIN.
 */
const DEFAULT_VISION_CHAIN = [
  'openai:gpt-4o-mini',
  'openrouter:meta-llama/llama-3.2-11b-vision-instruct:free',
  'openrouter:qwen/qwen-2-vl-7b-instruct:free',
];

const PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key: () => process.env.OPENROUTER_API_KEY,
    extraHeaders: () => ({
      // OpenRouter asks for these; they also identify the app in their dashboard.
      'HTTP-Referer': 'https://quietkeep.com',
      'X-Title': 'QuietKeep',
    }),
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    key: () => process.env.OPENAI_API_KEY,
    extraHeaders: () => ({}),
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: () => process.env.GROQ_API_KEY,
    extraHeaders: () => ({}),
  },
};

/** Parse "provider:model" — model names contain colons, so split on the FIRST only. */
export function parseChainEntry(entry) {
  const s = String(entry || '').trim();
  if (!s) return null;
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const provider = s.slice(0, i).toLowerCase();
  const model    = s.slice(i + 1);
  if (!model || !PROVIDERS[provider]) return null;
  return { provider, model };
}

/**
 * The chain, after env override and after dropping providers with no key.
 * @param {object}  [env]
 * @param {boolean} [vision] use the vision chain instead of the text one
 */
export function resolveChain(env = process.env, vision = false) {
  const override = String((vision ? env.QK_VISION_CHAIN : env.QK_MODEL_CHAIN) || '').trim();
  const list = override ? override.split(',') : (vision ? DEFAULT_VISION_CHAIN : DEFAULT_CHAIN);
  return list
    .map(parseChainEntry)
    .filter(Boolean)
    .filter(({ provider }) => {
      const k = PROVIDERS[provider].key();
      return !!k;
    });
}

/**
 * Should we try the next model, or stop?
 *
 * 400 means our prompt is malformed. Every model will say the same thing, so
 * walking the whole chain wastes the user's time and our quota to arrive at the
 * same answer. 401/403 means this provider's key is bad — skip the provider,
 * but a different provider may still work, so keep going.
 */
export function shouldFallback(status) {
  if (status === 400) return false;
  return status === 401 || status === 403 || status === 404
      || status === 429 || status >= 500;
}

/**
 * Ask a model. Returns the reply text, or null if nothing in the chain answered.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=300]
 * @param {number} [opts.temperature=0.2]
 * @param {boolean}[opts.json]        ask for a JSON object back
 * @param {number} [opts.timeoutMs=15000]  per attempt, not total
 * @returns {Promise<{text:string, model:string, provider:string}|null>}
 */
export async function askModel(prompt, opts = {}) {
  const clean = String(prompt || '').trim();
  if (!clean) return null;

  const {
    maxTokens = 300, temperature = 0.2, json = false, timeoutMs = 15000, image = null,
  } = opts;

  const chain = resolveChain(process.env, !!image);
  if (!chain.length) return null;   // no provider configured at all

  // One user message. With an image, the OpenAI content-array shape — which
  // OpenRouter and Groq both speak, so the same body works across the chain.
  const content = image?.base64
    ? [
        { type: 'text', text: clean },
        { type: 'image_url', image_url: { url: `data:${image.mime || 'image/jpeg'};base64,${image.base64}`, detail: 'low' } },
      ]
    : clean;

  for (const { provider, model } of chain) {
    const p = PROVIDERS[provider];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const body = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content }],
      };
      // Not every free model supports response_format. Asking for it and being
      // rejected would burn a whole chain entry, so only send it where it is
      // reliably supported; elsewhere the prompt asks for JSON in words.
      if (json && (provider === 'openai' || provider === 'groq')) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(p.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${p.key()}`,
          ...p.extraHeaders(),
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        if (shouldFallback(res.status)) {
          console.warn(`[llm] ${provider}:${model} → ${res.status}, trying next`);
          continue;
        }
        const t = await res.text().catch(() => '');
        console.error(`[llm] ${provider}:${model} → ${res.status}`, t.slice(0, 200));
        return null;   // our fault; the next model would say the same
      }

      const data = await res.json().catch(() => null);
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text.trim()) {
        return { text: text.trim(), model, provider };
      }
      // Answered 200 with nothing usable — treat as this model failing.
      console.warn(`[llm] ${provider}:${model} → empty content, trying next`);
      continue;

    } catch (err) {
      // Timeout or network. Another provider may well be fine.
      console.warn(`[llm] ${provider}:${model} → ${err?.name || 'error'}, trying next`);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

/** Ask for JSON and parse it. Returns null rather than throwing on junk. */
export async function askModelJSON(prompt, opts = {}) {
  const r = await askModel(prompt, { ...opts, json: true });
  if (!r) return null;
  const raw = r.text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

/** True when at least one provider in the chain has a key. */
export function isConfigured() { return resolveChain().length > 0; }

export default askModel;
