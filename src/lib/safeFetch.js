/**
 * src/lib/safeFetch.js
 *
 * PROBLEM: Raw fetch('/api/...') calls crash the UI when Vercel returns HTML
 * error pages (cold start, auth failure, rate limit). res.json() throws a
 * SyntaxError that bubbles uncaught and shows a blank screen.
 *
 * SOLUTION: Single wrapper that:
 *   1. Always checks Content-Type before parsing — returns structured error on HTML
 *   2. Retries once on network error (handles Capacitor wake-from-sleep)
 *   3. Auto-attaches Authorization Bearer
 *   4. Returns { data, error } — never throws
 *
 * USAGE:
 *   import { safeFetch, apiPost, apiGet } from '@/lib/safeFetch'
 *
 *   const { data, error } = await apiPost('/api/voice/capture', body, token)
 *   if (error) { showToast(error); return }
 *   // use data safely
 */

export async function safeFetch(url, options = {}) {
  const { token, retries = 1, ...rest } = options;

  const headers = {
    'Content-Type': 'application/json',
    ...rest.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const config = { ...rest, headers };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, config);

      // Block HTML responses before they reach JSON.parse
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/html')) {
        console.error(`[safeFetch] HTML response ${res.status} from ${url}`);
        return { data: null, error: `Server error (${res.status}) — please retry`, status: res.status };
      }

      let data;
      try {
        data = await res.json();
      } catch {
        return { data: null, error: `Bad response (${res.status})`, status: res.status };
      }

      if (!res.ok) {
        return {
          data: null,
          error: data?.error || data?.message || `Request failed (${res.status})`,
          status: res.status,
          ...(data?.upgrade ? { upgrade: true, tier: data.tier } : {}),
        };
      }

      return { data, error: null };

    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 600)); // wait before retry
        continue;
      }
      return { data: null, error: 'Network error — check connection', network: true };
    }
  }

  return { data: null, error: 'Request failed' };
}

export const apiPost = (url, body, token) =>
  safeFetch(url, { method: 'POST', body: JSON.stringify(body), token });

export const apiGet = (url, token) =>
  safeFetch(url, { token });
