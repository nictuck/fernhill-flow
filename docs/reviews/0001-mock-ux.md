# UX persona review — plan step 0 mock (2026-11-01)

Fresh-context subagent running `fernhill-platform/personas/ux.md` against
`docs/mock/index.html` + `mock.css` and the accepted spec. Verdict:
**mock: address first**. Disposition after each finding is the plan
author's.

## Important

1. Card 0003 showed *In progress · CI green* with the action *Review and
   merge PR #14*; flow.md row 4 says CI green in Test = *Waiting on code
   owner*, and Needs you had no Code owner group. — **Fixed:** state
   *Waiting on code owner for 2 days*; Code owner group added; count 4.
   A genuine *In progress* card (CI running) added instead.
2. Needs-you row for `/plan 0002` lost the *View repo* link the card has
   (R2). — **Fixed:** commands always ship with their View link.
3. Three phrasings of the stuck state on one screen (`stuck · limit 3`,
   `stuck · 6 of 3 days`, spec's `stuck, limit 3`). — **Fixed:** one
   string everywhere: badge *Waiting on product owner* · text *for 6 days*
   · badge *stuck, limit 3*; the engine exposes `stateParts()` so the app
   cannot drift.
4. The *failed* strip and the token error screen had no Refresh control —
   the recovery action vanished when needed (R8). — **Fixed:** a Refresh
   button follows the verbatim copy in both.
5. Exception banner sat above Needs you at both widths (R4: Needs you is
   above the board). — **Fixed:** Needs you first; the banner is a
   one-line muted strip below it.
6. Buttons were bare text (Copy ~30×15 px, nav links 4 px padding) — not
   usable at 375 (R12). — **Fixed:** `min-height: 32px; padding: 6px
   10px` on every in-app button; nav links `10px 6px`.
7. At ≤ 600 px Needs-you rows merged (two muted 13 px lines, no border).
   — **Fixed:** who + meta on one line, action full width, border between
   rows, `padding: 10px 0`.
8. `.frame-label` (mock scaffolding, hardcoded `#55554f`) was used in-app
   for *Staging*/*Production*/*company front door*: 2.17:1 on the dark
   panel. — **Fixed:** in-app `.label` uses `var(--muted)` (≥ 4.99:1 both
   themes); `.frame-label` stays outside frames.
9. Systems phone cards each lacked R7 fields. — **Fixed:** the platform
   card is complete (adds *main CI · incidents · PRs*).
10. "Mock before build" asks for Board at 1440 populated **and** nothing
    waits; the latter was missing. — **Fixed:** section 2b.

## Nits (all taken)

Stage detail shows only per-card time-in-stage until n ≥ 5; `.who` is a
link and titles underline on hover/focus; loading state *Loading the
board…* added (and proposed for the spec's copy table); Needs you hidden
on an empty board; the timeline's predictive line replaced by *under
EX-001* on the merge entry; one banner phrasing; 375 Done card keeps its
full text; Copy buttons carry `aria-label`; *No intents in ‹Stage›*
instead of *Nothing here*; the *CI green* badge dropped from cards (CI red
stays).

Checked with no finding: status never by color alone; every action is an
`<a>`/`<button>` with a visible focus ring; copy table strings verbatim;
Done collapsed and empty stages collapsed at 375.
