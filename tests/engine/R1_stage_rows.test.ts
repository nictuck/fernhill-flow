// R1/R2/R11: one case per flow.md state-machine row and sub-condition —
// stage, state, waiting-on, clock, board membership.

import type { Derived, Snapshot } from "../../src/engine/types.ts";
import { derive } from "../../src/engine/derive.ts";
import { GH, NOW, daysAgo, makeIncident, makeIntent, makePlan, makePr, makeRepo } from "../helpers/build.ts";
import { MERGE_SHA, PRODUCT, linkedIntent, mergedPr, productRepo, runFor, scenario, snapshotWith } from "./scenarios.ts";

function one(snapshot: Snapshot): Derived {
  const rows = derive(snapshot, NOW);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("Done", () => {
  test("status done within board.done_days is on the board, clock = statusSetAt", () => {
    const d = one(scenario.done(18));
    expect(d).toMatchObject({ stage: "done", state: "done", days: 18, onBoard: true, stuck: false });
    expect(d.clockStart).toBe(daysAgo(18));
    expect(d.action).toBeUndefined();
    expect(d.waitingOn).toBeUndefined();
  });

  test("exactly board.done_days is still on the board; one more day is Archive only", () => {
    expect(one(scenario.done(30)).onBoard).toBe(true);
    expect(one(scenario.done(31)).onBoard).toBe(false);
    expect(one(scenario.done(31))).toMatchObject({ stage: "done", state: "done" });
  });

  test("parked and rejected go straight to Archive", () => {
    expect(one(scenario.done(0, "parked"))).toMatchObject({ stage: "done", state: "done", onBoard: false });
    expect(one(scenario.done(0, "rejected"))).toMatchObject({ stage: "done", state: "done", onBoard: false });
  });

  test("done wins over everything else, even a merged live PR", () => {
    const snap = scenario.maintain();
    snap.platform.intents[0] = { ...snap.platform.intents[0]!, status: "done", statusSetAt: daysAgo(1) };
    expect(one(snap)).toMatchObject({ stage: "done", days: 1 });
  });

  test("clock falls back to acceptedAt, then created, when statusSetAt is missing", () => {
    const snap = snapshotWith({ intents: [makeIntent({ status: "done", acceptedAt: daysAgo(4) })] });
    expect(one(snap).clockStart).toBe(daysAgo(4));
  });
});

describe("6 Maintain", () => {
  test("merged, in production and served, no incident → Live; with no release run known the clock is the merge", () => {
    const d = one(scenario.maintain([], 20));
    expect(d).toMatchObject({ stage: "maintain", state: "live", days: 20, stuck: false, onBoard: true });
    expect(d.clockStart).toBe(daysAgo(20));
    expect(d.waitStart).toBe(d.clockStart);
    expect(d.notes).toEqual(["no open incidents"]);
    expect(d.action).toBeUndefined();
    expect(d.repo?.name).toBe(PRODUCT);
  });

  test("the clock is the production deployment: the run approved two days after the merge", () => {
    const snap = snapshotWith({
      intents: [linkedIntent()],
      repos: [
        productRepo({
          prs: [mergedPr({ mergedAt: daysAgo(20), updatedAt: daysAgo(20), inProduction: true, servedLive: true })],
          releaseRuns: [
            runFor({ id: 100, status: "completed", conclusion: "success", pendingApproval: false, createdAt: daysAgo(19), approvedBy: "nictuck", approvedAt: daysAgo(18) }),
            // an unrelated later run must not move the clock
            runFor({ id: 101, sha: "f".repeat(40), status: "completed", conclusion: "success", pendingApproval: false, createdAt: daysAgo(2), approvedAt: daysAgo(1) }),
          ],
        }),
      ],
    });
    const d = one(snap);
    expect(d).toMatchObject({ stage: "maintain", state: "live", days: 18 });
    expect(d.clockStart).toBe(daysAgo(18));
  });

  test("a failed or unapproved run for the merge commit does not set the Live clock", () => {
    const snap = snapshotWith({
      intents: [linkedIntent()],
      repos: [
        productRepo({
          prs: [mergedPr({ mergedAt: daysAgo(20), updatedAt: daysAgo(20), inProduction: true, servedLive: true })],
          releaseRuns: [runFor({ status: "completed", conclusion: "failure", pendingApproval: false, createdAt: daysAgo(19) })],
        }),
      ],
    });
    expect(one(snap).clockStart).toBe(daysAgo(20));
  });

  test("triaged incidents keep it Live and are counted", () => {
    const d = one(scenario.maintain([makeIncident({ status: "fix-now" }), makeIncident({ status: "scheduled", path: "incidents/2026-11-08-x.md" })]));
    expect(d.state).toBe("live");
    expect(d.notes).toEqual(["2 incidents triaged"]);
    const resolved = one(scenario.maintain([makeIncident({ status: "resolved" }), makeIncident({ status: "dismissed", path: "incidents/2026-11-08-x.md" })]));
    expect(resolved.notes).toEqual(["no open incidents"]);
  });

  test("an open incident on the product → waiting on on-call with a triage action", () => {
    const d = one(scenario.maintain([makeIncident({ opened: daysAgo(0.5) })]));
    expect(d).toMatchObject({
      stage: "maintain",
      state: "waiting",
      waitingOn: "on-call",
      stuck: false,
      limit: 1,
      thresholdKey: "maintain.untriaged_days",
    });
    expect(d.action).toEqual({ text: "Triage incident blank-board", href: `${GH}/fernhill-platform/blob/main/incidents/2026-11-09-blank-board.md` });
    expect(d.notes).toEqual(["1 open incident"]);
  });

  test("the oldest open incident drives the action, the wait and the stuck check", () => {
    const old = makeIncident({ path: "incidents/2026-11-07-oldest.md", opened: daysAgo(3) });
    const recent = makeIncident({ opened: daysAgo(0.1) });
    const d = one(scenario.maintain([recent, old]));
    expect(d.action?.text).toBe("Triage incident oldest");
    expect(d.stuck).toBe(true);
    expect(d.days).toBe(20); // time in stage: the production merge
    expect(d.waitStart).toBe(old.opened); // the wait: the oldest open incident
    expect(d.waitDays).toBe(3);
  });

  test("an incident opened half a day ago on an intent live for 11 days: waiting 0 days, not 11, not stuck", () => {
    const d = one(scenario.maintain([makeIncident({ opened: daysAgo(0.5) })], 11));
    expect(d).toMatchObject({ state: "waiting", waitingOn: "on-call", days: 11, waitDays: 0, stuck: false, limit: 1 });
    expect(d.waitStart).toBe(daysAgo(0.5));
  });

  test("an open incident on another product does not touch this intent", () => {
    const d = one(scenario.maintain([makeIncident({ product: "fernhill-other" })]));
    expect(d.state).toBe("live");
  });
});

describe("5 Deploy", () => {
  test("merged, no release run yet → In progress on staging, clock = merge", () => {
    const d = one(scenario.deploy([]));
    expect(d).toMatchObject({ stage: "deploy", state: "progress", days: 2, stuck: false });
    expect(d.clockStart).toBe(daysAgo(2));
    expect(d.notes).toEqual(["staging"]);
    expect(d.limit).toBeUndefined();
  });

  test("run in progress or queued → In progress", () => {
    expect(one(scenario.deploy([runFor({ status: "in_progress", pendingApproval: false })])).state).toBe("progress");
    expect(one(scenario.deploy([runFor({ status: "queued", pendingApproval: false })])).state).toBe("progress");
  });

  test("production environment pending → waiting on release manager", () => {
    const d = one(scenario.deploy([runFor({ status: "waiting", pendingApproval: true, createdAt: daysAgo(0.5) })]));
    expect(d).toMatchObject({
      stage: "deploy",
      state: "waiting",
      waitingOn: "release manager",
      stuck: false,
      limit: 2,
      thresholdKey: "deploy.approval_pending_days",
    });
    expect(d.action).toEqual({ text: "Approve production for run #100", href: `${GH}/fernhill-flow/actions/runs/100` });
    expect(d.days).toBe(2); // in Deploy since the merge
    expect(d.waitStart).toBe(daysAgo(0.5)); // waiting since the run asked for approval
    expect(d.waitDays).toBe(0);
  });

  test("failed release run → waiting on release manager, stuck with no timer", () => {
    for (const conclusion of ["failure", "timed_out", "cancelled"] as const) {
      const d = one(scenario.deploy([runFor({ status: "completed", conclusion, pendingApproval: false })]));
      expect(d).toMatchObject({ stage: "deploy", state: "waiting", waitingOn: "release manager", stuck: true });
      expect(d.limit).toBeUndefined();
      expect(d.thresholdKey).toBeUndefined();
      expect(d.action).toEqual({ text: "Release run #100 failed", href: `${GH}/fernhill-flow/actions/runs/100` });
      expect(d.notes).toEqual(["release run failed"]);
    }
  });

  test("run succeeded but production does not serve the commit yet → In progress", () => {
    const d = one(scenario.deploy([runFor({ status: "completed", conclusion: "success", pendingApproval: false })]));
    expect(d).toMatchObject({ stage: "deploy", state: "progress", stuck: false });
    expect(d.notes).toEqual(["waiting for production to serve"]);
  });

  test("in production but not served live is still Deploy", () => {
    const d = one(scenario.deploy([runFor({ status: "completed", conclusion: "success", pendingApproval: false })], { inProduction: true }));
    expect(d.stage).toBe("deploy");
  });

  test("the run whose sha is the merge commit wins over a newer unrelated run", () => {
    const unrelated = runFor({ id: 101, sha: "f".repeat(40), status: "completed", conclusion: "failure", pendingApproval: false, createdAt: daysAgo(0.1) });
    const ours = runFor({ id: 100, status: "waiting", pendingApproval: true, createdAt: daysAgo(1) });
    const d = one(scenario.deploy([unrelated, ours]));
    expect(d.action?.text).toBe("Approve production for run #100");
  });

  test("without a matching sha the most recent run is used", () => {
    const older = runFor({ id: 90, sha: "e".repeat(40), status: "completed", conclusion: "failure", pendingApproval: false, createdAt: daysAgo(3) });
    const newer = runFor({ id: 91, sha: "f".repeat(40), status: "waiting", pendingApproval: true, createdAt: daysAgo(0.2) });
    const d = one(scenario.deploy([older, newer]));
    expect(d.action?.text).toBe("Approve production for run #91");
  });
});

describe("4 Test", () => {
  test("CI running → In progress, clock = PR opened", () => {
    const d = one(scenario.testPr("running", 0.5));
    expect(d).toMatchObject({ stage: "test", state: "progress", days: 2, ci: "running", stuck: false });
    expect(d.clockStart).toBe(daysAgo(2.5));
    expect(d.action).toBeUndefined();
  });

  test("CI red → waiting on engineer, link to the failing check", () => {
    const d = one(scenario.testPr("red", 0.5, { ciUrl: `${GH}/fernhill-flow/actions/runs/55` }));
    expect(d).toMatchObject({ stage: "test", state: "waiting", waitingOn: "engineer", ci: "red", limit: 1, thresholdKey: "test.ci_red_days", stuck: false });
    expect(d.action).toEqual({ text: "CI failing on PR #5", href: `${GH}/fernhill-flow/actions/runs/55` });
  });

  test("CI red without a check URL falls back to the PR's checks tab", () => {
    expect(one(scenario.testPr("red")).action?.href).toBe(`${GH}/fernhill-flow/pull/5/checks`);
  });

  test("CI green → waiting on code owner to review and merge", () => {
    const d = one(scenario.testPr("green", 0.5));
    expect(d).toMatchObject({ stage: "test", state: "waiting", waitingOn: "code owner", ci: "green", limit: 2, thresholdKey: "test.review_pending_days", stuck: false });
    expect(d.action).toEqual({ text: "Review and merge PR #5", href: `${GH}/fernhill-flow/pull/5` });
  });

  test("no CI at all is treated like green (the code owner decides)", () => {
    expect(one(scenario.testPr("none")).waitingOn).toBe("code owner");
  });

  test("the wait is measured from the last push, not the PR opening: 5 days in Test, waiting 1 day, not stuck at limit 2", () => {
    const d = one(scenario.testPr("green", 1, { createdAt: daysAgo(5) }));
    expect(d).toMatchObject({ stage: "test", state: "waiting", waitingOn: "code owner", days: 5, waitDays: 1, stuck: false, limit: 2 });
    expect(d.clockStart).toBe(daysAgo(5));
    expect(d.waitStart).toBe(daysAgo(1));
    const red = one(scenario.testPr("red", 0.5, { createdAt: daysAgo(5) }));
    expect(red).toMatchObject({ days: 5, waitDays: 0, stuck: false });
  });

  test("the highest-numbered build PR is the unit; earlier merged PRs do not hide it", () => {
    const earlier = mergedPr({ number: 3, inProduction: true, servedLive: true });
    const later = makePr({ number: 8, ci: "red" });
    const d = one(scenario.testPrs([earlier, later]));
    expect(d).toMatchObject({ stage: "test", waitingOn: "engineer" });
    expect(d.action?.text).toBe("CI failing on PR #8");
  });

  test("fork PRs, fix PRs, other intents' PRs and closed PRs never drive the stage", () => {
    const fork = makePr({ number: 9, sameRepo: false, ci: "red" });
    const fix = makePr({ number: 10, class: "fix", branch: "fix/blank-board", ci: "red" });
    const other = makePr({ number: 11, intent: "0002", branch: "build/0002-x", ci: "red" });
    const closed = makePr({ number: 12, state: "closed", ci: "red" });
    const ours = makePr({ number: 5, ci: "green" });
    const d = one(scenario.testPrs([fork, fix, other, closed, ours]));
    expect(d.action?.text).toBe("Review and merge PR #5");
  });
});

describe("3 Build", () => {
  test("product \"\" → waiting on product owner to create the repo, clock = spec accepted", () => {
    const d = one(scenario.buildNoRepo(2));
    expect(d).toMatchObject({ stage: "build", state: "waiting", waitingOn: "product owner", days: 2, limit: 5, thresholdKey: "build.no_repo_days", stuck: false });
    expect(d.clockStart).toBe(daysAgo(2));
    expect(d.action).toEqual({
      text: "scripts/new-product example --intent 0001",
      copy: "scripts/new-product example --intent 0001",
      secondary: { text: "View spec", href: `${GH}/fernhill-platform/blob/main/intent/0001-example/spec.md` },
    });
    expect(d.repo).toBeUndefined();
  });

  test("a product that names a repo missing from the snapshot is treated as no repo", () => {
    const d = one(scenario.buildRepoMissing());
    expect(d).toMatchObject({ stage: "build", waitingOn: "product owner" });
    expect(d.notes).toEqual(["repo fernhill-x not in snapshot"]);
  });

  test("repo linked, no plan → waiting on engineer to run /plan", () => {
    const d = one(scenario.buildNoPlan(2));
    expect(d).toMatchObject({ stage: "build", state: "waiting", waitingOn: "engineer", days: 2, limit: 5, thresholdKey: "build.no_plan_days", stuck: false });
    expect(d.action).toEqual({ text: "/plan 0001", copy: "/plan 0001", secondary: { text: "View repo", href: `${GH}/fernhill-flow` } });
    expect(d.repo?.name).toBe(PRODUCT);
  });

  test("plan proposed → waiting on engineer to approve it", () => {
    const d = one(scenario.buildProposedPlan(1));
    expect(d).toMatchObject({ stage: "build", state: "waiting", waitingOn: "engineer", limit: 5, thresholdKey: "build.no_plan_days", stuck: false });
    expect(d.action).toEqual({ text: "Approve plan plan/0001-example.md", href: `${GH}/fernhill-flow/blob/main/plan/0001-example.md` });
    expect(d.clockStart).toBe(daysAgo(8)); // in Build since the spec was accepted
    expect(d.waitStart).toBe(daysAgo(1)); // waiting since the plan was proposed
    expect(d).toMatchObject({ days: 8, waitDays: 1 });
  });

  test("plan approved, no PR → In progress; the branch idle threshold applies", () => {
    const d = one(scenario.buildApproved(1));
    expect(d).toMatchObject({ stage: "build", state: "progress", days: 8, limit: 3, thresholdKey: "build.branch_idle_days", stuck: false });
    expect(d.action).toBeUndefined();
    expect(d.notes).toEqual(["branch build/0001-example"]);
  });

  test("plan approved, no branch yet → idle measured from the plan", () => {
    const d = one(scenario.buildApprovedNoBranch(1));
    expect(d).toMatchObject({ stage: "build", state: "progress", stuck: false, thresholdKey: "build.branch_idle_days" });
    expect(d.notes).toEqual(["no build branch yet"]);
    expect(one(scenario.buildApprovedNoBranch(4)).stuck).toBe(true);
  });

  test("a plan on a branch (not yet on main) counts; a superseded plan does not", () => {
    const onBranch = snapshotWith({ intents: [linkedIntent()], repos: [productRepo({ plans: [makePlan({ onMain: false, status: "proposed", createdAt: daysAgo(1) })] })] });
    expect(one(onBranch).action?.text).toBe("Approve plan plan/0001-example.md");
    const superseded = snapshotWith({ intents: [linkedIntent()], repos: [productRepo({ plans: [makePlan({ status: "superseded" })] })] });
    expect(one(superseded).action?.text).toBe("/plan 0001");
  });

  test("a closed build PR leaves the intent in Build", () => {
    const snap = snapshotWith({ intents: [linkedIntent()], repos: [productRepo({ plans: [makePlan()], prs: [makePr({ state: "closed" })] })] });
    expect(one(snap)).toMatchObject({ stage: "build", state: "progress" });
  });
});

describe("2 Design", () => {
  test("accepted intent, no spec → waiting on product owner to run /design, clock = intent accepted", () => {
    const d = one(scenario.designNoSpec(2));
    expect(d).toMatchObject({ stage: "design", state: "waiting", waitingOn: "product owner", days: 2, limit: 5, thresholdKey: "design.no_spec_pr_days", stuck: false });
    expect(d.clockStart).toBe(daysAgo(2));
    expect(d.action).toEqual({ text: "/design 0001", copy: "/design 0001", secondary: { text: "View intent", href: `${GH}/fernhill-platform/tree/main/intent/0001-example` } });
  });

  test("spec PR open → waiting on product owner for gate 2, stuck measured from the PR", () => {
    const d = one(scenario.designSpecPr(1, 2));
    expect(d).toMatchObject({ stage: "design", state: "waiting", waitingOn: "product owner", days: 4, limit: 3, thresholdKey: "design.spec_pr_open_days", stuck: false });
    expect(d.clockStart).toBe(daysAgo(4));
    expect(d.action).toEqual({ text: "Accept spec 0001 (2 concerns open)", href: `${GH}/fernhill-platform/pull/12` });
  });

  test("a superseded spec with no PR is back to /design", () => {
    const snap = snapshotWith({ intents: [makeIntent({ spec: { status: "superseded", flagged: 0, url: "x" } })] });
    expect(one(snap).action?.copy).toBe("/design 0001");
  });
});

describe("1 Plan", () => {
  test("intent PR open → waiting on product owner for gate 1, clock = PR opened", () => {
    const d = one(scenario.planPr(1));
    expect(d).toMatchObject({ stage: "plan", state: "waiting", waitingOn: "product owner", days: 1, limit: 3, thresholdKey: "plan.pr_open_days", stuck: false, onBoard: true });
    expect(d.clockStart).toBe(daysAgo(1));
    expect(d.action).toEqual({ text: "Accept or reject intent 0001", href: `${GH}/fernhill-platform/pull/7` });
  });
});

describe("odd data", () => {
  test("a proposed intent on main without a PR is reported, not thrown", () => {
    const snap = snapshotWith({ intents: [makeIntent({ status: "proposed" })] });
    const d = one(snap);
    expect(d).toMatchObject({ stage: "plan", state: "progress", stuck: false });
    expect(d.notes[0]).toMatch(/^unclassified: /);
  });

  test("garbage timestamps do not throw and never produce negative days", () => {
    const snap = snapshotWith({ intents: [makeIntent({ acceptedAt: "not a date" })] });
    expect(one(snap).days).toBe(0);
    const future = snapshotWith({ intents: [makeIntent({ acceptedAt: daysAgo(-3) })] });
    expect(one(future).days).toBe(0);
  });

  test("one row per intent, in snapshot order, independent of each other", () => {
    const snap = snapshotWith({
      intents: [
        makeIntent({ id: "0001", dir: "0001-a", acceptedAt: daysAgo(1) }),
        makeIntent({ id: "0002", dir: "0002-b", status: "done", statusSetAt: daysAgo(2) }),
        linkedIntent({ id: "0003", dir: "0003-c" }),
      ],
      repos: [productRepo({ prs: [mergedPr({ intent: "0003", branch: "build/0003-c", inProduction: true, servedLive: true })] })],
    });
    expect(derive(snap, NOW).map((d) => [d.intent.id, d.stage])).toEqual([
      ["0001", "design"],
      ["0002", "done"],
      ["0003", "maintain"],
    ]);
  });

  test("a repo snapshot with an error still derives (no plan → /plan)", () => {
    const snap = snapshotWith({ intents: [linkedIntent()], repos: [makeRepo({ name: PRODUCT, error: "token cannot see it" })] });
    expect(one(snap).stage).toBe("build");
    expect(MERGE_SHA).toHaveLength(40);
  });
});
