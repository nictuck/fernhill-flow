# Review policy

How every pull request at Fernhill is reviewed, by agents and by people.
Owned by the tech lead persona and the code owner; tuned monthly.

## Passes

Run each pass separately and report findings per pass.

1. **Correctness** — bugs, unhandled cases, broken invariants, race
   conditions. Read the tests: do they prove the change, or just run it?
2. **Spec conformance** — does the diff do what `spec.md` requires, all of
   it, and nothing it lists as out of scope?
3. **Plan conformance** — does the diff match `plan/NNNN-*.md`? If the
   implementation departed from the plan, was the plan updated in the same
   PR?
4. **Security** — secrets, injection, authz, unsafe deserialization,
   dependency risk. Apply `personas/security-lead.md` when enabled.
5. **UX** (PRs touching UI) — against the mock or the spec's UX section.
   Apply `personas/ux.md` when enabled.
6. **Maintainability** — naming, duplication, dead code, missing docs for
   public surfaces.

## Severity

- **Important** — would cause a bug, a security issue, a spec miss, or a
  plan deviation nobody recorded. Must be addressed or explicitly waived by
  the code owner before merge.
- **Nit** — style, naming, small simplifications. Cap: 5 nits per review.
  Beyond that, summarize in one line.

Findings never approve or block on their own. A human code owner merges.

## Skip

Do not review: `*.lock`, generated files under `dist/` or `build/`,
`docs/*.pdf`, vendored code.

## Output format

```
### Correctness
- [Important] path:line — what and why; suggested fix.
- [Nit] path:line — ...
### Spec conformance
...
Summary: N Important, M Nit. Recommend: merge / address first.
```
