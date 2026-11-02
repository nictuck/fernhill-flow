// R11: fixture 000 is a real snapshot captured from the live repos by
// `make spike` on 2026-11-01 21:13 UTC. The expectations below were
// hand-checked against GitHub and Netlify at capture time:
//   - intent 0001 accepted 2026-10-31 18:33Z (PR #1), spec accepted
//     2026-11-01 20:12Z (PR #5), product fernhill-flow linked (PR #8);
//   - fernhill-flow had no plan on main yet → Build, waiting on the
//     engineer to run /plan 0001;
//   - platform production had never been released: production branch
//     27 commits behind main, the live site served no version.txt;
//   - fernhill-flow production served the template commit, one commit
//     behind main (the setup PR), with a release run waiting for approval;
//   - EX-001 active (granted 2026-10-31, expires 2026-11-30); no incidents.
// If the engine changes legitimately, re-check these against the fixture,
// never against today's GitHub.

import fixture from "../fixtures/000-live.json" with { type: "json" };
import type { Snapshot } from "../../src/engine/types.ts";
import { SCHEMA_VERSION } from "../../src/engine/types.ts";
import { derive, needsYou, systems, board, archive, timeline } from "../../src/engine/index.ts";

const snap = fixture as unknown as Snapshot;
const now = snap.collectedAt;

describe("R11 fixture 000 (live snapshot, hand-checked)", () => {
  test("is the current schema and names both repos", () => {
    expect(snap.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snap.config.repos.map((r) => r.name)).toEqual(["fernhill-platform", "fernhill-flow"]);
    expect(snap.platform.intents.map((i) => i.id)).toEqual(["0001"]);
  });

  test("intent 0001 is in Build, waiting on the engineer to run /plan", () => {
    const rows = derive(snap, now);
    expect(rows).toHaveLength(1);
    const d = rows[0]!;
    expect(d.stage).toBe("build");
    expect(d.state).toBe("waiting");
    expect(d.waitingOn).toBe("engineer");
    expect(d.action?.copy).toBe("/plan 0001");
    expect(d.action?.secondary?.href).toBe("https://github.com/nictuck/fernhill-flow");
    expect(d.clockStart).toBe("2026-11-01T20:12:10Z");
    expect(d.days).toBe(0);
    expect(d.stuck).toBe(false);
    expect(d.thresholdKey).toBe("build.no_plan_days");
    expect(d.limit).toBe(5);
    expect(d.onBoard).toBe(true);
  });

  test("Needs you has exactly the engineer row; nothing in progress or stuck", () => {
    const rows = derive(snap, now);
    const n = needsYou(rows, snap, now);
    expect(n.count).toBe(1);
    expect(n.groups.map((g) => g.role)).toEqual(["engineer"]);
    expect(n.inProgress).toBe(0);
    expect(n.stuck).toBe(0);
  });

  test("board has the one card under Build and an empty archive", () => {
    const rows = derive(snap, now);
    const groups = board(rows);
    const byStage = Object.fromEntries(groups.map((g) => [g.stage, g.rows.length]));
    expect(byStage["build"]).toBe(1);
    expect(groups.reduce((s, g) => s + g.rows.length, 0)).toBe(1);
    expect(archive(rows)).toHaveLength(0);
  });

  test("Systems: platform never released (behind, no production version); flow one commit behind with a run awaiting approval", () => {
    const rows = systems(snap);
    expect(rows.map((r) => r.repo.name)).toEqual(["fernhill-platform", "fernhill-flow"]);
    const [platform, flow] = rows as [typeof rows[number], typeof rows[number]];
    expect(platform.repo.production.version).toBeUndefined();
    expect(platform.line.kind).toBe("behind");
    expect(platform.line.text).toContain("27 commits behind staging");
    expect(flow.line.kind).toBe("behind");
    expect(flow.line.text).toMatch(/1 commit/);
    expect(flow.lastRelease?.pendingApproval).toBe(true);
    expect(flow.openIncidents).toBe(0);
  });

  test("timeline carries both gate signatures with who and when", () => {
    const entries = timeline("0001", snap, now);
    const accepted = entries.find((e) => e.kind === "intent-accepted");
    const specAccepted = entries.find((e) => e.kind === "spec-accepted");
    expect(accepted?.at).toBe("2026-10-31T18:33:44Z");
    expect(accepted?.who).toBe("nictuck");
    expect(specAccepted?.at).toBe("2026-11-01T20:12:10Z");
    expect(specAccepted?.who).toBe("nictuck");
    // EX-001 was in effect when the spec merged; the entry says so (R5).
    expect(specAccepted?.exception).toBe("EX-001");
    expect(snap.platform.exceptions.map((e) => e.id)).toEqual(["EX-001"]);
  });
});
