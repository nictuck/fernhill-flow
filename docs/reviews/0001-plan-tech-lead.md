# Tech-lead persona review — plan 0001 (2026-11-01)

Fresh-context subagent running `fernhill-platform/personas/tech-lead.md`
against `plan/0001-flow-dashboard.md`, the accepted spec, flow.md and
the template. Verdict: **plan: approve with changes**. Disposition after
each finding is the plan author's; the plan file carries the result.

## Important

1. **No endpoint table.** `merged_by` needs `GET /pulls/{n}`; the gate-5
   approver is `GET /actions/runs/{id}/approvals` and "pending" is
   `pending_deployments`/run status `waiting`; "merge commit in
   production" and "served live" are `compare` calls; "N commits behind
   (since)" is `compare/production...main`. The spike must hit every row
   or the R15 baseline is fiction. — **Taken:** Sources → endpoints table
   added to step 3; the spike runs the full collector twice (cold, then
   with the ETag cache) and records both.
2. **Snapshot shape absent from the plan.** — **Taken:** one line per
   top-level field in step 2; `src/engine/types.ts` is the normative copy;
   every engine function takes `now`.
3. **`PLATFORM_REPO` missing** (R16 names it as deploy-time config; it is
   the trust anchor). — **Taken:** read in `refresh-core` only, validated
   `^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`, default `nictuck/fernhill-platform`,
   in the secrets/config inventory, malformed value refuses to refresh
   (tested).
4. **No time budget; collection inside a GET at cold start.** — **Taken:**
   8 s budget, repos collected in parallel, abort keeps the previous
   snapshot; the spike records wall time; pre-decided fork: if the cold
   run exceeds 6 s, `refresh` becomes a background function and `flow`
   never collects inline.
5. **Stale-while-revalidate departs from the spec and conflates two
   thresholds.** — **Taken:** `needsRefresh` (> interval) and `isStale`
   (> 3 × interval) are two functions in `time.ts`, both tested;
   client-triggered revalidation recorded under Rejected with the reason
   (a sync function cannot work after responding); a one-line spec
   amendment goes to the platform as its own PR.
6. **Browser-side derivation moves R18's link construction.** —
   **Taken:** `src/engine/links.ts` is the only place a link is accepted
   (allowlist: `https://github.com/<owner>/…` and the configured sites);
   `R18_links` test; same spec amendment PR.
7. **Proof gaps (R2, R5, R6, R13, R16, R19).** — **Taken:**
   `timeline.ts`, `stages.ts`; tests `R2_actions`, `R5_timeline`,
   `R6_stage_detail`, `R13_archive`, `R18_links`, allowlist case in
   `R19_bounds`; manual list gains R4–R7 and R16.
8. **ETag cache was in-memory** (function instances are short-lived). —
   **Taken:** persisted in the store under `etags`; the log line and the
   baseline report `cached/calls`.
9. **One PR means Blobs/`CONTEXT`/the token path first run after merge;
   `process.env.CONTEXT` is build-time.** — **Taken:** (a) the no-token
   path goes through `refresh-core` → store with a fixture collector, so
   every deploy preview round-trips Blobs, the lock and `schemaVersion`
   under the `deploy-preview` prefix; (b) the prefix comes from the
   request's `context.deploy.context` with env fallback and no shared
   default. (c) Two plans was considered and rejected: a solo engineer
   gains nothing from two approvals, and (a) gives the early platform
   signal the split was meant to buy.

## Nits (all taken)

Node 24 pinned for Netlify (`[build.environment]` + `.nvmrc`); lock
takeover sequence (`onlyIfNew`, then `onlyIfMatch` on an expired lock)
written into step 3; `[functions]` directory, bundler and `/api/*`
redirects before the SPA fallback; per-file vitest environments; day
arithmetic pinned (UTC, floor, stuck = days > limit); process notes
(plan-sync wording, explicit UX invocation at step 0, Dependabot is a
guardrail-path file a human merges — follow-up PR, staging walkthrough
needs `fernhill-flow` in `repos[]` and in the token's repositories).
