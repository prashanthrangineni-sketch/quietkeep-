# QuietKeep — Source of Truth

**Frozen 14 August 2026.** This file supersedes all 26 earlier reports. Where an
older document disagrees with this one, this one is right — the earlier numbers
were reasoning from the code, and everything below was checked against the live
system.

Three words are used precisely and mean different things:

| word | meaning |
|---|---|
| **Verified** | I ran the query, or opened the screen, on the stated date. |
| **Inferred** | Follows necessarily from something verified. Not observed directly. |
| **Unverified** | Not checked. No claim is being made either way. |

Anything not marked is Verified.

---

## 1. What is live right now

| | |
|---|---|
| Production commit | `2f8adf1` — merge of PR #67 |
| Deployment | `dpl_DdSxu8WZv59kcf8a1ZsjAsgpHmxR`, READY / PROMOTED, target production |
| Domain | quietkeep.com (also www, and the two `*.vercel.app` aliases) |
| Supabase project | `ofnhwpzzxthdvvunxsfs`, org "Pranix AI labs Private ltd", Free plan |
| Repo | `prashanthrangineni-sketch/quietkeep-`. **Decision: stays here.** No transfer. |
| Vercel plan | Hobby — 100 deployments/day, 1 concurrent build |

### Merged and deployed

| PR | What | State |
|---|---|---|
| #63 | Design system | merged, deployed, verified in the browser |
| #64 | Theme colours, batch 1 | merged, deployed, verified |
| #65 | Theme colours, batch 2 (46 files) | merged, deployed, verified |
| #66 | `/more` grid regrouping | merged, deployed, verified |
| #67 | Staff access, Documents, voice latency | merged, deployed — **behaviour not yet confirmed by a user** |

### Database

`business_members` and `business_workspaces` each carry 2 RLS policies. The
staff-read policy was tested by **evaluation**, not just creation:

```sql
begin; set local role authenticated;
select count(*) from public.business_members;   -- returned 0, not 42P17
rollback;
```

Creating a policy never proves it evaluates — recursion only fires at query
time. This is the check that mattered.

---

## 2. The finding that reframes everything else

Every table written by a **browser page** stopped within three days of the
app's first commit. The one table written by a **server route** never stopped.

| table | rows | last row ever |
|---|---|---|
| `documents` | 0 | never |
| `voice_sessions` | 0 | never |
| `memories` | 4 | 2026-04-15 |
| `mood_logs` | 18 | 2026-04-14 |
| `health_logs` | 5 | 2026-04-13 |
| `keeps` (server-written) | 197 | 2026-08-13 |

**Cause.** 28 pages had an effect that read `authLoading` without listing it as
a dependency. When auth resolved to "no user yet" the effect never re-ran,
`setLoading(false)` never fired, and the page showed `Loading…` forever — in
front of the Add button.

**Dated.** The bug is in commit `90828b0`, "Initial commit", **13 April 2026**,
and it was in **30 pages on day one**. That is the same day `health_logs`
received its last row.

**Honest limit on this claim.** It is a very strong chain, not a reproduction.
The alternative explanation is that these features simply stopped being used in
April. What argues against that is the shape: three features going quiet within
72 hours while a fourth kept running, split exactly along the client/server line
the bug predicts.

**What this corrects.** Earlier reports read "46 of 109 tables never written" as
46 abandoned features. Today's census is **45 of 109**, and the likeliest single
explanation for a large share of them is one dependency array — not 45
unfinished builds.

---

## 3. Where earlier reports were wrong

- **"The theme is fixed"** — claimed before the screens were opened. 27 screens
  hardcoded colours the switch could never reach. Now genuinely fixed.
- **"46 of 109 tables never written"** — number roughly right, interpretation
  wrong. See section 2.
- **The staff RLS migration as first written** would have failed with `42P17` on
  execution, and addressed one table when the problem spanned two.
- **Three stale branches** — `fix/p0-1-model-strings`,
  `fix/p1-groq-voice-predictions`, `test/pranix-write-access-check-2` — are
  fully contained in `main` and can be deleted.

---

## 4. Open — founder only

These are blocked on a login, not on code.

| | Detail |
|---|---|
| Google OAuth credentials | **DONE 13 Aug 2026.** Client "QuietKeep Web (Supabase Auth)" exists in Google Cloud project `pranix-play-publisher-503408`; Client ID and Secret are populated in Supabase. Sign-in still needs an end-to-end test. |
| Consent screen in Testing | Only whitelisted addresses can sign in at all. Publishing status lives at `console.cloud.google.com/auth/audience`. |
| Consent screen shows a raw Supabase hostname | Users read it as phishing. Setting the app name at `console.cloud.google.com/auth/branding` fixes the headline; the domain needs verification or a custom auth domain (paid plan) to disappear entirely. Needs a 120×120 logo. |
| Android keystore password in git history | **Scope resolved 14 Aug 2026.** No `.jks`/`.keystore`/`.p12`/`.pfx` was ever committed on any branch — **the signing key did not leak, and no Play Console upload-key reset is needed.** The password appears in `90828b0` (13 Apr) and `94ccdf3` (28 Jul, which removed it); it is not in the current tree. Repo is public, so it must still be rotated: `keytool -storepasswd -keystore <file>.jks`, then keep the new value in `~/.gradle/gradle.properties` or an env var. |
| Play Console | versionCode 4 not uploaded; signed `.aab` required; Data Safety needs contacts, notification listener, background location, microphone, call screening; store icon must match launcher icon. |
| MSG91 key rotation | **Parked by founder** — the key is shared across several products. |
| GitHub token | **Will not be revoked** — Doppler and the MCP connection depend on it. Accepted risk, recorded here so it is a decision rather than an oversight. |
| `CRON_SECRET` + pg_cron/pg_net | **DONE 14 Aug 2026.** `CRON_SECRET` added and deployed; pg_cron 1.6.4 and pg_net 0.19.5 both enabled. The scheduling SQL still needs to be run. |
| Magic-link email template | **DONE 14 Aug 2026.** Subject set to "Your QuietKeep sign-in code"; body had setup instructions pasted into it and now contains only the template. |

