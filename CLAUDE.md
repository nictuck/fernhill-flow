# fernhill-flow

Fernhill product for intent 0001 — the Flow dashboard. The process is
`../../fernhill-platform/docs/flow.md`. The spec you build against is
`../../fernhill-platform/intent/0001-flow-dashboard/spec.md`; the plan is
`plan/0001-flow-dashboard.md`.

## Commands

- `make check` — build, test, lint; must pass before you say "done".
  Healthy output ends with `check: ok`.
- `make build` / `make test` / `make lint` — Vite build; Vitest; ESLint +
  `tsc --noEmit`.
- `make dev` — `netlify dev` on http://localhost:8888 with no token:
  fixture mode, served through the real functions and a local Blobs store.
- `make spike` — runs the live collector twice against the platform with
  the local `gh` login (token stays in the process env); rewrites
  `docs/baseline.md` and `tests/fixtures/000-live.json`.
- Staging: `https://main--fernhill-flow.netlify.app` (every merge).
  Production: `https://fernhill-flow.netlify.app` (the `production`
  branch, moved by the `release` workflow after the release manager
  approves).
- Rollback: fast — release manager publishes a previous deploy in Netlify
  (Deploys → pick one → Publish deploy); the board keeps rendering because
  snapshots are schema-versioned and keyed by deploy context; then press
  Refresh. Durable — revert PR on `main`, released through the gate.
  Rehearse the fast path on staging before the first release and note the
  result here.

## How it works

Static SPA (`src/`) + two Netlify Functions (`netlify/functions/flow.ts`
GET `/api/flow`, `refresh.ts` POST `/api/refresh` with `X-Flow-Refresh: 1`)
+ Netlify Blobs keyed by deploy context. The collector (`src/collector/`)
reads the platform's `main` and every repo in `flow.config.json`; the
engine (`src/engine/`, pure) derives stage, state, stuck and action in the
browser. `src/engine/types.ts` is the snapshot contract — bump
`SCHEMA_VERSION` on any shape change. Without a token the functions
round-trip `src/fixtures/sample.json` through the store, so previews and
`make dev` exercise the same path as production.

## Secrets and deploy-time config

| Name | Where | Contexts | Value | Expiry / rotation |
|------|-------|----------|-------|-------------------|
| `GITHUB_TOKEN` | Netlify env var | scopes `Production` and *Branch deploys → specific branch `main`* only — never all branch deploys, never deploy previews | fine-grained PAT, *Selected repositories* = platform + products, permissions Metadata, Contents, Pull requests, Actions: **read** (the collector reads run approvals, not `/deployments`) | ≤ 90 days; release manager rotates; recorded in `releases/` before the change |
| `PLATFORM_REPO` | Netlify env var (optional) | all | `owner/repo` of the platform; default `nictuck/fernhill-platform`; a malformed value refuses to refresh | n/a |

Adding a product repo = `scripts/new-product` on the platform **and** adding
the repo to the token's selected repositories.

## Stage skills

- `/plan 0001` — plan mode against the spec; writes `plan/0001-<slug>.md`;
  the engineer approves it before any code changes.
- `/fix <incident path or description>` — failing test first, then the fix;
  tests are read-only while the fix task is active.
- `/review <PR>` — tech-reviewer persona in fresh context; merges only
  under an active exception.

## Conventions

- Every change has a plan in `plan/`. Code commits that touch no plan file
  are blocked unless the message says `plan-unchanged` (hook).
- Branch per plan: `build/0001-<slug>`. One PR per plan.
- Tests prove requirements: name tests after the spec's `R1..Rn`.
- Never push to `main` or `production`, merge, approve, or start a
  `release` run. Hooks block it; the code owner and release manager do
  those in GitHub.
- Secrets only in Netlify env vars / GitHub Actions secrets. Never in the
  repo, never in a transcript, never in a log line.
- Keep this file under a page. Add a line under "Things Claude gets wrong"
  whenever a mistake repeats.

## Things Claude gets wrong here

- (none recorded yet)

## Verifying your work

Run `make check` and paste the last line. For UI changes, start `make dev`,
screenshot at 375 px and 1440 px (light and dark), compare against
`docs/mock/` or the spec, and say what differs. Before opening a PR, ask
the `verifier` subagent for a fresh-context check.
