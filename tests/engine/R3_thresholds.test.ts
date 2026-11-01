// R3: for every threshold key, a case exactly at the limit (not stuck) and
// one day over (stuck). The scenario table is typed Record<ThresholdKey, …>
// so adding a key to THRESHOLD_KEYS without a scenario fails to compile.

import type { Snapshot, ThresholdKey } from "../../src/engine/types.ts";
import { THRESHOLD_KEYS } from "../../src/engine/types.ts";
import { derive } from "../../src/engine/derive.ts";
import { needsYou } from "../../src/engine/needsYou.ts";
import { NOW, daysAgo, makeConfig, makeIncident } from "../helpers/build.ts";
import { runFor, scenario } from "./scenarios.ts";

/** Builds the snapshot whose stuck condition for `key` has been true for `n` days. */
const scenarios: Record<ThresholdKey, (n: number) => Snapshot> = {
  "plan.pr_open_days": (n) => scenario.planPr(n),
  "design.no_spec_pr_days": (n) => scenario.designNoSpec(n),
  "design.spec_pr_open_days": (n) => scenario.designSpecPr(n),
  "build.no_repo_days": (n) => scenario.buildNoRepo(n),
  "build.no_plan_days": (n) => scenario.buildNoPlan(n),
  "build.branch_idle_days": (n) => scenario.buildApproved(n),
  "test.ci_red_days": (n) => scenario.testPr("red", n),
  "test.review_pending_days": (n) => scenario.testPr("green", n),
  "deploy.approval_pending_days": (n) => scenario.deploy([runFor({ status: "waiting", pendingApproval: true, createdAt: daysAgo(n) })]),
  "maintain.untriaged_days": (n) => scenario.maintain([makeIncident({ opened: daysAgo(n) })]),
};

const limits = makeConfig().thresholds;

describe.each([...THRESHOLD_KEYS])("%s", (key) => {
  const limit = limits[key];

  test(`exactly ${limit} days: not stuck, limit and key reported`, () => {
    const d = derive(scenarios[key](limit), NOW)[0]!;
    expect(d.stuck).toBe(false);
    expect(d.limit).toBe(limit);
    expect(d.thresholdKey).toBe(key);
  });

  test(`${limit + 1} days: stuck`, () => {
    const d = derive(scenarios[key](limit + 1), NOW)[0]!;
    expect(d.stuck).toBe(true);
    expect(d.limit).toBe(limit);
    expect(d.thresholdKey).toBe(key);
  });

  test("raising the threshold in config un-sticks it with no code change", () => {
    const snap = scenarios[key](limit + 1);
    snap.config.thresholds[key] = limit + 1;
    expect(derive(snap, NOW)[0]!.stuck).toBe(false);
  });
});

describe("secondary measurements", () => {
  test("build.no_plan_days also covers a proposed plan, measured from the plan", () => {
    const limit = limits["build.no_plan_days"];
    expect(derive(scenario.buildProposedPlan(limit), NOW)[0]).toMatchObject({ stuck: false, thresholdKey: "build.no_plan_days" });
    expect(derive(scenario.buildProposedPlan(limit + 1), NOW)[0]).toMatchObject({ stuck: true, thresholdKey: "build.no_plan_days" });
  });

  test("build.branch_idle_days without a branch is measured from the plan", () => {
    const limit = limits["build.branch_idle_days"];
    expect(derive(scenario.buildApprovedNoBranch(limit), NOW)[0]!.stuck).toBe(false);
    expect(derive(scenario.buildApprovedNoBranch(limit + 1), NOW)[0]!.stuck).toBe(true);
  });

  test("maintain.untriaged_days also drives the Needs-you incident rows", () => {
    const limit = limits["maintain.untriaged_days"];
    const at = scenario.maintain([makeIncident({ opened: daysAgo(limit) })]);
    const over = scenario.maintain([makeIncident({ opened: daysAgo(limit + 1) })]);
    const rowAt = needsYou(derive(at, NOW), at, NOW).groups[0]!.rows[0]!;
    const rowOver = needsYou(derive(over, NOW), over, NOW).groups[0]!.rows[0]!;
    expect(rowAt).toMatchObject({ kind: "incident", stuck: false, limit });
    expect(rowOver).toMatchObject({ kind: "incident", stuck: true, limit });
  });

  test("days on the card is measured from the stage clock even when stuck is measured elsewhere", () => {
    // Test clock = PR opened (n + 2 days ago); stuck = days since last push (n).
    const d = derive(scenario.testPr("green", 3), NOW)[0]!;
    expect(d.days).toBe(5);
    expect(d.stuck).toBe(true);
  });
});
