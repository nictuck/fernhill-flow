// The card's state line, exactly as the spec's "The card" paragraph, plus
// the labels and time helpers it is built from.

import type { Derived } from "../../src/engine/types.ts";
import { derive } from "../../src/engine/derive.ts";
import { roleLabel, stageLabel, stateLine, stateParts } from "../../src/engine/text.ts";
import { ageMinutes, daysBetween, fmtDate, fmtDays, isStale, needsRefresh, plural } from "../../src/engine/time.ts";
import { NOW, daysAgo, makeIncident, makeIntent } from "../helpers/build.ts";
import { scenario } from "./scenarios.ts";

/** A Derived whose wait began with the stage unless `waitStart`/`waitDays` say otherwise. */
function mk(over: Partial<Derived>): Derived {
  const clockStart = over.clockStart ?? NOW;
  const days = over.days ?? 0;
  return {
    intent: makeIntent(),
    stage: "plan",
    state: "waiting",
    clockStart,
    days,
    waitStart: clockStart,
    waitDays: days,
    stuck: false,
    onBoard: true,
    notes: [],
    ...over,
  };
}

describe("stateLine", () => {
  test("waiting, stuck with a limit", () => {
    const d = mk({ state: "waiting", waitingOn: "product owner", days: 6, stuck: true, limit: 3 });
    expect(stateLine(d, NOW)).toBe("Waiting on product owner for 6 days · stuck, limit 3");
    expect(stateParts(d, NOW)).toEqual({ badge: "Waiting on product owner", rest: "for 6 days", stuck: "stuck, limit 3" });
  });

  test("waiting, not stuck (the limit is not shown)", () => {
    const d = mk({ state: "waiting", waitingOn: "product owner", days: 6, limit: 7 });
    expect(stateLine(d, NOW)).toBe("Waiting on product owner for 6 days");
    expect(stateParts(d, NOW)).toEqual({ badge: "Waiting on product owner", rest: "for 6 days" });
  });

  test("singular day", () => {
    expect(stateLine(mk({ state: "waiting", waitingOn: "engineer", days: 1 }), NOW)).toBe("Waiting on engineer for 1 day");
  });

  test("stuck with no timer (failed release run)", () => {
    const d = mk({ state: "waiting", waitingOn: "release manager", days: 2, stuck: true });
    expect(stateLine(d, NOW)).toBe("Waiting on release manager for 2 days · stuck");
    expect(stateParts(d, NOW).stuck).toBe("stuck");
  });

  test("in progress", () => {
    const d = mk({ state: "progress", days: 2 });
    expect(stateLine(d, NOW)).toBe("In progress · 2 days");
    expect(stateParts(d, NOW)).toEqual({ badge: "In progress", rest: "· 2 days" });
    expect(stateLine(mk({ state: "progress", days: 4, stuck: true, limit: 3 }), NOW)).toBe("In progress · 4 days · stuck, limit 3");
  });

  test("live", () => {
    const d = mk({ state: "live", stage: "maintain", clockStart: "2026-10-12T09:30:00.000Z", days: 29, notes: ["no open incidents"] });
    expect(stateLine(d, NOW)).toBe("Live since 12 Oct · no open incidents");
    expect(stateParts(d, NOW)).toEqual({ badge: "Live", rest: "since 12 Oct · no open incidents" });
    expect(stateLine({ ...d, notes: ["2 incidents triaged"] }, NOW)).toBe("Live since 12 Oct · 2 incidents triaged");
    expect(stateLine({ ...d, notes: ["1 open incident"] }, NOW)).toBe("Live since 12 Oct · 1 open incident");
    expect(stateLine({ ...d, notes: [] }, NOW)).toBe("Live since 12 Oct · no open incidents");
  });

  test("done", () => {
    const d = mk({ state: "done", stage: "done", clockStart: "2026-10-12T09:30:00.000Z", days: 18 });
    expect(stateLine(d, "2026-10-30T12:00:00.000Z")).toBe("Done 12 Oct · 18 days on board");
    expect(stateParts(d, "2026-10-30T12:00:00.000Z")).toEqual({ badge: "Done", rest: "12 Oct · 18 days on board" });
  });

  test("dates outside the current year carry the year", () => {
    const d = mk({ state: "live", clockStart: "2025-12-20T00:00:00.000Z", notes: ["no open incidents"] });
    expect(stateLine(d, NOW)).toBe("Live since 20 Dec 2025 · no open incidents");
  });

  test("stateLine is always badge + rest + optional stuck", () => {
    for (const d of [
      mk({ state: "waiting", waitingOn: "code owner", days: 3, stuck: true, limit: 2 }),
      mk({ state: "progress", days: 0 }),
      mk({ state: "live", notes: ["no open incidents"] }),
      mk({ state: "done", days: 5 }),
    ]) {
      const p = stateParts(d, NOW);
      expect(stateLine(d, NOW)).toBe(`${p.badge} ${p.rest}${p.stuck ? ` · ${p.stuck}` : ""}`);
    }
  });

  test("the waiting phrase counts the wait (waitDays); progress, live and done count the stage clock", () => {
    expect(stateLine(mk({ state: "waiting", waitingOn: "on-call", days: 11, waitDays: 0, limit: 1 }), NOW)).toBe("Waiting on on-call for 0 days");
    expect(stateLine(mk({ state: "waiting", waitingOn: "code owner", days: 5, waitDays: 1, limit: 2 }), NOW)).toBe("Waiting on code owner for 1 day");
    expect(stateLine(mk({ state: "progress", days: 8, waitDays: 2 }), NOW)).toBe("In progress · 8 days");
    expect(stateLine(mk({ state: "done", stage: "done", days: 8, waitDays: 2 }), NOW)).toBe(`Done ${fmtDate(NOW, NOW)} · 8 days on board`);
  });

  test("end to end from derived rows", () => {
    expect(stateLine(derive(scenario.designNoSpec(6), NOW)[0]!, NOW)).toBe("Waiting on product owner for 6 days · stuck, limit 5");
    expect(stateLine(derive(scenario.testPr("running", 0.5), NOW)[0]!, NOW)).toBe("In progress · 2 days");
    expect(stateLine(derive(scenario.maintain([], 20), NOW)[0]!, NOW)).toBe(`Live since ${fmtDate(daysAgo(20), NOW)} · no open incidents`);
    expect(stateLine(derive(scenario.done(18), NOW)[0]!, NOW)).toBe(`Done ${fmtDate(daysAgo(18), NOW)} · 18 days on board`);
  });

  test("Maintain with an incident opened half a day ago on an intent live for 11 days → \"for 0 days\", not stuck", () => {
    const d = derive(scenario.maintain([makeIncident({ opened: daysAgo(0.5) })], 11), NOW)[0]!;
    expect(d.days).toBe(11);
    expect(stateLine(d, NOW)).toBe("Waiting on on-call for 0 days");
    const stuck = derive(scenario.maintain([makeIncident({ opened: daysAgo(2) })], 20), NOW)[0]!;
    expect(stateLine(stuck, NOW)).toBe("Waiting on on-call for 2 days · stuck, limit 1");
  });

  test("Test review pending, PR created 5 days ago and last pushed 1 day ago → \"for 1 day\", not stuck at limit 2", () => {
    const d = derive(scenario.testPr("green", 1, { createdAt: daysAgo(5) }), NOW)[0]!;
    expect(d.days).toBe(5);
    expect(stateLine(d, NOW)).toBe("Waiting on code owner for 1 day");
  });
});

