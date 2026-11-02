---
intent: "0001"
status: approved
approved_by: "agent under EX-002"
---

# Plan: Flow dashboard v1

Implements `fernhill-platform/intent/0001-flow-dashboard/spec.md`
(accepted 2026-11-01) in this repo. One branch, `build/0001-flow-dashboard`,
one PR, one commit per step below; the PR body lists the Proof results.
Reviewed at the plan gate by the tech-lead persona
(`docs/reviews/0001-plan-tech-lead.md`, approve with changes — all taken)
and, for step 0, by the UX persona (`docs/reviews/0001-mock-ux.md`).

## Files that change

New, by area:

| Area | Files |
|------|-------|
| Stack | `package.json`, `package-lock.json`, `.npmrc` (`ignore-scripts=true`, `save-exact=true`), `.nvmrc` (24), `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `index.html`, `src/vite-env.d.ts`, `.gitignore` additions |
| Mock (step 0) | `docs/mock/index.html`, `docs/mock/mock.css`; reviews in `docs/reviews/` |
| Engine (pure, no deps) | `src/engine/types.ts` (Snapshot schema, `SCHEMA_VERSION`, `THRESHOLD_KEYS`), `derive.ts` (state machine), `text.ts` (state line, `stateParts`), `time.ts` (UTC day arithmetic, `needsRefresh`, `isStale`), `needsYou.ts`, `systems.ts`, `archive.ts` (+ `board`), `timeline.ts`, `stages.ts`, `links.ts` (the only link allowlist), `index.ts` |
| Collector | `src/collector/github.ts` (REST client: token, 5 s per-call timeout, 8 s deadline, 1 MiB cap, persisted ETags, 200-call cap, call log), `frontmatter.ts` (`yaml` on the `---` block only, typed validators), `classify.ts` (branch first, files fallback, `permission` by path), `validate.ts` (trust rule: config from `main` only, repo/site shapes, `version.txt` shape), `collect.ts` |
| Functions | `netlify/lib/store.ts` (Blobs: site store for `production`/`branch-deploy`, deploy-scoped store for every other context; `latest`/`previous`/`lock`/`etags`/`last-error`), `netlify/lib/refresh-core.ts` (floor incl. after failures, lock, collect, store, log line, R15 budget warning), `netlify/lib/fixture.ts` (no-token collector, timestamps shifted to now), `netlify/functions/flow.ts`, `netlify/functions/refresh.ts` |
| UI | `src/main.tsx`, `src/App.tsx`, `src/router.ts`, `src/api.ts`, `src/screens/{Board,Intent,Systems,Archive}.tsx`, `src/components/*`, `src/styles.css`, `src/fixtures/sample.json` |
| Spike | `scripts/spike.ts` → `docs/baseline.md`, `tests/fixtures/000-live.json` |
| Tests | `tests/helpers/{build,setup,memoryStore,fakeGithub,render}.ts(x)`, `tests/engine/*` (+ `scenarios.ts` builders, `schema.test.ts`), `tests/collector/*`, `tests/functions/*`, `tests/ui/*` (+ `useFlow.test.tsx`) (names in Proof) |
| Evidence | `docs/screenshots/*.png`, `docs/reviews/0001-pr-review.md` (verifier + three persona reviews with dispositions) |
| Repo config | `Makefile`, `netlify.toml`, `.sdlc.yaml` (`stack`), `CLAUDE.md` (inventory, dev notes), `README.md` |

Edited: `Makefile`, `netlify.toml`, `.sdlc.yaml`, `CLAUDE.md`, `README.md`,
`.gitignore`. Nothing under `.claude/` or `.github/` changes (Dependabot's
`.github/dependabot.yml` is a guardrail-path file; it goes in its own PR
for the code owner to merge).

## The snapshot (contract, frozen in step 2)

`src/engine/types.ts` is normative. Top level: `schemaVersion`,
`collectedAt`, `config` (`github_owner`, `platform_repo`, `repos[]`,
`thresholds` — exactly the ten `THRESHOLD_KEYS` —, `refresh`, `board`),
`platform` (`intents[]` with status, `acceptedAt` from the intent PR,
`statusSetAt/By` from the last commit to `intent.md`, `prNumber/prOpenedAt`
for intents that exist only on an open PR — built from branch name and PR
title, never file content —, `spec` with status/flagged/`acceptedAt`/open
PR; `exceptions[]` with `granted`/`expires`; `incidents[]`; `personas[]`),
`repos[]` (per configured repo: `mainHead`, `mainCi`, `productionHead`,
`productionBehindMain {count, since}`, `staging`/`production` served sha,
classified `prs[]` with `ci`, `mergedBy`, `inProduction`, `servedLive`;
`plans[]`; `releaseRuns[]` with `pendingApproval`/`approvedBy`;
`buildBranches[]`; `error`), `stats` (`calls`, `cached`, `durationMs`,
`rateLimitRemaining`), `warnings[]`. Every engine function takes `now`
(ISO); no test reads the wall clock.

## Order of work

Each step ends in a runnable check; `make check` prints `check: ok` from
step 1 on. Code commits touch `plan/` or say `plan-unchanged`.

0. **Mock.** `docs/mock/`: the card in each state (light/dark, with and
   without Stuck), Board at 375 and 1440 both populated and "nothing
   waits", Needs you, freshness strip (loading + four states), error
   screen, empty board, Systems at both widths, timeline entries. UX
   persona reviews it in a fresh subagent; findings folded in before step
   4 starts. **Done:** review and disposition in `docs/reviews/`.
1. **Stack and spike.** Exact-version dependencies; `.npmrc`
   `ignore-scripts=true` verified against `vite build` (esbuild's binary
   is an optional dependency — no install script needed; confirmed); real
   Makefile; `netlify.toml` with `[functions]`, `/api/*` redirects before
   the SPA fallback, `NODE_VERSION=24`. Spike = the full collector of step
   3 run twice against the live platform (`GITHUB_TOKEN` from `gh auth
   token` in the process env only): cold, then with the ETag cache.
   `docs/baseline.md` records calls per source, total, `cached/calls`,
   `x-ratelimit-remaining` before/after, wall time of each run against
   the 8 s budget, snapshot size, warnings, and the sync/background
   decision (below). `tests/fixtures/000-live.json` = the cold snapshot
   (logins only). Check: `check: ok`; `docs/baseline.md` exists.
2. **Engine.** Freeze `types.ts`. `derive.ts` implements flow.md's table
   in the order Done → Maintain → Deploy → Test → Build → Design → Plan on
   the intent's latest same-repo `build/NNNN-*` PR, with the per-stage
   clock, Stuck from `thresholds`, waiting-on role, and the action copy and
   link target exactly as the spec's Derivation table. Day arithmetic: UTC,
   `days = floor(whole days since clock)`, `stuck = days > limit` (at the
   limit is not stuck). `board.done_days` drops Done cards. `text.ts`
   produces the spec's state lines and `stateParts` (badge · rest · stuck
   badge) so the UI cannot drift. `needsYou.ts` groups by role, stuck
   first then oldest, one row per open incident under on-call, no double
   listing. `systems.ts` produces the R7 lines. `timeline.ts` builds the
   R5 entries (who/when, CI, dismissed-incident reason, "under EX-NNN" on
   merges inside an exception's `granted`–`expires` window). `stages.ts`
   gives stage detail with median/max only at n ≥ 5. `links.ts`:
   `safeHref` accepts only `https://github.com/<owner>/…` and the
   configured sites; every rendered href passes through it. Check: `make
   test` green; the coverage test fails if a threshold key is unused or a
   condition has no key.
3. **Collector and functions.** Sources → endpoints (calls per refresh,
   `P` = platform, `R` = each configured repo, `o` = open PRs,
   `m` = recently merged build PRs):

   | Snapshot field | Endpoint | Calls |
   |---|---|---|
   | tree, `flow.config.json`, `intent/*/{intent,spec}.md`, `incidents/*`, `exceptions/*`, `personas/*` | `GET /git/trees/main?recursive=1`, `GET /git/blobs/{sha}` | P: 1 + files (304 when unchanged) |
   | `prs[]` (class, state, dates, head, same-repo) | `GET /pulls?state=all&sort=updated&per_page=100` | 1 per repo |
   | `pr.ci`, `ciUrl` | `GET /commits/{sha}/check-runs` (+ `/status` only when no check-runs) | 1 per open PR |
   | `pr.class` fallback | `GET /pulls/{n}/files` | only unclassifiable branches |
   | `mergedBy` (gate 1/2/4 evidence) | `GET /pulls/{n}` | merged intent/spec/build PRs ≤ 90 d, cap 20 |
   | `acceptedAt`, `spec.acceptedAt` | from the merged `intent/`, `design/` PRs | 0 |
   | `statusSetAt/By` (done/parked/rejected) | `GET /commits?path=intent/{dir}/intent.md&per_page=1` | 1 per such intent |
   | `mainHead`, `productionHead` | `GET /branches/main`, `GET /branches/production` | 2 per repo |
   | `mainCi` | `GET /commits/{main}/check-runs` | 1 per repo |
   | `productionBehindMain` | `GET /compare/production...main` | 1 per repo |
   | `plans[]` | tree + blobs; `createdAt` via `GET /commits?path=` | files + 1 per plan (cap 10) |
   | `buildBranches[]` | `GET /branches?per_page=100`, `GET /commits?sha=&per_page=1` | 1 + 1 per build branch (cap 10) |
   | `releaseRuns[]` | `GET /actions/workflows/release.yml/runs?per_page=10`; `approvals` for the newest 3 successes | 1 + ≤ 3 per repo |
   | `pr.inProduction`, `pr.servedLive` | `GET /compare/production...{merge}`; `GET /compare/{served}...{merge}` | ≤ 2 per m (cap 10) |
   | `staging.version`, `production.version` | `https://main--<site>.netlify.app/version.txt`, `https://<site>.netlify.app/version.txt` (no auth) | 2 per repo, not GitHub |

   Expected steady state for the two repos today: ~35 GitHub calls cold,
   most 304 when nothing changed. `github.ts`: 5 s per call, 8 s overall
   deadline, 1 MiB body cap, `If-None-Match` from the persisted `etags`
   map, 200-call cap, structured call log (paths and status only).
   `frontmatter.ts` rejects anything outside the documented shapes; one
   bad artifact is a warning, never a failed refresh. `validate.ts`:
   config only from the platform's `main`; `PLATFORM_REPO` (env, default
   `nictuck/fernhill-platform`, validated `^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`,
   malformed → refuse to refresh) is the trust anchor; `version.txt`
   accepted only as 40 hex chars. `store.ts`: key prefix from the
   request's `context.deploy.context` (env `CONTEXT` fallback; neither →
   500, never a shared default); lock = `set(onlyIfNew)`, on failure read
   `{value, etag}` and, if expired (90 s), `set(onlyIfMatch: etag)`, else
   in-flight; `delete` on release; snapshots with another `schemaVersion`
   are treated as absent. `refresh-core.ts`: header, floor
   (`refresh.floor_seconds`), lock, collect (repos in parallel, under the
   deadline; abort keeps the previous snapshot), store, one JSON log line
   (trigger, IP, outcome, calls, cached, duration, remaining, snapshot
   time, error). `flow.ts`: serve `latest`; none → refresh inline;
   respond `stale` = age > `refresh.interval_minutes`. **No token** (deploy
   previews, `make dev`): both functions still run `refresh-core` with a
   fixture collector, so every preview round-trips Blobs, the lock and
   `schemaVersion` under its own prefix and returns the fixture read back
   from the store. Pre-decided fork: if the spike's cold run exceeds 6 s,
   `refresh` becomes a background function (202) and `flow` returns
   `{ snapshot: null, refreshing: true }` for the UI to poll. Check:
   function tests green; `make dev` serves `/api/flow` in fixture mode
   from the store.
4. **UI.** Four routes against the corrected mock. Board: Needs you first
   (who = link, action = link or command + View link, meta = days + stuck
   badge), exception strip, seven stage sections with in-place detail
   (stats only at n ≥ 5), Done footer, freshness strip with a Refresh
   control in every state that can fail. Card: state badge · rest · stuck
   badge from `stateParts`; CI red badge only. Intent: timeline from
   `timeline.ts`. Systems: table / complete phone cards. Archive.
   Revalidation is client-triggered: `needsRefresh` (> interval) fires a
   background POST with `X-Flow-Refresh: 1` and re-fetch; `isStale`
   (> 3 × interval) shows the Stale copy; the previous snapshot stays
   visible while refreshing. Document title carries the Needs-you count.
   Every href through `safeHref`. Touch targets ≥ 32 px. Check: R9/R12
   smoke tests; screenshots at 375 and 1440, light and dark, in the PR.
5. **Hardening and docs.** The spec's copy strings verbatim; `CLAUDE.md`
   secrets/config inventory (`GITHUB_TOKEN`, `PLATFORM_REPO`) and dev
   notes; `README.md`; `.sdlc.yaml` stack. Re-run the spike (second
   baseline). `verifier` subagent; fix; `make check`. Open the PR with
   Proof results, both baselines and the review dispositions. Open the
   platform spec-amendment PR (three sentences: client-triggered
   revalidation in Design/Shape, link allowlist location in R18, the
   loading-state copy row) for the product owner.

## Risks

- **Riskiest step: 3** — Blobs conditional writes, the deploy-context
  prefix and the token path first meet Netlify in a deploy. De-risked:
  `onlyIfNew`/`onlyIfMatch` confirmed in the installed `@netlify/blobs`
  types before any code; the store is behind an interface with an
  in-memory twin for the race tests; and the no-token path goes through
  the real store, so the first PR's deploy preview exercises Blobs, lock,
  `schemaVersion` and the prefix before anything reaches `main`.
- **Function time limit.** Sync functions get 10 s; collection is bounded
  at 8 s with parallel repos and conditional requests, and the spike
  measures the cold path; the background-function fork is pre-decided.
- **Rate limit.** A looping collector would spend the account's shared
  budget. Mitigations: 200-call cap, 60 s floor, single-flight, persisted
  ETags (304s are free), the R15 warning when a refresh doubles the
  baseline.
- **Wrong derivation.** A lying board is worse than a down board.
  Mitigations: a fixture per row and per threshold, R2 action cases,
  fixture 000 hand-checked against GitHub on capture day (the check is
  written into the PR).
- **Token or config in the wrong place.** `GITHUB_TOKEN` is scoped by a
  person to `production` and `main` branch-deploy; code never reads it in
  preview; `PLATFORM_REPO` is validated; the acceptance walkthrough checks
  a preview shows the fixture banner.
- **`ignore-scripts=true`.** Verified in step 1: build, test and lint pass
  with it on.
- **Scope creep.** Out of scope per the spec: write paths, login,
  notifications, Netlify API. Anything the mock suggests beyond the spec
  is a new intent.

Rejected: a scheduled refresh (spec decision); a client-side GitHub fetch
(token in the browser); React Router (a 40-line pushState router, revisit
if routes grow); server-side derivation in the function (the engine is
pure and small; running it in the browser keeps the stored snapshot raw
and schema-versioned, and makes fixture mode identical to live mode — the
R18 link allowlist therefore lives in the engine and is tested there);
server-initiated stale-while-revalidate (a sync Netlify function cannot
keep working after it responds — the client fires the revalidation; spec
amended); two plans/PRs (a solo engineer gains nothing from two approvals
and the preview round-trip gives the early platform signal the split was
meant to buy).

## Proof

Tests, named after the spec's requirements:

| Test | Proves |
|------|--------|
| `tests/engine/R1_stage_rows.test.ts` | one case per flow.md row and sub-condition incl. Done window and archive |
| `tests/engine/R2_actions.test.ts` | one case per Derivation-table row: exact copy, link vs copyable, secondary link |
| `tests/engine/R3_thresholds.test.ts` | each key: at the limit not stuck, one day over stuck |
| `tests/engine/R3_coverage.test.ts` | thresholds ⇄ conditions, both directions |
| `tests/engine/R4_needs_you.test.ts` | grouping, stuck-first then oldest, hidden empty groups, incident rows, no double listing, counts |
| `tests/engine/R5_timeline.test.ts` | who/when, CI, dismissed reason or "no reason recorded", "under EX-NNN" inside the exception window |
| `tests/engine/R6_stage_detail.test.ts` | n = 4 no stats, n = 5 stats |
| `tests/engine/R7_systems.test.ts` | matches / behind / rollback / unknown / repo error lines |
| `tests/engine/R11_fixture_000.test.ts` | the live snapshot derives to the hand-checked expectation |
| `tests/engine/R13_archive.test.ts` | ordering, final status, when, by whom |
| `tests/engine/R18_links.test.ts` | other owner, `..`, foreign site, bad scheme → no link |
| `tests/engine/text.test.ts` | the exact state-line strings and `stateParts` |
| `tests/collector/R18_trust.test.ts` | malformed frontmatter skipped, fork PR untrusted, crafted config ignored, bad `version.txt` rejected |
| `tests/collector/R19_bounds.test.ts` | hang → timeout; oversized body; call cap; deadline; token and rate-limit classification |
| `tests/collector/classify.test.ts` | branch names → classes, `permission` by path, files fallback |
| `tests/collector/collect.test.ts` | canned platform + repo → expected Snapshot |
| `tests/functions/R17_refresh.test.ts` | floor = zero calls; two concurrent → one collection; expired-lock takeover race; header; method; malformed `PLATFORM_REPO` refuses |
| `tests/functions/R8_flow.test.ts` | `stale` at the interval boundary; schema mismatch → refresh; no token → fixture through the store; `no-store`; missing deploy context → 500 |
| `tests/ui/R9_states.test.tsx` | every screen in loading/empty/error/stale/refreshing/fixture/populated with the spec's copy; `needsRefresh` vs `isStale` boundaries |
| `tests/ui/R12_keyboard.test.tsx` | tab reaches every action; every badge has text |
| `tests/ui/router.test.tsx` | four routes, `?stage=` |

Manual, recorded in the PR body: screenshots at 375/1440 light/dark vs
the mock (R12); `make dev` fixture mode from the store (R10);
`docs/baseline.md` cold and warm (R15). On staging before release
(release record): R2 links resolve against the real repos, R4–R7
walkthrough, R8 refresh, R16 threshold change with no deploy, R14
rollback rehearsal, preview deploy shows the fixture banner (R10) —
`fernhill-flow` must be in `flow.config.json → repos[]` and in the
token's selected repositories first.
