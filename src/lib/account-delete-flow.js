// src/lib/account-delete-flow.js

export async function runDeleteAccount({ token, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl('/api/account/delete', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (token || ''),
      },
    });
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (res.status !== 200 || !body || body.ok !== true) {
      return {
        ok: false,
        step: 'account',
        reason: body?.reason,
        message: body?.message || body?.error || 'Account deletion failed. Please try again.',
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
