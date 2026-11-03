# Plan review: 0002 One place to run the loop — tech-lead persona (2026-11-03)

Fresh-context subagent given `personas/tech-lead.md`, the draft plan, spec
0002, the product code, the platform (validator, hooks, workflows, flow.md,
EX-002) and the template. Report, verbatim:

> **Tech lead — plan gate, intent 0002**
>
> Read the plan against spec R1–R20, the product code (`collect.ts`, `refresh-core.ts`, `refresh.ts`, `store.ts`, `validate.ts`, `needsYou.ts`), the platform (`validate-artifacts`, `no-merge.sh`, `check.yml`, `release.yml`, `flow.md`, EX-002) and the template. Coverage is good: every R has a step and a proof row; flow.md is first; contracts freeze before UI. Findings:
>
> - `[Important]` **Gate 1/2 precondition is unsatisfiable.** `check.yml` runs `make check ARGS="--target main"` on every PR into `main`, and the validator fails `status: proposed` — so `check` is red on every intent/spec PR until the flip. `intent.decide`/`spec.accept` requiring "`check` green on head" can never pass. — Drop the pre-flip check; let GitHub auto-merge gate on the post-flip check (that is its job); amend the spec table in the same PR.
> - `[Important]` **Spike is too late and under-provisioned.** It sits in step 4 behind mock, P1, T1 and schema 2, though it needs only the App and a throwaway endpoint. `enablePullRequestAutoMerge` also needs the repo setting *Allow auto-merge* on `fernhill-platform`, which no step sets. — Make the spike the first code step after the App exists; add the repo setting to step 2 (human) with a compliance row; record both in the release record.
> - `[Important]` **Decide `roles.json` now.** `gh pr view --json files` gives paths only; hunk-grepping `flow.config.json` for `roles` false-negatives when context lines hide the block. The plan already names the fallback. — Take it: `roles.json`, path-based in `GUARDRAIL_PATHS`, ownable in `CODEOWNERS`; spec amended in P1.
> - `[Important]` **`Trigger "action"` is header-controlled.** `refresh.ts` reads the trigger from `X-Flow-Trigger`; any client can skip the floor and burn the rate limit. — Honour `action` only after unsealing a valid session cookie (or a one-shot store key written by `act`).
> - `[Important]` **One product PR is too large.** Eight steps, six new functions, ~20 test files. Step 3 (schema 2, roles, `next_steps`, engine) is read-only and independently shippable, and isolates the one-time v1→v2 snapshot loss. — Two PRs: schema/engine first, auth+actions+UI second. Reviewer kit: commit-per-step, PR body mapping steps→commits→Proof rows.
> - `[Important]` **`release-gate.sh` must travel.** `release.yml` is synced to the template and products; extracting logic to `.github/scripts/release-gate.sh` without adding it to `scripts/sync-template` and T1 breaks every product release on day one. — Add it to the sync list; T1 proves it.
> - `[Important]` **Spike cleanup owns no step.** The `spike` callback URL and allowed branch are "for the window" but nothing removes them. — Make their removal a condition the validator or release record requires before `authorized`.
> - `[Nit]` CSRF = HMAC(key, session id) but the sealed payload has no id — add a random one. AAD = deploy context, yet `main` and `spike` both are `branch-deploy` with one `SESSION_KEY` — use the site host.
> - `[Nit]` `TRIAL_INTENTS = ["0002"]` hard-codes an id into a mechanism — key on a frontmatter field (`trial: required`) that `/release` writes from the spec.
> - `[Nit]` "Validator fails on planted drift" has no harness; give `validate-artifacts` a `--test` with fixtures like the hooks.
> - `[Nit]` `body_head` may truncate before the security-lead *clear*; search the bounded full body.
> - `[Nit]` Collector `CODEOWNERS` drift (R2) has no named test row; exceptions keep a prose `role:` line beside `holders_*` — two sources.
>
> Rollback mid-way is sound: v0.1's `validateConfig` ignores unknown keys, so P1 merged without the product leaves the live board unchanged; publish-previous plus the v2-as-absent rule covers the product. First step I would do: the spike.
>
> **Tech lead: proceed with changes.**

**Disposition:** every Important and every nit is taken in the approved
plan (`plan/0002-one-front-door.md`): no pre-flip `check`; the spike is
step 1 with the auto-merge setting and its cleanup owned; `roles.json`; the
`action` trigger needs a session; two product PRs; `release-gate.sh`
synced; `sid` in the cookie and AAD = host; `trial: required`; validator
`--test`; verdicts parsed from the bounded full body; a `CODEOWNERS` drift
test row; `holders_*` the source and `role:` informational.
