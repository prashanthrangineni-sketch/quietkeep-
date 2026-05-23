# QuietKeep Release Flow

**Version:** 1.0
**Effective:** 2026-05-23
**Workflow source:** `.github/workflows/android-build.yml`

This document is the operational contract for how a QuietKeep change
gets from a commit to an APK in a user's hand. It pairs with
`QUIETKEEP_GOVERNANCE.md` (which defines the WHO is allowed to do
WHAT) by describing the HOW.

---

## 1. Trigger contract

The Android build workflow fires on exactly two events:

| Event | Trigger | Outcome |
|---|---|---|
| `push` to `main` | After a PR is merged | Builds both APKs, distributes to Firebase beta-testers |
| `workflow_dispatch` (manual) | Founder runs from GitHub Actions UI | Builds selected APK(s), distributes to Firebase beta-testers |

**Feature branches do NOT trigger this workflow.** This is verified
in `.github/workflows/android-build.yml`:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      build_type: { ... }
```

If you ever see an APK build firing from a feature branch, that is
a bug in the workflow file and should be patched immediately.

---

## 2. Matrix structure

A single trigger produces builds for both variants in parallel:

- `personal` — `com.pranix.quietkeep` (theme indigo)
- `business` — `com.pranix.quietkeep.business` (theme emerald)

Both variants share the same source tree, the same web app, and the
same `quietkeep.com` server URL. They differ in:

- `NEXT_PUBLIC_APP_TYPE` env (set at build time per matrix row)
- `applicationId` (modified via `sed` for the business variant)
- `app_name` in `strings.xml` (modified for business)
- `android-res-business/` icon overlay (applied for business)
- `google-services.json` (separate FCM project per variant)

A failure in one matrix row does NOT cancel the other
(`fail-fast: false`).

---

## 3. Build pipeline (per matrix row)

The workflow performs in order:

1. **Setup** — Java 17 (Temurin), Node 20, Android SDK
2. **Install deps** — `npm install --legacy-peer-deps` then pinned
   Capacitor 6.2.0 family
3. **Static export** — `CAPACITOR_BUILD=1 npm run build` after
   temporarily hiding `src/app/api`, `src/app/auth/callback`,
   `src/app/share`, `src/app/dashboard/engine-health`,
   `src/app/messages/[conversationId]`. Paths are restored after
   build, success or failure.
4. **Android scaffold** — `npx cap add android` then restore custom
   files (`java/`, `AndroidManifest.xml`, `build.gradle`, `res/`)
   from `/tmp/qk-backup/`
5. **Business overrides** (matrix=business only) — apply
   `capacitor.business.config.json`, swap applicationId, swap
   app_name, overlay business icons
6. **`google-services.json`** — decode from per-variant secret
7. **Capacitor sync** — `npx cap sync android` copies `out/` into
   APK assets
8. **Bundle verification** — assert file count, assert `server.url`
   present in baked `capacitor.config.json`, assert correct
   `applicationId`
9. **Keystore decode** — from `SIGNING_KEY_BASE64` secret if present
10. **Gradle build** — `assembleRelease` if keystore is present,
    otherwise `assembleDebug`
11. **APK artifact upload** — `QuietKeep-<variant>-<run_number>`,
    retained 30 days
12. **Firebase distribution** — `wzieba/Firebase-Distribution-Github-Action@v1`
    to `beta-testers` group; `continue-on-error: true` so Firebase
    failure does not fail the workflow
13. **APK verification** — final size + appId + server.url check

---

## 4. Required secrets

The workflow consumes these GitHub secrets:

| Secret | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public Supabase URL baked into the static bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key baked into the static bundle |
| `GOOGLE_SERVICES_PERSONAL` | base64 of `google-services.json` for personal FCM project |
| `GOOGLE_SERVICES_BUSINESS` | base64 of `google-services.json` for business FCM project |
| `SIGNING_KEY_BASE64` | base64 of release keystore (optional; debug build if absent) |
| `KEYSTORE_PASSWORD` | Keystore password |
| `KEY_ALIAS` | Signing key alias |
| `KEY_PASSWORD` | Signing key password |
| `FIREBASE_APP_ID_PERSONAL` | Firebase App ID for personal beta distribution |
| `FIREBASE_APP_ID_BUSINESS` | Firebase App ID for business beta distribution |
| `FIREBASE_TOKEN` | Firebase CI token |

Absence of FCM or keystore secrets produces a warning but the build
continues. Push notifications and signed-release distribution are
both optional from the workflow's perspective; product release
requires both.

---

## 5. APK lifecycle

| Stage | Artifact | Storage | Distribution |
|---|---|---|---|
| 1. Build | Debug or release APK | GitHub Actions artifact, 30-day retention | None |
| 2. Beta | Release APK signed | Firebase App Distribution | `beta-testers` group |
| 3. Internal track | Release APK signed | Play Console internal testing | Internal testers list |
| 4. Closed beta | Release APK signed | Play Console closed beta | Up to 100 testers per track |
| 5. Production | Release APK signed | Play Console production | All users |

Today the pipeline ships through Stage 2 automatically. Stages 3-5
are manual founder actions in the Play Console.

---

## 6. Vercel preview deployment

Independent of the APK build, every push to any branch triggers a
Vercel deployment if Git integration is enabled on
`prj_9BUpRHfKJuwMer8zsPxjZrj2bH2w`:

- `main` push → production deployment to `quietkeep.com`
- Feature branch push → preview deployment on
  `quietkeep-git-<branch>-<team>.vercel.app`

Vercel previews are the fastest validation surface for feature
branches and should be the first place a reviewer goes after the
PR is opened.

The APK does NOT load a Vercel preview URL — it loads the production
`server.url: "https://quietkeep.com"` baked into
`capacitor.config.json`. **Feature-branch UI changes only become
visible inside the APK after the PR is merged and the production
Vercel deployment is live.** This is intentional (single source of
truth for app behaviour) but important to understand when validating
UI changes via the APK.

---

## 7. Rollback path

If a `main` push produces a bad APK or a bad production web deployment:

| Surface | Rollback action |
|---|---|
| Production web (quietkeep.com) | Vercel dashboard → Deployments → previous → Promote |
| Personal APK on Firebase | Firebase App Distribution → previous release → Re-distribute |
| Business APK on Firebase | Same, on the business App ID |
| Source tree | `git revert <merge-commit>` on `main`, push, let CI rebuild |

Production Play Console rollbacks require staged rollout halt — see
Play Console docs.

---

## 8. Health check after release

After a `main` push completes, verify:

1. Workflow run reports both matrix rows green
2. Both APK artifacts exist
3. Both Firebase distributions completed (check the Firebase console
   release-notes feed)
4. Production Vercel deployment ready
5. `quietkeep.com` returns HTTP 200 on `/` and on `/b/dashboard`
6. Browser smoke flow passes (see `quietkeep:browser_flows` in
   execution_memory)

---

## 9. Source of truth

This document is the source of truth for QuietKeep release process.
Amendments require a PR to this file, founder review, and merge.
