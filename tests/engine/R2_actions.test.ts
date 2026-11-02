// R2: one case per row of the spec's Derivation table — exact action copy,
// link vs copyable command, and the secondary "View …" link.

import type { Action, Snapshot } from "../../src/engine/types.ts";
import { derive } from "../../src/engine/derive.ts";
import { GH, NOW, daysAgo, makeIncident, makeIntent, makePlan, makePr } from "../helpers/build.ts";
import { INTENT_PR_URL, SPEC_PR_URL, SPEC_URL, linkedIntent, productRepo, runFor, scenario, snapshotWith } from "./scenarios.ts";

function action(snapshot: Snapshot): Action {
  const a = derive(snapshot, NOW)[0]!.action;
  expect(a).toBeDefined();
  return a!;
}

test("product owner (gate 1): \"Accept or reject intent NNNN\" → the intent PR", () => {
  expect(action(scenario.planPr())).toEqual({ text: "Accept or reject intent 0001", href: INTENT_PR_URL });
});

test("product owner (design not started): `/design NNNN` copyable · View intent → the intent directory", () => {
  expect(action(scenario.designNoSpec())).toEqual({
    text: "/design 0001",
    copy: "/design 0001",
    secondary: { text: "View intent", href: `${GH}/fernhill-platform/tree/main/intent/0001-example` },
  });
});

test("product owner (gate 2): \"Accept spec NNNN (N concerns open)\" → the spec PR", () => {
  expect(action(scenario.designSpecPr(1, 2))).toEqual({ text: "Accept spec 0001 (2 concerns open)", href: SPEC_PR_URL });
  expect(action(scenario.designSpecPr(1, 1)).text).toBe("Accept spec 0001 (1 concern open)");
  expect(action(scenario.designSpecPr(1, 0)).text).toBe("Accept spec 0001");
});

test("product owner (no product repo): `scripts/new-product ‹slug› --intent NNNN` copyable · View spec → the spec", () => {
  expect(action(scenario.buildNoRepo())).toEqual({
    text: "scripts/new-product example --intent 0001",
    copy: "scripts/new-product example --intent 0001",
    secondary: { text: "View spec", href: SPEC_URL },
  });
  const slug = snapshotWith({ intents: [makeIntent({ dir: "0001-flow-dashboard", spec: { status: "accepted", flagged: 0, url: SPEC_URL, acceptedAt: daysAgo(1) } })] });
  expect(action(slug).copy).toBe("scripts/new-product flow-dashboard --intent 0001");
});

test("engineer (plan not started): `/plan NNNN` copyable · View repo → the product repo", () => {
  expect(action(scenario.buildNoPlan())).toEqual({
    text: "/plan 0001",
    copy: "/plan 0001",
    secondary: { text: "View repo", href: `${GH}/fernhill-flow` },
  });
});

test("engineer (plan proposed): \"Approve plan ‹path›\" → the plan file", () => {
  expect(action(scenario.buildProposedPlan())).toEqual({
    text: "Approve plan plan/0001-example.md",
    href: `${GH}/fernhill-flow/blob/main/plan/0001-example.md`,
  });
});

test("engineer (CI red): \"CI failing on PR #N\" → the failing check", () => {
  expect(action(scenario.testPr("red", 0.5, { ciUrl: `${GH}/fernhill-flow/actions/runs/55/job/9` }))).toEqual({
    text: "CI failing on PR #5",
    href: `${GH}/fernhill-flow/actions/runs/55/job/9`,
  });
  expect(action(scenario.testPr("red")).href).toBe(`${GH}/fernhill-flow/pull/5/checks`);
});

test("code owner (gate 4): \"Review and merge PR #N\" → the PR", () => {
  expect(action(scenario.testPr("green"))).toEqual({ text: "Review and merge PR #5", href: `${GH}/fernhill-flow/pull/5` });
});

test("release manager (gate 5): \"Approve production for run #N\" → the run's review page", () => {
  expect(action(scenario.deploy([runFor()]))).toEqual({
    text: "Approve production for run #100",
    href: `${GH}/fernhill-flow/actions/runs/100`,
  });
});

test("release manager (run failed): \"Release run #N failed\" → the run", () => {
  expect(action(scenario.deploy([runFor({ status: "completed", conclusion: "failure", pendingApproval: false })]))).toEqual({
    text: "Release run #100 failed",
    href: `${GH}/fernhill-flow/actions/runs/100`,
  });
});

test("on-call (gate 6): \"Triage incident ‹slug›\" → the incident file", () => {
  expect(action(scenario.maintain([makeIncident()]))).toEqual({
    text: "Triage incident blank-board",
    href: `${GH}/fernhill-platform/blob/main/incidents/2026-11-09-blank-board.md`,
  });
});

test("copyable commands carry no href; linked actions carry no copy", () => {
  for (const snap of [scenario.designNoSpec(), scenario.buildNoRepo(), scenario.buildNoPlan()]) {
    const a = action(snap);
    expect(a.href).toBeUndefined();
    expect(a.copy).toBe(a.text);
    expect(a.secondary?.href).toMatch(/^https:\/\/github\.com\/nictuck\//);
  }
  for (const snap of [scenario.planPr(), scenario.designSpecPr(), scenario.testPr("green"), scenario.deploy([runFor()])]) {
    const a = action(snap);
    expect(a.copy).toBeUndefined();
    expect(a.secondary).toBeUndefined();
    expect(a.href).toMatch(/^https:\/\/github\.com\/nictuck\//);
  }
});

test("R18: an href outside the configured owner is dropped; the text stays", () => {
  const evil = snapshotWith({
    intents: [linkedIntent()],
    repos: [productRepo({ plans: [makePlan()], prs: [makePr({ number: 5, url: "https://evil.example/pull/5" })] })],
  });
  expect(action(evil)).toEqual({ text: "Review and merge PR #5" });
});

test("no action in Done, Live and In progress states", () => {
  for (const snap of [scenario.done(), scenario.maintain(), scenario.deploy([]), scenario.testPr("running"), scenario.buildApproved()]) {
    expect(derive(snap, NOW)[0]!.action).toBeUndefined();
  }
});
