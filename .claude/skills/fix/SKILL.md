---
name: fix
description: Fix a bug the playbook way — commit a failing test first, then change code until it passes while tests stay read-only (protect-tests hook). Use for incidents and bug reports.
argument-hint: "<incident path or bug description>"
disable-model-invocation: true
---

Input: $ARGUMENTS

## Steps

1. **Understand.** If given an incident path under the platform's
   `incidents/`, read its Diagnosis. Reproduce the bug locally.
2. **Failing test first.** Write the smallest test that fails for this
   bug, named after the requirement or incident (`R4_...` or
   `incident_2026_11_04_...`). Run it; paste the failure. Commit it alone:
   `fix: failing test for <slug> (plan-unchanged)`.
3. **Lock the tests.** `mkdir -p .sdlc && touch .sdlc/fix-task`. From now
   the protect-tests hook blocks edits under tests/, evals/ and *.test.*.
4. **Fix the code** until `make check` passes. If you conclude the test is
   wrong, stop and say so; the engineer decides and unlocks.
5. **Unlock and commit.** `rm .sdlc/fix-task`. Commit the fix:
   `fix: <slug> (plan-unchanged)` — or, if the fix changes design, update
   the relevant `plan/` file in the same commit instead.
6. **Regression eval.** Add `evals/<slug>.json` describing the case
   (prompt, acceptance check) so the suite catches it from now on.
7. **PR** on branch `fix/<slug>`, body: the incident link, the failing-test
   commit, the fix commit, `make check` output. Never merge.
