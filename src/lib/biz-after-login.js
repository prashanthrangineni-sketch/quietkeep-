// src/lib/biz-after-login.js
// ─────────────────────────────────────────────────────────────────────────────
// Where a business sign-in should land, and the one thing that must happen
// first.
//
// THE BUG THIS REPLACES
//   All three sign-in paths ended with a hardcoded redirect:
//
//     if (!profile?.business_onboarding_done) -> /b/onboarding
//     else                                    -> /b/dashboard
//
//   For an owner that is right. For a staff member it is actively destructive:
//   they have no profile row, so they fall into the first branch, and
//   /b/onboarding creates them a brand-new workspace with themselves as its
//   owner. They end up running an empty business of their own instead of
//   joining their employer's -- and the employer's row for them stays
//   unclaimed forever.
//
//   Separately, middleware redirects protected business URLs to
//   /biz-login?next=<dest>, but no sign-in path ever read `next`. An invite
//   link (/b/join?token=...) that required a login was therefore lost the
//   moment the person signed in.
//
// ORDER MATTERS
//   Claim first, then decide. The claim is what turns a stranger into a member,
//   and the destination depends on whether they are one.
// ─────────────────────────────────────────────────────────────────────────────

/** Only same-origin paths. Rejects "//evil.com" and absolute URLs. */
function safeNext(raw) {
  if (!raw) return null;
  let v = raw;
  try { v = decodeURIComponent(raw); } catch { /* use as-is */ }
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  return v;
}

/**
 * Attach this user to any staff row their employer already created for them.
 * Never throws: a failure here must not block a legitimate sign-in.
 * @returns {Promise<number>} rows claimed
 */
export async function claimMembership(accessToken) {
  if (!accessToken) return 0;
  try {
    const res = await fetch('/api/business/claim-membership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return 0;
    const data = await res.json().catch(() => null);
    return data?.claimed || 0;
  } catch {
    return 0;
  }
}

/**
 * Decide where to send someone after a successful business sign-in.
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {{access_token?: string, user?: {id?: string}}} session
 * @param {string} [search] location.search, injectable for tests
 * @returns {Promise<string>} a same-origin path
 */
export async function routeAfterBusinessLogin(client, session, search) {
  const userId = session?.user?.id;
  const token = session?.access_token;

  await claimMembership(token);

  // An explicit destination wins -- this is how an invite link survives the
  // login detour.
  const qs = typeof search === 'string'
    ? search
    : (typeof window !== 'undefined' ? window.location.search : '');
  const next = safeNext(new URLSearchParams(qs).get('next'));
  if (next) return next;

  if (!userId) return '/b/dashboard';

  // A membership row -- claimed just now or already there -- means this person
  // belongs to someone else's workspace. Onboarding would hand them their own.
  try {
    const { data: membership } = await client
      .from('business_members')
      .select('id, access_role')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (membership) return '/b/dashboard';
  } catch { /* fall through to the owner path */ }

  const { data: profile } = await client
    .from('profiles')
    .select('business_name, business_onboarding_done')
    .eq('user_id', userId)
    .maybeSingle();

  return (!profile || !profile.business_name || !profile.business_onboarding_done)
    ? '/b/onboarding'
    : '/b/dashboard';
}
