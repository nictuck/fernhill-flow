// R5: an intent's timeline — artifacts and gates with who and when, sorted,
// linked, with dismissed-incident reasons and exceptions on merges.

import type { Snapshot } from "../../src/engine/types.ts";
import { timeline, exceptionAt } from "../../src/engine/timeline.ts";
import { GH, NOW, PLATFORM, daysAgo, makeException, makeIncident, makeIntent, makePlan, makePr, makeRepo, makeRun } from "../helpers/build.ts";
import { MERGE_SHA, acceptedSpec, linkedIntent, mergedPr, productRepo, snapshotWith, strip } from "./scenarios.ts";

const EXC = makeException({ granted: daysAgo(10), expires: "2026-11-30" });

function full(): Snapshot {
  const snap = snapshotWith({
    intents: [
      linkedIntent({
        status: "done",
        acceptedAt: daysAgo(28),
        statusSetAt: daysAgo(1),
        statusSetBy: "nictuck",
        spec: acceptedSpec(25, { flagged: 2 }),
      }),
    ],
    repos: [
      productRepo({
        plans: [makePlan({ createdAt: daysAgo(20) })],
        prs: [mergedPr({ createdAt: daysAgo(15), updatedAt: daysAgo(8), mergedAt: daysAgo(8), inProduction: true, servedLive: true })],
        releaseRuns: [
          makeRun({
            sha: MERGE_SHA,
            status: "completed",
            conclusion: "success",
            pendingApproval: false,
            createdAt: daysAgo(8),
            approvedBy: "nictuck",
            approvedAt: daysAgo(7),
          }),
        ],
      }),
    ],
    incidents: [
      makeIncident({ path: "incidents/2026-11-05-slow-board.md", status: "dismissed", reason: "duplicate of 2026-11-04", triagedBy: "nictuck", opened: daysAgo(5) }),
      makeIncident({ path: "incidents/2026-11-06-blank-board.md", status: "dismissed", reason: "", opened: daysAgo(4) }),
      makeIncident({ path: "incidents/2026-11-09-flicker.md", status: "open", opened: daysAgo(0.5) }),
    ],
  });
  // The platform repo holds the intent and spec PRs.
  snap.repos[0] = makeRepo({
    name: PLATFORM,
    site: "fernhillplatform",
    prs: [
      makePr({
        number: 2,
        url: `${GH}/${PLATFORM}/pull/2`,
        branch: "intent/0001-example",
        class: "intent",
        state: "merged",
        author: "originator",
        createdAt: daysAgo(30),
        updatedAt: daysAgo(28),
        mergedAt: daysAgo(28),
        mergedBy: "nictuck",
        mergeCommit: "1".repeat(40),
      }),
      makePr({
        number: 3,
        url: `${GH}/${PLATFORM}/pull/3`,
        branch: "design/0001-example",
        class: "spec",
        state: "merged",
        createdAt: daysAgo(27),
        updatedAt: daysAgo(25),
        mergedAt: daysAgo(25),
        mergedBy: "nictuck",
        mergeCommit: "2".repeat(40),
      }),
    ],
  });
  snap.platform.exceptions = [EXC];
  return snap;
}

test("entries are sorted by time ascending and cover every artifact and gate", () => {
  const entries = timeline("0001", full(), NOW);
  const times = entries.map((e) => Date.parse(e.at));
  expect(times).toEqual([...times].sort((a, b) => a - b));
  expect(entries.map((e) => e.kind)).toEqual([
    "intent-pr",
    "intent-accepted",
    "spec-pr",
    "spec-accepted",
    "plan",
    "build-pr",
    "merged",
    "release",
    "release",
    "deployed",
    "incident",
    "incident",
    "status",
    "incident",
  ]);
});

