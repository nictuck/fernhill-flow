# Plans

One file per change: `plan/NNNN-slug.md`, where `NNNN` is the intent and
the slug names the change. Written in plan mode (`/plan`), approved by the
engineer (`status: approved`, `approved_by`), then implemented on branch
`build/NNNN-slug`. When the implementation departs from the plan, the plan
is updated in the same commit — the `plan-sync` hook enforces it.

CI refuses a `status: proposed` plan on `main`.
