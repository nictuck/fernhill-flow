# Review of PR #2 — Flow dashboard v1 (2026-11-01)

`/review` on `nictuck/fernhill-flow` #2: four fresh-context subagents — the
`verifier` (template agent), then the `tech-reviewer`, `security-lead` and
`ux` personas — against head `e3b4ac1`. Verdicts: verifier *not ready (1)*,
tech-reviewer *address first (4 Important)*, security *address first
(2 Important)*, ux *address first (4 Important)*. Every Important was taken;
dispositions follow each finding. The re-check after the fixes is appended
at the end.

## Verifier

`make check` → `check: ok` (23 files / 287 tests, ESLint + tsc clean). Every
Acceptance row passes or is a staging/release-time check, except one clause
of **R15**: "a refresh that doubles the baseline logs a warning" was promised
in `docs/baseline.md` and the plan but not implemented. — **Fixed:**
`BASELINE_CALLS = 31` in `refresh-core.ts`; above 2× the log line carries
`budgetWarning` and the snapshot carries the warning (shown on Systems); test
in `R17_refresh`. Also: diff vs plan — extras `netlify/lib/fixture.ts`,
`tests/engine/scenarios.ts`, `tests/engine/schema.test.ts`,
`tests/ui/useFlow.test.tsx` (added to the plan's Files table); no planned
file missing; `.claude/` and `.github/` untouched. Deploy preview probed
separately (comment on the PR): fixture served from Blobs under
`deploy-preview/`, header gate 400, SPA fallback, `version.txt` = head.

## Tech-reviewer — address first

- [Important] `collect.ts` — the 90-day PR window also dropped merged
  product `build/*` PRs; 91 days after a release a Live intent would regress
  to Build "stuck". — **Fixed:** merged build PRs are never dropped by age;
  test with a PR merged 91 days ago.
- [Important] `derive.ts` — Maintain clock was the merge time; flow.md row 6
  says production deployment, and the card said "Live since ‹merge›". —
  **Fixed:** clock = the release run's approval (fallback run start,
  then merge); test added.
- [Important] R15 warning not in the pushed head. — **Fixed** (above).
- [Important] `collect.ts` — an open spec PR was recorded with `flagged: 0`,
  so "Accept spec NNNN (N concerns open)" could never show N live. —
  **Fixed:** `flagged` is read from `spec.md` at the PR head through the
  same validator, display-only (one call per open spec PR); test added.
- Nits taken: Test stuck clocks now use the head's first check-run start
  (GitHub's `updated_at` is bumped by comments); `approvedAt` read from
  `environments[].created_at`; one `incidentSlug` and one `plural`; plan
  Files table completed; the two Derivation rows the build needed ("Approve
  plan ‹path›", "Release run #N failed") added to the spec amendment #7.
  Carried: `previous.json` is written and never read (kept for rollback
  diagnosis); `onMain` is always true today.

## Security-lead — address first

- [Important] `store.ts` — the Blobs store was site-wide, so a (fork)
  deploy preview running the PR's own function code could write
  `production/latest` and production would serve it. — **Fixed:** only
  `production` and `branch-deploy` use the site store; every other context
  uses the deploy-scoped store (`getDeployStore`), wiped with the deploy;
  test asserts previews never reach the site store. Netlify's fork-preview
  policy on the site is already "require approval".
- [Important] `refresh-core.ts` — the floor applied only after a successful
  refresh; after a bad token or slow GitHub every POST past the lock re-ran
  a full collection. — **Fixed:** floor on `max(latest.collectedAt,
  lastError.at)`, read before the lock; test: a refresh within 60 s of a
  failed one makes no call and no write.
- Nits taken: the raw `PLATFORM_REPO` value is no longer echoed; the ETag
  cache stores bodies only up to 64 KiB and is not rewritten on failure;
  the token drops `Deployments: read` and the Netlify scopes are named
  precisely (CLAUDE.md and spec amendment #7). Carried: `SDLC_ENV` comes from
  the template and is unused here; Dependabot is a guardrail-path PR for
  the code owner.
- Verified clear: token never in responses or logs; trust rule (config from
  `main` only, owner must match `PLATFORM_REPO`, forks untrusted, 40-hex
  `version.txt`); destinations fixed to api.github.com and the configured
  sites; YAML core schema, strict, no prototype pollution; header gate forces
  a preflight; deps exact, `ignore-scripts=true`, all from the npm registry.

## UX — address first

- [Important] intent header placed the stage label inside the state line.
  — **Fixed:** badge · rest · stuck · stage.
- [Important] fixture mode re-stamped `collectedAt` with the server clock
  so every age clamped to 0 days — no stuck card ever appeared in previews
  or screenshots. — **Fixed:** the fixture's timestamps are shifted to
  "now" (`netlify/lib/fixture.ts`); screenshots retaken.
- [Important] "Waiting on on-call for 11 days" next to a 0-day incident row
  — the wait text counted from the stage clock while the limit counted
  from the incident. — **Fixed:** `Derived.waitDays` is the number both
  the text and the limit use; the stage clock stays for time-in-stage.
- [Important] `overflow-wrap: anywhere` on table cells broke repo names
  mid-word at 1440. — **Fixed:** `break-word` on cells, `anywhere` only on
  shas and URLs.
- Nits taken: stage-detail stuck wording, phone Done toggle "Show"/"Hide"
  without double listing, `aria-controls` only when present, pending
  timeline entries say "open", Systems uses `now`.
- Verified: all ten copy strings verbatim and tested; every mock
  disposition landed; badges carry text; keyboard reachability; 375
  layouts stack without overflow; new color pairs ≥ 5:1.

## Re-check

_(appended after the fixes)_
