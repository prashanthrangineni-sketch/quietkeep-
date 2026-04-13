/**
 * src/lib/capacitor/perception.ts
 * SAFE FOR WEB BUILD — zero static @capacitor imports.
 * Uses window.Capacitor runtime access only (injected by native webview).
 *
 * Personal mode: sends app_active / app_foreground / device_context signals
 * Business mode: same signals, engine routes by domain_type
 */

function getCapacitorPlugin(name: string): any {
  if (typeof window === 'undefined') return null;
  return (window as any)?.Capacitor?.Plugins?.[name] ?? null;
}

function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as any)?.Capacitor?.isNativePlatform?.() === true;
}

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _lastApp = '';
let _lastClip = '';

export async function startPerceptionLoop(
  authToken: string,
  serverUrl = '',
  intervalMs = 30_000
): Promise<void> {
  if (_intervalId) return;
  await _poll(authToken, serverUrl);
  _intervalId = setInterval(() => _poll(authToken, serverUrl), intervalMs);
}

export function stopPerceptionLoop(): void {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
}

async function _poll(authToken: string, serverUrl: string): Promise<void> {
  try {
    if (isNativePlatform()) { await _pollNative(authToken, serverUrl); }
    else                    { await _pollWeb(authToken, serverUrl); }
  } catch { /* never block UX */ }
}

async function _pollNative(authToken: string, serverUrl: string): Promise<void> {
  const P = getCapacitorPlugin('Perception');
  if (!P) return;
  try {
    const app = await P.getForegroundApp?.();
    if (app?.app_name && app.app_name !== _lastApp) {
      _lastApp = app.app_name;
      await _send(authToken, serverUrl, 'app_foreground',
        { app: app.app_name, package: app.package_name });
    }
  } catch {}
  try {
    const ctx = await P.getActivityContext?.();
    if (ctx) await _send(authToken, serverUrl, 'device_context',
      { battery_level: ctx.battery_level, charging: ctx.charging, screen_on: ctx.screen_on });
  } catch {}
  try {
    const clip = await P.getClipboardText?.();
    if (clip?.text && clip.text !== _lastClip && clip.text.length > 20
        && !clip.text.startsWith('http')) {
      _lastClip = clip.text;
      await _send(authToken, serverUrl, 'clipboard_changed',
        { content_length: clip.text.length, preview: clip.text.slice(0, 30) });
    }
  } catch {}
}

async function _pollWeb(authToken: string, serverUrl: string): Promise<void> {
  if (typeof document === 'undefined') return;
  const visible = document.visibilityState === 'visible';
  await _send(authToken, serverUrl, visible ? 'app_active' : 'app_background',
    { page: typeof window !== 'undefined' ? window.location.pathname : '/' });
}

async function _send(
  authToken: string, serverUrl: string,
  signalType: string, payload: Record<string, unknown>
): Promise<void> {
  await fetch(`${serverUrl}/api/perception/signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body: JSON.stringify({ signal_type: signalType, payload }),
  });
}
