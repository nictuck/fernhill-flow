// R6: stage detail — occupants and stuck count always; median/max only once
// five or more intents have a measurable duration for the stage.

import type { Intent } from "../../src/engine/types.ts";
import { derive } from "../../src/engine/derive.ts";
import { median, stageDetail } from "../../src/engine/stages.ts";
import { NOW, daysAgo, makeIntent, makePlan, makePr } from "../helpers/build.ts";
import { acceptedSpec, linkedIntent, mergedPr, productRepo, snapshotWith } from "./scenarios.ts";

/** An intent that spent `days` days in Design (accepted → spec accepted) and has moved on to Build. */
function throughDesign(n: number, days: number): Intent {
  const id = String(n).padStart(4, "0");
  return makeIntent({ id, dir: `${id}-x`, acceptedAt: daysAgo(days + 20), spec: acceptedSpec(20) });
}

test("n = 4 completed passes: count and stuckCount, no stats", () => {
  const snap = snapshotWith({ intents: [2, 4, 6, 8].map((d, i) => throughDesign(i + 1, d)) });
  const detail = stageDetail("design", derive(snap, NOW), snap, NOW);
  expect(detail).toEqual({ count: 0, stuckCount: 0 });
});

test("n = 5 completed passes: stats with the right median and max", () => {
  const snap = snapshotWith({ intents: [10, 2, 6, 4, 8].map((d, i) => throughDesign(i + 1, d)) });
  const detail = stageDetail("design", derive(snap, NOW), snap, NOW);
  expect(detail).toEqual({ count: 0, stuckCount: 0, stats: { n: 5, medianDays: 6, maxDays: 10 } });
});

test("current occupants count with their days so far, and are not double counted", () => {
  const snap = snapshotWith({
    intents: [...[2, 4, 6, 8].map((d, i) => throughDesign(i + 1, d)), makeIntent({ id: "0009", dir: "0009-now", acceptedAt: daysAgo(7) })],
  });
  const detail = stageDetail("design", derive(snap, NOW), snap, NOW);
  expect(detail).toEqual({ count: 1, stuckCount: 1, stats: { n: 5, medianDays: 6, maxDays: 8 } });
});

test("Test durations come from the latest build PR's open → merged span", () => {
  const prs = [3, 1, 2, 5, 4].map((days, i) =>
    mergedPr({ number: i + 1, intent: String(i + 1).padStart(4, "0"), branch: `build/000${i + 1}-x`, createdAt: daysAgo(days + 10), mergedAt: daysAgo(10), inProduction: true, servedLive: true }),
  );
  const intents = prs.map((pr) => linkedIntent({ id: pr.intent!, dir: `${pr.intent}-x` }));
  const snap = snapshotWith({ intents, repos: [productRepo({ prs })] });
  expect(stageDetail("test", derive(snap, NOW), snap, NOW)).toEqual({ count: 0, stuckCount: 0, stats: { n: 5, medianDays: 3, maxDays: 5 } });
});

test("a stage with only current occupants below five has no stats", () => {
  const snap = snapshotWith({
    intents: [linkedIntent()],
    repos: [productRepo({ plans: [makePlan()], prs: [makePr({ ci: "red", updatedAt: daysAgo(3) })] })],
  });
  expect(stageDetail("test", derive(snap, NOW), snap, NOW)).toEqual({ count: 1, stuckCount: 1 });
});

test("median handles odd, even and empty inputs", () => {
  expect(median([5, 1, 3])).toBe(3);
  expect(median([1, 2, 3, 4])).toBe(2.5);
  expect(median([])).toBe(0);
});
