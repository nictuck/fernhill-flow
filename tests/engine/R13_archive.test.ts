// R13: Archive — every done, parked and rejected intent with its final
// status, when it was set and by whom, newest first. Also the board grouping
// that feeds R1's seven columns and the "Done: N older → Archive" footer.

import { derive } from "../../src/engine/derive.ts";
import { archive, board, olderDoneCount } from "../../src/engine/archive.ts";
import { STAGES } from "../../src/engine/types.ts";
import { NOW, daysAgo, makeIntent, makePlan, makePr } from "../helpers/build.ts";
import { linkedIntent, productRepo, snapshotWith } from "./scenarios.ts";

const snap = snapshotWith({
  intents: [
    makeIntent({ id: "0001", dir: "0001-a", status: "done", statusSetAt: daysAgo(45), statusSetBy: "nictuck" }),
    makeIntent({ id: "0002", dir: "0002-b", status: "parked", statusSetAt: daysAgo(3), statusSetBy: "nictuck" }),
    makeIntent({ id: "0003", dir: "0003-c", acceptedAt: daysAgo(12) }), // active, Design, stuck
    makeIntent({ id: "0004", dir: "0004-d", status: "rejected", statusSetAt: daysAgo(10), statusSetBy: "someone-else" }),
    makeIntent({ id: "0005", dir: "0005-e", status: "done", statusSetAt: daysAgo(1), statusSetBy: "nictuck" }),
    linkedIntent({ id: "0006", dir: "0006-f" }), // Test, CI red, stuck
  ],
  repos: [productRepo({ plans: [makePlan({ intent: "0006" })], prs: [makePr({ intent: "0006", branch: "build/0006-f", ci: "red", updatedAt: daysAgo(2) })] })],
});
const rows = derive(snap, NOW);

test("archive lists done, parked and rejected — including done still on the board — newest status change first", () => {
  const a = archive(rows);
  expect(a.map((d) => d.intent.id)).toEqual(["0005", "0002", "0004", "0001"]);
  expect(a.map((d) => d.intent.status)).toEqual(["done", "parked", "rejected", "done"]);
  expect(a.map((d) => d.intent.statusSetBy)).toEqual(["nictuck", "nictuck", "someone-else", "nictuck"]);
  expect(a.map((d) => d.clockStart)).toEqual([daysAgo(1), daysAgo(3), daysAgo(10), daysAgo(45)]);
});

test("archive never holds an active intent", () => {
  expect(archive(rows).some((d) => d.intent.id === "0003" || d.intent.id === "0006")).toBe(false);
});

test("board has every stage in order, only rows on the board, with stuck counts", () => {
  const groups = board(rows);
  expect(groups.map((g) => g.stage)).toEqual([...STAGES]);
  const byStage = Object.fromEntries(groups.map((g) => [g.stage, g.rows.map((d) => d.intent.id)]));
  expect(byStage).toEqual({ plan: [], design: ["0003"], build: [], test: ["0006"], deploy: [], maintain: [], done: ["0005"] });
  expect(groups.find((g) => g.stage === "design")!.stuckCount).toBe(1);
  expect(groups.find((g) => g.stage === "test")!.stuckCount).toBe(1);
  expect(groups.find((g) => g.stage === "done")!.stuckCount).toBe(0);
});

test("the Done footer counts done intents that have left the board", () => {
  expect(olderDoneCount(rows)).toBe(1); // 0001, 45 days
});

test("Done column is newest first; other stages stuck first then oldest", () => {
  const many = snapshotWith({
    intents: [
      makeIntent({ id: "0001", dir: "0001-a", status: "done", statusSetAt: daysAgo(20) }),
      makeIntent({ id: "0002", dir: "0002-b", status: "done", statusSetAt: daysAgo(2) }),
      makeIntent({ id: "0003", dir: "0003-c", acceptedAt: daysAgo(1) }),
      makeIntent({ id: "0004", dir: "0004-d", acceptedAt: daysAgo(9) }),
      makeIntent({ id: "0005", dir: "0005-e", acceptedAt: daysAgo(4) }),
    ],
  });
  const groups = board(derive(many, NOW));
  expect(groups.find((g) => g.stage === "done")!.rows.map((d) => d.intent.id)).toEqual(["0002", "0001"]);
  expect(groups.find((g) => g.stage === "design")!.rows.map((d) => d.intent.id)).toEqual(["0004", "0005", "0003"]);
});
