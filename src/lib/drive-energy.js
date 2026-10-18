// src/lib/drive-energy.js - DRV-11b: the energy envelope Drive's indicator
// detector (src/lib/indicator-sound.js) needs, from the phone's microphone.
//
// THE CONTRACT FOR THE DRIVE THREAD
//   const r = await listenEnergy({ seconds: 5 })
//   r = { ok: true, energies: number[], hz: 100, reason }   // ~100 numbers per second, 0..1
//   r = { ok: false, energies: [], hz: 100, reason }        // why nothing was heard
//   then: detectIndicatorSound(r.energies, { frameRate: r.hz })
//
// Native side: Capacitor plugin "IndicatorEar" (IndicatorEarPlugin.java),
// events "energy" ({ frames: number[10], hz: 100, t }) and "ended" ({ reason }).
// Numbers only: the sound itself never leaves the plugin and is never kept.
//
// NO FIGHT WITH THE WAKE LISTENER. Before listening this announces
// qk_mic_claim, the signal every QuietKeep microphone user sends (MicGuard,
// aaria-hotword.js): Aaria's wake listener gives the microphone up for these
// few seconds and takes it back on qk_mic_release, which is always sent when
// the listen ends - success, stop or error. If someone else claims the
// microphone meanwhile (a voice command), this listen stops at once and gives
// way. Listens are short (at most 8 s) by design, so hands-free "Hey Aaria"
// is only ever paused for seconds.
//
// The caller is responsible for the opt-in: call this only when
// Drive Mode -> Indicator reminders -> "Also listen for the indicator sound"
// is ON (default OFF, founder decision 18 Oct 2026).

export const ENERGY_HZ = 100;
export const MAX_SECONDS = 8;

function pluginFrom(w) {
  return w?.Capacitor?.Plugins?.IndicatorEar || null;
}

// The wake listener needs a moment to let go of the microphone after the
// claim (the page bridge pauses it asynchronously). Chosen, not measured.
export const SETTLE_MS = 600;

export async function listenEnergy({ seconds = 5, plugin, win, settleMs = SETTLE_MS } = {}) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const ear = plugin || pluginFrom(w);
  const secs = Math.max(1, Math.min(MAX_SECONDS, Math.round(Number(seconds) || 5)));
  const fail = (reason) => ({ ok: false, energies: [], hz: ENERGY_HZ, reason });
  if (!w || !ear) return fail('not_on_phone');

  const energies = [];
  let ownClaim = false;
  let finished = false;
  let handles = [];
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const finish = (reason) => {
    if (finished) return;
    finished = true;
    resolveDone(reason);
  };
  // Someone else needs the microphone (a voice command): stop and give way.
  const onOtherClaim = () => {
    if (ownClaim) return;
    try { ear.stop?.(); } catch {}
    finish('mic_needed_elsewhere');
  };

  try {
    handles.push(await ear.addListener('energy', (ev) => {
      if (finished || !Array.isArray(ev?.frames)) return;
      for (const f of ev.frames) {
        const v = Number(f);
        energies.push(Number.isFinite(v) && v >= 0 ? v : 0);
      }
    }));
    handles.push(await ear.addListener('ended', (ev) => finish(ev?.reason || 'done')));
    w.addEventListener('qk_mic_claim', onOtherClaim);

    ownClaim = true;
    try { w.dispatchEvent(new CustomEvent('qk_mic_claim')); } catch {}
    ownClaim = false;
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
    if (finished) return fail('mic_needed_elsewhere');

    await ear.start({ seconds: secs });
    // Safety net: never wait longer than the listen plus a little.
    const guard = setTimeout(() => finish('timeout'), (secs + 3) * 1000);
    const reason = await done;
    clearTimeout(guard);
    const ok = energies.length > 0 && (reason === 'done' || reason === 'stopped' || reason === 'timeout');
    return { ok, energies: ok ? energies : [], hz: ENERGY_HZ, reason: ok ? reason : (reason === 'done' ? 'nothing_heard' : reason) };
  } catch (e) {
    return fail(String(e?.message || e || 'error').slice(0, 60));
  } finally {
    finished = true;
    try { w.removeEventListener('qk_mic_claim', onOtherClaim); } catch {}
    for (const h of handles) { try { await h?.remove?.(); } catch {} }
    try { w.dispatchEvent(new CustomEvent('qk_mic_release')); } catch {}
  }
}

export function stopEnergy({ plugin, win } = {}) {
  const ear = plugin || pluginFrom(win || (typeof window !== 'undefined' ? window : null));
  try { ear?.stop?.(); } catch {}
}
