// src/lib/account-delete-flow.js

export async function runDeleteAccount({ token, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res1 = await fetchImpl('/api/voice/forget-me', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (token || ''),
      },
    });
    let body1 = null;
    try {
      body1 = await res1.json();
    } catch {}
    if (res1.status !== 200 || !body1 || body1.ok !== true) {
      return {
        ok: false,
        step: 'voice',
        message: "We couldn't erase your voice data yet. Nothing was deleted. Please try again in a minute.",
      };
    }
  } catch {
    return {
      ok: false,
      step: 'voice',
      message: "We couldn't erase your voice data yet. Nothing was deleted. Please try again in a minute.",
    };
  }

  try {
    const res2 = await fetchImpl('/api/account/delete', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (token || ''),
      },
    });
    let body2 = null;
    try {
      body2 = await res2.json();
    } catch {}
    if (res2.status !== 200 || !body2 || body2.ok !== true) {
      return {
        ok: false,
        step: 'account',
        message: 'Account deletion failed. Please try again.',
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      step: 'account',
      message: 'Account deletion failed. Please try again.',
    };
  }
}