describe("labels", () => {
  test("stageLabel", () => {
    expect(["plan", "design", "build", "test", "deploy", "maintain", "done"].map((s) => stageLabel(s as never))).toEqual([
      "1 Plan",
      "2 Design",
      "3 Build",
      "4 Test",
      "5 Deploy",
      "6 Maintain",
      "Done",
    ]);
  });

  test("roleLabel", () => {
    expect(roleLabel("product owner")).toBe("Product owner");
    expect(roleLabel("on-call")).toBe("On-call");
    expect(roleLabel("release manager")).toBe("Release manager");
  });
});

describe("time", () => {
  test("daysBetween floors whole UTC days and never goes negative", () => {
    expect(daysBetween(daysAgo(6), NOW)).toBe(6);
    expect(daysBetween(daysAgo(6.99), NOW)).toBe(6);
    expect(daysBetween(daysAgo(0.5), NOW)).toBe(0);
    expect(daysBetween(daysAgo(-2), NOW)).toBe(0);
    expect(daysBetween("2026-11-01", NOW)).toBe(9);
    expect(daysBetween("garbage", NOW)).toBe(0);
    expect(daysBetween(NOW, "garbage")).toBe(0);
  });

  test("fmtDate", () => {
    expect(fmtDate("2026-10-12T23:59:00.000Z", NOW)).toBe("12 Oct");
    expect(fmtDate("2026-01-01", NOW)).toBe("1 Jan");
    expect(fmtDate("2025-12-31T12:00:00.000Z", NOW)).toBe("31 Dec 2025");
    expect(fmtDate("not a date", NOW)).toBe("not a date");
  });

  test("fmtDays and plural", () => {
    expect(fmtDays(1)).toBe("1 day");
    expect(fmtDays(6)).toBe("6 days");
    expect(fmtDays(0)).toBe("0 days");
    expect(plural(1, "incident")).toBe("1 incident");
    expect(plural(2, "incident")).toBe("2 incidents");
  });

  test("needsRefresh and isStale (R8): older than the interval, older than three intervals", () => {
    const at = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
    expect(ageMinutes(at(7), NOW)).toBe(7);
    expect(needsRefresh(at(10), NOW, 10)).toBe(false);
    expect(needsRefresh(at(11), NOW, 10)).toBe(true);
    expect(isStale(at(30), NOW, 10)).toBe(false);
    expect(isStale(at(31), NOW, 10)).toBe(true);
    expect(needsRefresh("garbage", NOW, 10)).toBe(false);
  });
});
