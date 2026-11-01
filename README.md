# Flow dashboard

A Fernhill Software product. Built from intent
[0001](https://github.com/nictuck/fernhill-platform/tree/main/intent/0001-flow-dashboard).

| | |
|---|---|
| Staging | https://main--fernhill-flow.netlify.app (every merge to `main`) |
| Production | https://fernhill-flow.netlify.app (the `production` branch) |
| Process | [fernhill-platform/docs/flow.md](https://github.com/nictuck/fernhill-platform/blob/main/docs/flow.md) |

## Develop

```bash
make check      # build + test + lint, what CI runs
make build
make test
make lint
```

## Ship

Merging to `main` deploys **staging** automatically (Netlify branch
deploy). The `release` workflow then waits at the `production` environment
until the release manager approves; on approval it fast-forwards the
`production` branch, which Netlify publishes as **production**. Rollback:
see CLAUDE.md.
