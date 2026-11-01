# Flow dashboard

Where every Fernhill idea is in the six-stage loop — Plan, Design, Build,
Test, Deploy, Maintain — whether it is moving, waiting on a person, or
stuck, and what that person must do next. Read-only: it derives everything
from git and GitHub and links out to the place the human already acts.

Intent 0001 of [fernhill-platform](https://github.com/nictuck/fernhill-platform);
spec: `intent/0001-flow-dashboard/spec.md` there; plan:
[`plan/0001-flow-dashboard.md`](plan/0001-flow-dashboard.md).

| Route | Answers |
|-------|---------|
| `/` Board | What is waiting on me, and is anything stuck? Needs you by role, seven stage sections, active exceptions, snapshot freshness |
| `/intent/NNNN` | Where is this idea and what happened to it? The timeline of gates, PRs, runs and incidents |
| `/systems` | What is running where, and is production behind? Per repo: staging and production commits, last release, CI, incidents |
| `/archive` | What did we decide not to do, or finish? |

## Run it

```
npm ci
make dev        # http://localhost:8888 — fixture data, no token needed
make check      # build + test + lint
```

Staging is `https://main--fernhill-flow.netlify.app` (every merge to
`main`); production is `https://fernhill-flow.netlify.app` (the `production`
branch, moved by the `release` workflow after approval).

## How it works

```
Browser (static SPA) ──GET /api/flow──────▶ Function: flow     ─┐  Netlify Blobs
                     ──POST /api/refresh──▶ Function: refresh  ─┘  (per deploy context)
                        X-Flow-Refresh: 1       │ floor · single-flight · GitHub REST (read-only PAT)
                                                │ collect → validate → store snapshot
```

The stored snapshot is raw and schema-versioned; the derivation engine
(`src/engine/`, pure TypeScript) turns it into stages, states and actions
in the browser, from the rules in the platform's `docs/flow.md` and the
thresholds in its `flow.config.json`. Without a token (deploy previews,
local dev) the functions serve `src/fixtures/sample.json` through the same
store.

Layout: `src/engine` (rules), `src/collector` (GitHub + sites),
`netlify/` (functions and the store), `src/screens` + `src/components`
(UI), `tests/` (one test file per spec requirement), `docs/mock` (the
step-0 mock), `docs/reviews` (persona reviews), `docs/baseline.md` (the
measured API budget).
