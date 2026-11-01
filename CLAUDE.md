# {{SLUG}}

Fernhill product for intent {{INTENT}}. The process is
`../../fernhill-platform/docs/flow.md` (or the GitHub copy linked in
README). The spec you build against is
`../../fernhill-platform/intent/{{INTENT_DIR}}/spec.md`.

## Commands

- `make check` — build, test, lint; must pass before you say "done".
  Healthy output ends with `check: ok`.
- `make build` / `make test` / `make lint` — individually.
- `make dev` — run locally.
- Staging: `https://main--{{SITE}}.netlify.app` (every merge). Production:
  `https://{{SITE}}.netlify.app` (the `production` branch, moved by the
  `release` workflow after the release manager approves).
- Rollback: fast — release manager publishes a previous deploy in Netlify
  (Deploys → pick one → Publish deploy); durable — revert PR on `main`,
  released through the gate. Rehearse the fast path in staging before the
  first release and note the result here.

Until the first plan configures the stack, these targets print TODO and
pass. Configuring them is step one of the first plan. The publish
directory is named in three places that move together: `netlify.toml`
(`publish` and the `version.txt` path in `command`) and `.sdlc.yaml`
(`publish_dir`).

## Stage skills

- `/plan {{INTENT}}` — plan mode against the spec; writes `plan/{{INTENT}}-<slug>.md`;
  you approve it before any code changes.
- `/fix <incident path or description>` — failing test first, then the fix;
  tests are read-only while the fix task is active.

## Conventions

- Every change has a plan in `plan/`. Code commits that touch no plan file
  are blocked unless the message says `plan-unchanged` (hook).
- Branch per plan: `build/{{INTENT}}-<slug>`. One PR per plan.
- Tests prove requirements: name tests after the spec's `R1..Rn`.
- Never push to `main` or `production`, merge, approve, or start a
  `release` run. Hooks block it; the code owner and release manager do
  those in GitHub.
- Secrets only in GitHub Actions secrets / Netlify env vars. Never in the
  repo, never in a transcript.
- Keep this file under a page. Add a line under "Things Claude gets wrong"
  whenever a mistake repeats.

## Things Claude gets wrong here

- (none recorded yet)

## Verifying your work

Run `make check` and paste the last line. For UI changes, start `make dev`,
take a screenshot, compare against the spec or mock, and say what differs.
Before opening a PR, ask the `verifier` subagent for a fresh-context check.
