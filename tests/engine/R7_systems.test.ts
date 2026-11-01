// R7: the plain-language systems line per repo, plus the counts beside it.

import { systems, systemsLine } from "../../src/engine/systems.ts";
import { PLATFORM, daysAgo, makeIncident, makePr, makeRepo, makeRun, makeSnapshot } from "../helpers/build.ts";

const C = "c".repeat(40);
const E = "e".repeat(40);

test("ok: production serves what staging serves", () => {
  expect(systemsLine(makeRepo())).toEqual({ kind: "ok", text: "Production matches staging" });
});

test("behind: production branch is N commits behind main, with the date when known", () => {
  const repo = makeRepo({ production: { url: "https://fernhill-flow.netlify.app", version: E }, productionHead: E, productionBehindMain: { count: 3, since: "2026-10-28" } });
  expect(systemsLine(repo, "2026-11-10T12:00:00Z")).toEqual({ kind: "behind", text: "Production is 3 commits behind staging (since 28 Oct)" });
  const noSince = makeRepo({ production: { url: "x", version: E }, productionHead: E, productionBehindMain: { count: 1 } });
  expect(systemsLine(noSince).text).toBe("Production is 1 commit behind staging");
  const lastYear = makeRepo({ production: { url: "x", version: E }, productionHead: E, productionBehindMain: { count: 2, since: "2025-12-30" } });
  expect(systemsLine(lastYear, "2026-11-10T12:00:00Z").text).toBe("Production is 2 commits behind staging (since 30 Dec 2025)");
});

test("rollback in effect: the live site serves a sha the production branch is not at", () => {
  const repo = makeRepo({ production: { url: "x", version: E }, productionHead: C, productionBehindMain: { count: 0 } });
  expect(systemsLine(repo)).toEqual({ kind: "rollback", text: "Rollback in effect: production serves eeeeeee, branch is at ccccccc" });
});

test("rollback wins over behind: both are true after a rollback and a later merge to main", () => {
  const repo = makeRepo({ production: { url: "x", version: E }, productionHead: C, productionBehindMain: { count: 2, since: "2026-11-01" } });
  expect(systemsLine(repo).kind).toBe("rollback");
});

test("unknown: names what is missing", () => {
  expect(systemsLine(makeRepo({ production: { url: "x", error: "HTTP 404" } }))).toEqual({
    kind: "unknown",
    text: "Production version unknown (HTTP 404)",
  });
  expect(systemsLine(makeRepo({ production: { url: "x" } })).text).toBe("Production version unknown (version.txt missing or invalid)");
  expect(systemsLine(makeRepo({ production: { url: "x", version: E }, staging: { url: "y" }, productionHead: E })).text).toBe(
    "Staging version unknown (version.txt missing or invalid)",
  );
  const noHead = makeRepo({ production: { url: "x", version: E } });
  delete (noHead as { productionHead?: string }).productionHead;
  delete (noHead as { productionBehindMain?: unknown }).productionBehindMain;
  expect(systemsLine(noHead).text).toBe("Production branch missing");
  const deploying = makeRepo({ production: { url: "x", version: E }, productionHead: E, productionBehindMain: { count: 0 } });
  expect(systemsLine(deploying)).toEqual({ kind: "unknown", text: "Staging serves ccccccc, production serves eeeeeee (staging may still be deploying)" });
});

test("a repo the collector could not read shows its error", () => {
  expect(systemsLine(makeRepo({ error: "fernhill-x is in flow.config.json but the token cannot see it." }))).toEqual({
    kind: "unknown",
    text: "fernhill-x is in flow.config.json but the token cannot see it.",
  });
});

test("rows follow flow.config.json order with open PR / incident counts and the newest release run", () => {
  const older = makeRun({ id: 100, createdAt: daysAgo(3) });
  const newest = makeRun({ id: 101, createdAt: daysAgo(1), status: "completed", conclusion: "success", pendingApproval: false });
  const snapshot = makeSnapshot({
    repos: [
      makeRepo({
        name: "fernhill-flow",
        prs: [makePr({ number: 1 }), makePr({ number: 2, state: "merged" }), makePr({ number: 3, state: "closed" })],
        releaseRuns: [newest, older],
      }),
      makeRepo({ name: PLATFORM, site: "fernhillplatform" }),
    ],
    platform: {
      intents: [],
      exceptions: [],
      personas: [],
      incidents: [
        makeIncident(),
        makeIncident({ path: "incidents/2026-11-08-x.md", status: "fix-now" }),
        makeIncident({ path: "incidents/2026-11-07-y.md", product: "fernhill-other" }),
      ],
    },
  });
  const rows = systems(snapshot);
  expect(rows.map((r) => r.repo.name)).toEqual([PLATFORM, "fernhill-flow"]);
  const flow = rows[1]!;
  expect(flow.openPrs).toBe(1);
  expect(flow.openIncidents).toBe(1);
  expect(flow.lastRelease?.id).toBe(101);
  expect(rows[0]!.lastRelease).toBeUndefined();
  expect(rows[0]!.openIncidents).toBe(0);
});

test("a repo not listed in config still appears, after the configured ones", () => {
  const snapshot = makeSnapshot({ repos: [makeRepo({ name: "fernhill-stray" }), makeRepo({ name: PLATFORM, site: "fernhillplatform" })] });
  expect(systems(snapshot).map((r) => r.repo.name)).toEqual([PLATFORM, "fernhill-stray"]);
});