---

## 5. Open — engineering

### Unverified defects carried since 28 July
Both were in earlier reports and neither has been re-tested. **No claim is being
made that they are still real.**

- **IGST on interstate invoices — CHECKED 14 Aug 2026, CLAIM IS FALSE. CLOSED.**
  `src/app/b/invoices/page.jsx` line 198 writes
  `igst: isInterState(workspace, form) ? totalGst : 0` and zeroes CGST/SGST on
  the same branch. `isInterState` compares the first two digits of the two
  GSTINs — the state code — which is correct place-of-supply logic.
  **B2B invoices are tax-correct.**

  *One narrower gap found while verifying, which is real:* `isInterState`
  returns false when the customer has **no GSTIN**, and the code comment says so
  ("Same/unknown → CGST+SGST"). For an unregistered B2C customer in another
  state, GST law still requires IGST — place of supply for B2C is the
  recipient's location, not a GSTIN they do not have. So **B2C inter-state sales
  are charged CGST+SGST when they should be IGST.** Fixing it needs a customer
  *state* field; `customer_address` is free text and not reliably parseable, so
  this is a schema decision for the founder, not a code fix.
- **SOS lat/lng column mismatch.** Reader uses `location_lat`/`location_lng`,
  writer uses `latitude`/`longitude`.

### Parked pending a business decision, not a bug
RazorpayX payroll · e-invoice IRN (needs AATO ≥ ₹5cr) · DigiLocker/BBPS (needs a
GSP account) · Meta WhatsApp Cloud API · QR merchant storefront.

### Model strategy — DECIDED 17 Aug 2026, do not re-litigate

**Anthropic is not used and `ANTHROPIC_API_KEY` will not be provisioned.** Voice
goes through Sarvam via Pranix Aaria. Anything else uses free models via
OpenRouter, or a KIMI / GLM subscription. Founder's decision.

**Consequence: six routes read `process.env.ANTHROPIC_API_KEY` and therefore
return "AI not configured" (503) in production today.** They are not broken code
— they are pointed at a provider that was never configured:

| Route | What the user loses |
|---|---|
| `src/app/api/parse-intent/route.js` | intent parsing fallback |
| `src/app/api/keep-assist/route.js` | the AI button on Documents and keeps |
| `src/app/api/ai/summary/route.js` | keep summaries |
| `src/app/api/daily-brief-summary/route.js` | the daily brief |
| `src/app/api/warranty/route.js` | warranty extraction |
| `src/app/api/whatsapp/webhook/route.js` | inbound WhatsApp understanding |

Each names `claude-haiku-4-5-20251001` or `claude-3-5-haiku`. Repointing them is
mostly mechanical — OpenRouter speaks the OpenAI chat-completions shape, which
these routes already build — but it is **six separate routes with six separate
prompts**, and each needs its own verification that the replacement model returns
the same JSON shape. Not a find-and-replace.

`src/app/api/documents/classify/route.js` is deliberately NOT in this list: it
uses `OPENAI_API_KEY`, which is provisioned, precisely because of this.

### Built but not yet delivered
Documents OCR — the columns exist and nothing writes them, while "Document OCR"
is sold in the upgrade modal. Tau profile compilation.

---

## 6. Working rules adopted after failures in this engagement

Each of these exists because something went wrong, not as general advice.

1. **Never split a syntactic pair across commits.** A `<div>` opened in one
   commit and closed in the next produced a red Vercel build from the
   intermediate commit.
2. **A redeploy rebuilds the same pinned commit.** Clicking Redeploy on a failed
   deployment cannot fix a broken commit. Push a new one.
3. **Check that a merge actually produced a deployment.** PR #66's webhook
   silently did not fire; production sat 39 minutes behind main.
4. **Creating a policy is not testing a policy.** Recursion only fires at query
   time. Evaluate it under `set local role authenticated`.
5. **Verify a push by tree, not by SHA.** Writes go through the Pranix connector,
   which creates its own commits. Compare `git rev-parse HEAD^{tree}` against the
   remote branch's tree; matching trees mean the content is there.
6. **Colour codemods must test chroma, not luminance.** `#7c3aed` is dark by
   luminance, so a luminance test converted the brand violet and collapsed four
   selected-state indicators into their unselected colour.
7. **White text on a filled accent surface stays white.** It is not on the theme
   surface, so it must not be themed.
8. **Mark every commit in a batch `[skip ci]` except the last.** Hobby plan
   allows one concurrent build and 100 deployments a day.
9. **A keyword table must not contain entries its own guard will always
   reject.** Enforced by a test in `tests/aaria-router.test.mjs`.
10. **Never paste instructions into a config field.** The magic-link email body
    contained "**Step 4:** Change the **Subject** to:" and shipped it to users.
    When handing over a block to paste, mark exactly where it starts and ends.

---

## 7. Recommended order

1. Confirm PR #67 actually works — Documents saves a row, a staff member loses
   the "never signed in" badge. Check the database, not the screen.
2. Test Google sign-in end to end, and publish the consent screen.
3. Check the IGST claim.
4. Rotate the keystore password before any Play upload.
5. Everything else.

---

*Maintained by the build agent. Update this file in the same PR as the change it
describes — a SOT that lags the code is worse than no SOT, because people trust
it.*
