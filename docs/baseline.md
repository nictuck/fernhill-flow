# R15 baseline — live collector

Captured 2026-11-01T21:13:28.515Z by `make spike` (plan step 1) against `nictuck/fernhill-platform`.
Repos in `flow.config.json` on main: `fernhill-platform`, `fernhill-flow`
(2). Two runs back to back: cold ETag cache, then warm.

## Calls per source

| Source | First run (cold) | Second run (warm) |
|--------|-----------------:|------------------:|
| tree/blobs | 11 | 11 |
| PRs | 4 | 4 |
| check-runs | 3 | 3 |
| commits | 0 | 0 |
| repos/branches | 8 | 8 |
| compares | 2 | 2 |
| runs/approvals | 3 | 3 |
| other | 0 | 0 |
| **GitHub total** | **31** | **31** |
| Sites (`version.txt`, no auth, not rate-limited) | 4 | 4 |

## First vs second run

| | First run (cold) | Second run (warm) |
|---|---:|---:|
| GitHub calls | 31 | 31 |
| 304 responses (cached) | 0 | 31 |
| 304 rate (cached/calls) | 0% | 100% |
| `x-ratelimit-remaining` before → after (`/rate_limit` probe) | 5000 → 4972 | 4972 → 4972 |
| Consumed (probe difference) | 28 | 0 |
| `x-ratelimit-remaining` header on the last response (what the refresh log carries) | 4981 | 4981 |
| Wall time | 2597 ms | 2384 ms |
| Wall time vs 8000 ms budget | 32% | 30% |
| Snapshot size | 9831 bytes | 9831 bytes |

## Budget rule (R15)

The baseline is **31 GitHub calls** per cold refresh. A refresh that
doubles it (> 62 calls) logs a warning. The hard cap stays at 200.

## Recommendation: sync or background function

Both runs finished well inside the 8000 ms budget (slowest 2597 ms), so `refresh` stays a synchronous function. Revisit when a second product repo lands: each repo adds roughly 16 calls.

## Warnings (first run)

- site https://fernhillplatform.netlify.app: HTTP 404

## Fixture

`tests/fixtures/000-live.json` is the first snapshot (9831 bytes).
No string contained `@`; nothing was stripped.
