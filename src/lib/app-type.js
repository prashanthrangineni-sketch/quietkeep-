/**
 * src/lib/app-type.js
 *
 * Resolves the app flavour/mode (personal vs business) with the following precedence:
 *   1. URL parameter 'app' (?app=business or ?app=personal)
 *   2. Native injected global (window.__QK_APP_TYPE__)
 *   3. Cookie (qk_app_mode)
 *   4. Build-time environment variable (process.env.NEXT_PUBLIC_APP_TYPE)
 *   5. Default to 'personal'
 *
 * When a URL parameter is present, it is persisted to the 'qk_app_mode' cookie.
 */

export function getAppType(urlSearchString) {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_APP_TYPE || 'personal';
  }

  // 1. URL parameter precedence
  const search = urlSearchString !== undefined ? urlSearchString : window.location.search;
  if (search) {
    const urlParams = new URLSearchParams(search);
    const urlApp = urlParams.get('app');
    if (urlApp === 'business' || urlApp === 'personal') {
      try {
        // Persist choice to cookie so it survives page navigation on the web
        document.cookie = `qk_app_mode=${urlApp}; path=/; max-age=31536000; SameSite=Lax`;
      } catch (e) {
        console.error('Failed to set qk_app_mode cookie:', e);
      }
      return urlApp;
    }
  }

  // 2. Native injected global
  if (window.__QK_APP_TYPE__ === 'business' || window.__QK_APP_TYPE__ === 'personal') {
    return window.__QK_APP_TYPE__;
  }

  // 3. Cookie (qk_app_mode)
  try {
    const match = document.cookie.match(/(?:^|; )qk_app_mode=([^;]*)/);
    if (match && (match[1] === 'business' || match[1] === 'personal')) {
      return match[1];
    }
  } catch (e) {}

  // 4. Build-time environment variable
  if (process.env.NEXT_PUBLIC_APP_TYPE === 'business' || process.env.NEXT_PUBLIC_APP_TYPE === 'personal') {
    return process.env.NEXT_PUBLIC_APP_TYPE;
  }

  // 5. Default
  return 'personal';
}