test("gates name who passed them and the merge commit, never an email", () => {
  const entries = timeline("0001", full(), NOW);
  const byKind = (kind: string) => entries.filter((e) => e.kind === kind);
  expect(byKind("intent-pr")[0]).toMatchObject({ who: "originator", href: `${GH}/${PLATFORM}/pull/2`, ci: "green" });
  expect(byKind("intent-accepted")[0]).toMatchObject({ who: "nictuck", text: "Intent 0001 accepted (gate 1) · 1111111" });
  expect(byKind("spec-pr")[0]!.text).toBe("Spec PR #3 opened (2 concerns open)");
  expect(byKind("spec-accepted")[0]).toMatchObject({ who: "nictuck", text: "Spec accepted (gate 2) · 2222222" });
  expect(byKind("plan")[0]).toMatchObject({ who: "Nicholas Tucker", text: "Plan plan/0001-example.md approved (gate 3)" });
  expect(byKind("merged")[0]).toMatchObject({ who: "nictuck", text: "PR #5 merged (gate 4) · ddddddd", ci: "green" });
  expect(byKind("release").map((e) => e.text)).toEqual(["Release run #100 success", "Production approved for run #100 (gate 5)"]);
  expect(byKind("release")[1]!.who).toBe("nictuck");
  expect(byKind("deployed")[0]).toMatchObject({ text: "Production serves ddddddd", href: "https://fernhill-flow.netlify.app" });
  expect(byKind("status")[0]).toMatchObject({ who: "nictuck", text: "Intent marked done" });
  for (const e of entries) expect(e.who ?? "").not.toContain("@");
});

test("dismissed incidents show their reason, or \"no reason recorded\"", () => {
  const incidents = timeline("0001", full(), NOW).filter((e) => e.kind === "incident");
  expect(incidents.map((e) => e.text)).toEqual([
    "Incident slow-board dismissed — duplicate of 2026-11-04",
    "Incident blank-board dismissed — no reason recorded",
    "Incident flicker open",
  ]);
  expect(incidents[0]!.who).toBe("nictuck");
  expect(incidents[1]!.who).toBeUndefined();
});

test("a merge inside an exception's window carries the exception id; others do not", () => {
  const entries = timeline("0001", full(), NOW);
  expect(entries.find((e) => e.kind === "merged")!.exception).toBe("EX-001"); // merged 8 days ago, granted 10 days ago
  expect(entries.find((e) => e.kind === "intent-accepted")!.exception).toBeUndefined(); // 28 days ago
  expect(exceptionAt([EXC], daysAgo(10))?.id).toBe("EX-001");
  expect(exceptionAt([EXC], "2026-11-30T18:00:00.000Z")?.id).toBe("EX-001"); // expiry day still covered
  expect(exceptionAt([EXC], "2026-12-01T00:00:00.000Z")).toBeUndefined();
  expect(exceptionAt([EXC], daysAgo(11))).toBeUndefined();
  expect(exceptionAt([EXC], daysAgo(5), "fernhill-unlisted")).toBeUndefined();
  expect(exceptionAt([makeException()], daysAgo(5))).toBeUndefined(); // no `granted` → never applies
});

test("every href is under the configured owner or a configured site", () => {
  for (const e of timeline("0001", full(), NOW)) {
    if (e.href !== undefined) expect(e.href).toMatch(/^https:\/\/(github\.com\/nictuck\/|(main--)?fernhill-flow\.netlify\.app)/);
  }
});

test("falls back to intent and spec timestamps when the platform PRs are not in the snapshot", () => {
  const snap = snapshotWith({ intents: [linkedIntent({ acceptedAt: daysAgo(9), spec: acceptedSpec(6) })], repos: [productRepo()] });
  const entries = timeline("0001", snap, NOW);
  expect(entries.map((e) => [e.kind, e.at])).toEqual([
    ["intent-accepted", daysAgo(9)],
    ["spec-accepted", daysAgo(6)],
  ]);
});

test("an open intent PR appears from the intent fields alone", () => {
  const plan = snapshotWith({
    intents: [strip(makeIntent({ status: "proposed", prNumber: 7, prOpenedAt: daysAgo(1), url: `${GH}/${PLATFORM}/pull/7` }), "acceptedAt")],
  });
  expect(timeline("0001", plan, NOW).map((e) => [e.text, e.who, e.href])).toEqual([
    ["Intent PR #7 opened", "Nicholas Tucker", `${GH}/${PLATFORM}/pull/7`],
  ]);
});

test("unknown intent → empty timeline", () => {
  expect(timeline("9999", full(), NOW)).toEqual([]);
});
