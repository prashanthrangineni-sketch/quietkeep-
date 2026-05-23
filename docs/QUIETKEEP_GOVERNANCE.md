# QuietKeep Governance Policy

**Version:** 1.0
**Effective:** 2026-05-23
**Owner:** Prashanth Rao Rangineni, Pranix AI Labs Pvt Ltd

This policy is binding for all human and agent contributors to
`prashanthrangineni-sketch/quietkeep-`.

---

## 1. No direct pushes to `main`

`main` is a protected branch in spirit and (where supported) in
GitHub branch protection settings. **All changes must arrive via a
pull request from a feature branch.** Direct commits to `main` —
human or agent — are prohibited.

Rationale: `main` push triggers `.github/workflows/android-build.yml`
which produces signed APKs and distributes to Firebase beta-testers.
A push to `main` is functionally a release. Release-grade gating
applies.

---

## 2. Branch lifecycle

Every change follows this lifecycle:

1. **Create branch** from latest `main`
   - Naming: `fix/<short-slug>`, `feat/<short-slug>`, `chore/<short-slug>`,
     `hotfix/<short-slug>`
   - Slug avoids dots (`.`) for tool compatibility
2. **Apply patches** to the branch (one or more commits)
3. **Verify CI / build / lint** on the branch where workflows are
   configured to run on PR (see Section 4)
4. **Open PR** targeting `main`
5. **Founder reviews** the PR diff
6. **Founder merges** the PR
7. **`main` push triggers `android-build.yml`** matrix → both APKs
   built → Firebase beta distribution

Branches are deleted after merge.

---

## 3. PR requirements

Every PR body must include:

- **Root cause** of the issue being fixed (for `fix/*` branches)
- **Exact fix** — what changed, in plain words
- **Scope boundaries** — what was deliberately left untouched
- **Risk assessment** — what could go wrong, with severity rating
- **Validation performed** — what was checked before requesting merge
- **Follow-ups** — explicit list of items deferred to other PRs

PRs that bundle unrelated changes are rejected. Surgical patches only.

---

## 4. CI requirements

`android-build.yml` triggers exclusively on:

- `push` to `main` (i.e. on PR merge)
- `workflow_dispatch` (manual trigger by founder)

It does **NOT** trigger on feature-branch pushes or PR-open events.
This is intentional: feature branches must not consume APK build
minutes and must not auto-distribute APKs to beta testers.

Feature-branch validation runs through:

- Vercel preview deployment (auto, if Git integration enabled)
- Local `npm run lint` / `npm run build` (developer or agent)
- Browser-flow smoke tests via `browser_test_flow` once Oracle VM is live

---

## 5. Founder merge gate

The founder is the sole authority to merge a PR to `main`. Agents
do not have merge authority. The merge is a human action that
asserts the PR meets the bar described in Section 3.

Founder merge approval may be delegated to a temporary admin role
via `mcp_spawn_temporary_role` for time-bounded automation
experiments, but the default is human review.

---

## 6. Rollback expectations

Every PR should produce a commit chain that is safe to revert via
`git revert <merge-commit>`. Patches that require coordinated rollback
across multiple repos must be flagged in the PR body.

For data-affecting changes (DB migrations, RLS changes, schema edits),
the PR must include:

- Forward migration in `supabase/migrations/`
- Tested rollback SQL or a documented manual rollback procedure
- A note in the PR body identifying the migration as data-affecting

---

## 7. Governance applies to agents identically

MCP agent sessions (Claude, Pranix worker, etc.) follow the same
lifecycle. The agent does NOT:

- push to `main`
- create commits without a target branch existing first
- merge PRs
- distribute APKs directly
- bypass the founder review step

The agent DOES:

- Create branches via `github_create_branch` (when exposed)
- Apply patches via `github_apply_patch` (branch-scoped)
- Open PRs via `github_create_pr` (when exposed)
- Wait for CI results via `github_get_run_status` (when exposed)
- Notify the founder when a PR is ready for review

---

## 8. Out-of-band changes

If an emergency requires an out-of-band change (e.g. critical
security bug, secrets leak), the founder MAY commit directly to
`main` and is responsible for documenting the action in
`docs/QUIETKEEP_OUT_OF_BAND_LOG.md` within 24 hours. Agents have
no out-of-band path.

---

## 9. Source of truth

This document is the source of truth for QuietKeep development
governance. Inconsistencies between this document and any other
process file are resolved in favor of this document.

Amendments require a PR to this file, founder review, and merge.
