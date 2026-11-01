// R4: Needs you — grouping in role order, stuck first then oldest, empty
// groups hidden, one incident row per open incident under on-call with no
// double listing, and the counts for the title and the "nothing waits" copy.

import type { NeedsYouItem } from "../../src/engine/types.ts";
import { derive } from "../../src/engine/derive.ts";
import { needsYou } from "../../src/engine/needsYou.ts";
import { GH, NOW, PLATFORM, daysAgo, makeIncident, makeIntent, makePlan, makePr } from "../helpers/build.ts";
import { linkedIntent, mergedPr, productRepo, snapshotWith, strip } from "./scenarios.ts";

function label(row: NeedsYouItem): string {
  return row.kind === "intent" ? row.derived.intent.id : row.incident.path;
}

const busy = snapshotWith({
  intents: [
    // A: Plan, 5 days, stuck (limit 3)
    strip(makeIntent({ id: "0002", dir: "0002-a", status: "proposed", prNumber: 7, prOpenedAt: daysAgo(5), url: `${GH}/${PLATFORM}/pull/7` }), "acceptedAt"),
    // B: Design, 2 days, not stuck
    makeIntent({ id: "0003", dir: "0003-b", acceptedAt: daysAgo(2) }),
    // C: Design, 10 days, stuck (limit 5)
    makeIntent({ id: "0004", dir: "0004-c", acceptedAt: daysAgo(10) }),
    // D: Test, CI green → code owner
    linkedIntent({ id: "0005", dir: "0005-d" }),
    // E: Build, plan approved, no PR → In progress
    linkedIntent({ id: "0006", dir: "0006-e" }),
    // F: Maintain, open incident → waiting on on-call (carried by the incident row)
    linkedIntent({ id: "0007", dir: "0007-f" }),
    // G: Maintain, live (no incident on its product)
    linkedIntent({ id: "0008", dir: "0008-g", product: "fernhill-other" }),
  ],
  repos: [
    productRepo({
      plans: [makePlan({ intent: "0006", path: "plan/0006-e.md" })],
      prs: [
        makePr({ number: 5, intent: "0005", branch: "build/0005-d", ci: "green", createdAt: daysAgo(2), updatedAt: daysAgo(1) }),
        mergedPr({ number: 9, intent: "0007", branch: "build/0007-f", inProduction: true, servedLive: true, mergedAt: daysAgo(20) }),
      ],
    }),
    productRepo({
      name: "fernhill-other",
      prs: [mergedPr({ number: 2, intent: "0008", branch: "build/0008-g", inProduction: true, servedLive: true, mergedAt: daysAgo(40) })],
    }),
  ],
  incidents: [
    makeIncident({ opened: daysAgo(2) }), // fernhill-flow, stuck (limit 1)
    makeIncident({ path: "incidents/2026-11-10-other-thing.md", product: "fernhill-third", opened: daysAgo(0.2) }),
    makeIncident({ path: "incidents/2026-11-01-fixed.md", status: "resolved", opened: daysAgo(9) }),
  ],
});

test("groups follow ROLES order and empty groups are omitted", () => {
  const ny = needsYou(derive(busy, NOW), busy, NOW);
  expect(ny.groups.map((g) => g.role)).toEqual(["product owner", "code owner", "on-call"]);
});

test("within a group: stuck first, then the most days", () => {
  const ny = needsYou(derive(busy, NOW), busy, NOW);
  const po = ny.groups.find((g) => g.role === "product owner")!;
  expect(po.rows.map(label)).toEqual(["0004", "0002", "0003"]);
  expect(po.rows.map((r) => [r.stuck, r.days])).toEqual([
    [true, 10],
    [true, 5],
    [false, 2],
  ]);
});

test("intent rows carry the derived action and limit", () => {
  const ny = needsYou(derive(busy, NOW), busy, NOW);
  const row = ny.groups.find((g) => g.role === "code owner")!.rows[0]!;
  expect(row).toMatchObject({ kind: "intent", stuck: false, limit: 2, days: 2 });
  expect(row.action).toEqual({ text: "Review and merge PR #5", href: `${GH}/fernhill-flow/pull/5` });
});

test("one incident row per open incident under on-call; resolved ones are not listed", () => {
  const ny = needsYou(derive(busy, NOW), busy, NOW);
  const oncall = ny.groups.find((g) => g.role === "on-call")!;
  expect(oncall.rows.map(label)).toEqual(["incidents/2026-11-09-blank-board.md", "incidents/2026-11-10-other-thing.md"]);
  expect(oncall.rows[0]).toMatchObject({ kind: "incident", stuck: true, limit: 1, days: 2 });
  expect(oncall.rows[0]!.action).toEqual({
    text: "Triage incident blank-board",
    href: `${GH}/${PLATFORM}/blob/main/incidents/2026-11-09-blank-board.md`,
  });
  expect(oncall.rows[1]).toMatchObject({ kind: "incident", stuck: false, days: 0 });
});

test("a Maintain intent waiting on on-call is not listed twice: the incident row carries it", () => {
  const rows = derive(busy, NOW);
  expect(rows.find((d) => d.intent.id === "0007")).toMatchObject({ stage: "maintain", state: "waiting", waitingOn: "on-call", stuck: true });
  const ny = needsYou(rows, busy, NOW);
  const all = ny.groups.flatMap((g) => g.rows).filter((r) => r.kind === "intent");
  expect(all.map(label)).not.toContain("0007");
});

test("count is every row across groups; inProgress and stuck count the board", () => {
  const rows = derive(busy, NOW);
  const ny = needsYou(rows, busy, NOW);
  expect(ny.count).toBe(6); // 3 product owner + 1 code owner + 2 incidents
  expect(ny.inProgress).toBe(1); // E
  expect(ny.stuck).toBe(3); // A, C, F
});

test("nothing waits: no groups, count 0, the in-progress and stuck counts for the copy", () => {
  const quiet = snapshotWith({
    intents: [linkedIntent({ id: "0006", dir: "0006-e" }), linkedIntent({ id: "0008", dir: "0008-g" })],
    repos: [
      productRepo({
        plans: [makePlan({ intent: "0006", path: "plan/0006-e.md" })],
        prs: [mergedPr({ number: 2, intent: "0008", branch: "build/0008-g", inProduction: true, servedLive: true })],
      }),
    ],
  });
  const ny = needsYou(derive(quiet, NOW), quiet, NOW);
  expect(ny).toEqual({ count: 0, groups: [], inProgress: 1, stuck: 0 });
});

test("rows that left the board (archived done) are not counted", () => {
  const snap = snapshotWith({ intents: [makeIntent({ status: "done", statusSetAt: daysAgo(40) })] });
  expect(needsYou(derive(snap, NOW), snap, NOW)).toEqual({ count: 0, groups: [], inProgress: 0, stuck: 0 });
});
