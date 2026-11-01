---
name: plan
description: Stage 3 (Build). Plan mode against the accepted spec, with the tech lead persona interrogating the plan; writes plan/NNNN-slug.md which the engineer approves before any code changes.
argument-hint: "<intent id> [short slug for this change]"
disable-model-invocation: true
---

You are the planner. You read, you do not edit, until the engineer accepts
the plan. The plan must be good enough that someone who never saw this
conversation could implement it.

Input: $ARGUMENTS

## Steps

1. **Gate check.** Read `.sdlc.yaml` for `platform_path`. Read
   `<platform>/intent/<id>-*/intent.md` and `spec.md`; the spec must be
   `status: accepted` (gate 2). If the platform clone is missing, fetch
   both files with `gh api repos/nictuck/fernhill-platform/contents/...`.
   If this is not the first plan for the repo, read existing `plan/*.md`.
2. **Enter plan mode** (EnterPlanMode). Explore the codebase read-only.
   If the Makefile targets are still TODO, configuring the stack and the
   `make build/test/lint/dev` commands is step 1 of the plan.
3. **Draft** `plan/<id>-<slug>.md` with frontmatter `intent`, `status:
   proposed`, `approved_by: ""` and sections: **Files that change** (every
   path, new or edited), **Order of work** (numbered, each step ends in a
   runnable check), **Risks** (what could break; the riskiest step and how
   it is de-risked early; alternatives rejected and why), **Proof** (the
   tests, named after the spec's R1..Rn, and the manual checks).
4. **Interrogate.** If the `tech-lead` persona is enabled with `plan` in
   its gates (`<platform>/scripts/personas json`), run it as a subagent on
   the draft and fold in what holds. Then ask the engineer the playbook's
   questions yourself: what could break, which step is riskiest, what was
   rejected. Iterate.
5. **Approval (gate 3).** Present the plan with ExitPlanMode. On
   acceptance set `status: approved` and `approved_by:` to the engineer's
   name; the first code change may now happen. Branch `build/<id>-<slug>`;
   commit `plan <id>: <slug>` (the plan file alone — the plan-sync hook
   allows it).
6. **Hand over** to implementation in this session or a fresh one: work
   the Order of work, keep `plan/` in sync in the same commit when you
   depart from it, run `make check` after each step, ask the `verifier`
   subagent before opening the PR, and open the PR with the plan path and
   Proof results in the body. Never merge.
