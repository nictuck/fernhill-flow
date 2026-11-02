// @vitest-environment jsdom
// R9: every screen in loading, empty, error, stale, refreshing, fixture and
// populated states, with the copy from the spec's "UI state copy" table.

import { screen, within } from "@testing-library/react";
import { NOW, daysAgo, makeRepo, makeSnapshot } from "../helpers/build.ts";
import { makeFlow, populatedSnapshot, renderAt } from "../helpers/render.tsx";

/** ISO for a local wall-clock time, so HH:MM formats back the same in any zone. */
const local = (h: number, m: number) => new Date(2026, 10, 10, h, m).toISOString();
const minutesBefore = (iso: string, min: number) => new Date(Date.parse(iso) - min * 60_000).toISOString();

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("R9 loading", () => {
  for (const path of ["/", "/systems", "/archive", "/intent/0001"]) {
    test(`${path} shows the loading copy in the freshness position`, () => {
      renderAt(path, makeFlow({ status: "loading", mode: null }));
      expect(screen.getByRole("status")).toHaveTextContent("Loading the board…");
      expect(document.querySelector(".skeleton")).not.toBeNull();
      expect(document.title).toBe("Flow");
    });
  }
});

describe("R9 empty", () => {
  test("empty board: spec copy, no Needs-you panel", () => {
    renderAt("/", makeFlow({ snapshot: makeSnapshot() }));
    expect(text(document.querySelector(".empty-screen"))).toBe("No intents yet. Run /intent in fernhill-platform to write the first one.");
    expect(document.querySelector(".needs")).toBeNull();
  });

  test("empty systems: spec copy, platform row still shown as the front door", () => {
    renderAt("/systems", makeFlow({ snapshot: makeSnapshot({ config: { ...makeSnapshot().config, repos: [{ name: "fernhill-platform", site: "fernhillplatform", kind: "platform" }] } }) }));
    expect(text(document.querySelector(".empty-screen"))).toBe("No product repos yet. scripts/new-product adds one.");
    expect(screen.getAllByText("company front door").length).toBeGreaterThan(0);
  });

  test("empty archive", () => {
    renderAt("/archive", makeFlow({ snapshot: makeSnapshot() }));
    expect(text(document.querySelector(".empty-screen"))).toMatch(/^Nothing archived yet\./);
  });

  test("intent not in the snapshot", () => {
    renderAt("/intent/0042", makeFlow({ snapshot: makeSnapshot() }));
    expect(screen.getByText("Intent 0042 is not in this snapshot.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Board" })).toHaveAttribute("href", "/");
  });
});

describe("R9 errors", () => {
  test("token: no snapshot → error screen with the rotate copy and a Refresh button", () => {
    const refresh = vi.fn();
    renderAt("/", makeFlow({ status: "error", lastError: { kind: "token", message: "401", at: NOW, status: 401 }, refresh }));
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("GitHub rejected the token.")).toBeInTheDocument();
    expect(text(alert)).toContain("Rotate GITHUB_TOKEN in Netlify → Site configuration → Environment variables, then Refresh.");
    within(alert).getByRole("button", { name: "Refresh" }).click();
    expect(refresh).toHaveBeenCalled();
  });

  test("token with a snapshot: the board stays under the error block", () => {
    renderAt("/", makeFlow({ snapshot: populatedSnapshot(), lastError: { kind: "token", message: "401", at: NOW, status: 401 } }));
    expect(screen.getByText("GitHub rejected the token.")).toBeInTheDocument();
    expect(document.querySelector(".stages")).not.toBeNull();
  });

  test("rate limit: resets at HH:MM, showing the snapshot from HH:MM", () => {
    const snapshot = populatedSnapshot();
    snapshot.collectedAt = local(14, 10);
    renderAt("/", makeFlow({ snapshot, now: local(14, 30), lastError: { kind: "rate-limit", message: "403", at: local(14, 30), resetAt: local(15, 0), status: 403 } }));
    expect(text(screen.getByRole("alert").querySelector("h2"))).toBe("GitHub rate limit reached; resets at 15:00. Showing the snapshot from 14:10.");
  });

  test("repo not found: per-repo copy on Systems", () => {
    const snapshot = makeSnapshot({
      repos: [makeRepo({ name: "fernhill-platform", site: "fernhillplatform" }), makeRepo({ name: "fernhill-x", error: "404 Not Found" })],
    });
    snapshot.config.repos.push({ name: "fernhill-x", site: "fernhill-x", kind: "product" });
    renderAt("/systems", makeFlow({ snapshot }));
    const copies = document.querySelectorAll(".not-found");
    expect(copies.length).toBeGreaterThan(0);
    expect(text(copies[0]!)).toBe("fernhill-x is in flow.config.json but the token cannot see it. Add it to the token's selected repositories.");
  });

  test("not-found kind with no snapshot names the repo from the message", () => {
    renderAt("/systems", makeFlow({ status: "error", lastError: { kind: "not-found", message: "nictuck/fernhill-x: 404", at: NOW, status: 404 } }));
    expect(text(screen.getByRole("alert").querySelector("h2"))).toBe("fernhill-x is in flow.config.json but the token cannot see it. Add it to the token's selected repositories.");
  });

  test("config kind: 'Refresh failed: message' in the failed strip", () => {
    renderAt("/", makeFlow({ snapshot: populatedSnapshot(), lastError: { kind: "config", message: "PLATFORM_REPO is malformed", at: NOW } }));
    expect(text(screen.getByRole("status"))).toContain("Refresh failed: PLATFORM_REPO is malformed");
  });

  test("upstream with no snapshot: failed error screen", () => {
    renderAt("/", makeFlow({ status: "error", lastError: { kind: "upstream", message: "502", at: local(14, 2), status: 502 } }));
    expect(text(screen.getByRole("alert").querySelector("h2"))).toBe("Refresh failed at 14:02 (GitHub 502). No snapshot yet.");
  });
});

describe("R9 freshness strip", () => {
  test("fresh: 'Snapshot from 3 min ago · Refresh'", () => {
    const now = local(14, 30);
    const snapshot = populatedSnapshot();
    snapshot.collectedAt = minutesBefore(now, 3);
    renderAt("/", makeFlow({ snapshot, mode: "fixture", now }));
    const strip = screen.getByRole("status");
    expect(text(strip)).toBe("Snapshot from 3 min ago · Refresh");
    expect(within(strip).getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  test("refreshing: 'Showing snapshot from 3 min ago · refreshing…'", () => {
    const now = local(14, 30);
    const snapshot = populatedSnapshot();
    snapshot.collectedAt = minutesBefore(now, 3);
    renderAt("/", makeFlow({ snapshot, mode: "fixture", now, refreshing: true }));
    expect(text(screen.getByRole("status"))).toBe("Showing snapshot from 3 min ago · refreshing…");
    expect(document.querySelector(".stages")).not.toBeNull(); // the previous snapshot stays visible
  });

  test("stale (> 3 × interval): the stale copy with 'Refresh now' as the button", () => {
    const now = local(16, 0);
    const snapshot = populatedSnapshot();
    snapshot.collectedAt = minutesBefore(now, 120);
    renderAt("/", makeFlow({ snapshot, mode: "fixture", now }));
    const strip = screen.getByRole("status");
    expect(text(strip)).toBe("Stale — last refresh 2 h ago. Refresh now. If it fails, check the function log and the token expiry.");
    expect(within(strip).getByRole("button", { name: "Refresh now" })).toBeInTheDocument();
  });

  test("just over the interval is not stale yet", () => {
    const now = local(16, 0);
    const snapshot = populatedSnapshot();
    snapshot.collectedAt = minutesBefore(now, 15);
    renderAt("/", makeFlow({ snapshot, mode: "fixture", now, stale: true }));
    expect(text(screen.getByRole("status"))).toBe("Snapshot from 15 min ago · Refresh");
  });

  test("failed: 'Refresh failed at 14:02 (GitHub 502). Showing the snapshot from 13:50.' then Refresh", () => {
    const snapshot = populatedSnapshot();
    snapshot.collectedAt = local(13, 50);
    renderAt("/", makeFlow({ snapshot, mode: "fixture", now: local(14, 5), lastError: { kind: "upstream", message: "Bad Gateway", at: local(14, 2), status: 502 } }));
    const strip = screen.getByRole("status");
    expect(text(strip)).toBe("Refresh failed at 14:02 (GitHub 502). Showing the snapshot from 13:50. Refresh");
    expect(within(strip).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  test("ages: hours and days", () => {
    const now = local(12, 0);
    const snapshot = populatedSnapshot();
    snapshot.collectedAt = daysAgo(1, now);
    renderAt("/", makeFlow({ snapshot, mode: "fixture", now, lastError: { kind: "upstream", message: "x", at: now } }));
    expect(text(screen.getByRole("status"))).toContain("Refresh failed at 12:00 (network).");
  });
});

describe("R9 fixture and populated", () => {
  test("fixture banner copy", () => {
    renderAt("/", makeFlow({ snapshot: populatedSnapshot(), mode: "fixture" }));
    expect(screen.getByText("This deploy has no GitHub token; showing fixture data.")).toHaveClass("banner", "fixture");
  });

  test("the bundled sample fixture renders every stage and sets the title count", async () => {
    const sample = (await import("../../src/fixtures/sample.json")).default as unknown as ReturnType<typeof populatedSnapshot>;
    renderAt("/", makeFlow({ snapshot: sample, mode: "fixture", now: sample.collectedAt }));
    for (const h of ["1 Plan", "2 Design", "3 Build", "4 Test", "5 Deploy", "6 Maintain", "Done"]) {
      expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
    }
    expect(document.title).toMatch(/^Flow \(\d+\)$/);
    expect(screen.getByRole("heading", { name: /^Needs you \(\d+\)$/ })).toBeInTheDocument();
  });

  test("populated board: Needs you first, exceptions strip, stuck counts, Done footer", () => {
    renderAt("/", makeFlow({ snapshot: populatedSnapshot() }));
    const main = screen.getByRole("main");
    const order = Array.from(main.children).map((c) => c.className);
    expect(order.indexOf("needs")).toBeLessThan(order.findIndex((c) => c.startsWith("banner exception")));
    expect(text(document.querySelector(".banner.exception"))).toBe("Exception EX-001 active — grants merge in 2 repos until 30 Nov. Read it");
    expect(screen.getByRole("link", { name: "Read it" })).toHaveAttribute("href", expect.stringContaining("github.com/nictuck/fernhill-platform/"));
    expect(screen.getAllByText(/^\d+ stuck$/).length).toBeGreaterThan(0);
    expect(text(document.querySelector(".stage-col.done .footer"))).toBe("Done: 1 older → Archive");
    expect(document.querySelector(".stage-col.is-empty")).toBeNull();
  });

  test("nothing waits: the quiet copy with real numbers", () => {
    const snapshot = populatedSnapshot();
    // keep only the in-progress and done intents
    snapshot.platform.intents = snapshot.platform.intents.filter((i) => i.id === "0009" || i.id === "0012");
    snapshot.platform.incidents = [];
    renderAt("/", makeFlow({ snapshot }));
    expect(text(document.querySelector(".needs .quiet"))).toBe("Nothing is waiting on you. 0 in progress, 0 stuck.");
    expect(document.title).toBe("Flow");
    expect(screen.getByText("No intents in Plan")).toHaveClass("empty");
    expect(document.querySelectorAll(".stage-col.is-empty").length).toBe(6);
  });

  test("stage detail opens from ?stage= and shows each card's time in stage", () => {
    renderAt("/?stage=test", makeFlow({ snapshot: populatedSnapshot() }));
    const section = document.querySelector(".stage-col.is-open")!;
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByRole("button", { name: "Hide" })).toHaveAttribute("aria-expanded", "true");
    const detail = text(section.querySelector(".stage-detail"));
    expect(detail).toMatch(/^2 intents( · median \d+(\.\d+)? d · max \d+ d · n=\d+)? · 1 stuck/);
    expect(detail).not.toContain("n/a");
    expect(detail).toContain("0004 Persona editor · 2 days in stage · stuck, limit 1");
    expect(section.querySelector("button")).toHaveAttribute("aria-controls", "stage-test-detail");
    expect(document.getElementById("stage-test-detail")).not.toBeNull();
  });

  test("Done expands in place too (R6): a one-line detail with the Archive count; aria-controls only while open", () => {
    renderAt("/", makeFlow({ snapshot: populatedSnapshot() }));
    const done = document.querySelector(".stage-col.done")!;
    const btn = done.querySelector("button")!;
    expect(btn).toHaveTextContent("Details");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).not.toHaveAttribute("aria-controls");
    renderAt("/?stage=done", makeFlow({ snapshot: populatedSnapshot() }));
    const open = document.querySelector(".stage-col.done.is-open")!;
    expect(open.querySelector("button")).toHaveTextContent("Hide");
    expect(open.querySelector("button")).toHaveAttribute("aria-controls", "stage-done-detail");
    expect(text(open.querySelector(".stage-detail"))).toMatch(/^1 intent on board · \d+ intents? older in Archive$/);
    expect(open.querySelectorAll(".card").length).toBe(1);
  });

  test("intent stuck analysis compares the wait, not the time in stage, with the limit", () => {
    renderAt("/intent/0001", makeFlow({ snapshot: populatedSnapshot() }));
    const analysis = text(document.querySelector(".analysis"));
    expect(analysis).toMatch(/^Stuck: waited \d+ days?, limit 3 days \(design\.spec_pr_open_days\) · \d+ days? in Design\.$/);
  });

  test("intent header: one state string, stage after it; pending timeline entries say so in text", () => {
    renderAt("/intent/0001", makeFlow({ snapshot: populatedSnapshot() }));
    const row = document.querySelector(".intent-head .state-row")!;
    const parts = Array.from(row.querySelector(".state")!.children).map((c) => text(c));
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("Waiting on product owner");
    expect(parts[1]).toMatch(/^for \d+ days?$/);
    expect(parts[2]).toBe("stuck, limit 3");
    expect(row.lastElementChild).toHaveClass("stage");
    expect(row.lastElementChild).toHaveTextContent("Design");
    const timeline = screen.getByRole("list", { name: "Timeline" });
    const pendingTicks = timeline.querySelectorAll(".tick.pending");
    expect(pendingTicks.length).toBeGreaterThan(0);
    for (const tick of pendingTicks) expect(text(tick.parentElement)).toContain("· pending");
  });

  test("stage detail shows no statistics under five measured durations", () => {
    const snapshot = populatedSnapshot();
    snapshot.platform.intents = snapshot.platform.intents.filter((i) => i.id === "0001");
    renderAt("/?stage=design", makeFlow({ snapshot }));
    const detail = text(document.querySelector(".stage-col.is-open .stage-detail"));
    expect(detail).toMatch(/^1 intent · 1 stuck/);
    expect(detail).not.toContain("median");
    expect(detail).toContain("0001 Flow dashboard · 8 days in stage · stuck");
  });

  test("systems evaluates active exceptions at now, like the Board", () => {
    renderAt("/systems", makeFlow({ snapshot: populatedSnapshot(), now: "2026-12-05T12:00:00.000Z" }));
    expect(document.querySelector(".banner.exception")).toBeNull();
  });

  test("systems populated: both repos, status lines with text, release badge, CI badge", () => {
    renderAt("/systems", makeFlow({ snapshot: populatedSnapshot() }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("Production matches staging")).toHaveClass("line-ok");
    expect(within(table).getByText(/^Production is 3 commits behind staging/)).toHaveClass("line-behind");
    expect(within(table).getByText("pending approval")).toHaveClass("badge");
    expect(within(table).getAllByText("green")[0]).toHaveClass("badge");
    expect(within(table).getByRole("link", { name: "run #41355" })).toHaveAttribute("href", "https://github.com/nictuck/fernhill-flow/actions/runs/41355");
    expect(text(document.querySelector(".banner.exception"))).toContain("Exception EX-001 active");
  });

  test("archive: done, parked and rejected with status, date and who", () => {
    renderAt("/archive", makeFlow({ snapshot: populatedSnapshot() }));
    const rows = screen.getAllByRole("row").slice(1);
    const statuses = rows.map((r) => text(r.querySelector(".badge")));
    expect(statuses.sort()).toEqual(["done", "done", "parked", "rejected"]);
    const rejected = rows.find((r) => text(r).includes("Mobile app"))!;
    expect(text(rejected)).toContain("7 Nov");
    expect(text(rejected)).toContain("nictuck");
  });

  test("intent detail: header, action, timeline with sources and 'under EX-001'", () => {
    renderAt("/intent/0005", makeFlow({ snapshot: populatedSnapshot() }));
    expect(screen.getByRole("heading", { level: 1, name: "Status page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Approve production for run #41355" })).toHaveAttribute("href", expect.stringContaining("/actions/runs/41355"));
    const timeline = screen.getByRole("list", { name: "Timeline" });
    expect(within(timeline).getByText("under EX-001")).toBeInTheDocument();
    expect(within(timeline).getByRole("link", { name: /PR #11 merged \(gate 4\)/ })).toHaveAttribute("href", "https://github.com/nictuck/fernhill-flow/pull/11");
    expect(within(timeline).getByText(/duplicate/)).toBeInTheDocument(); // dismissed incident shows its reason
  });

  test("intent detail: dismissed incident without a reason says so", () => {
    const snapshot = populatedSnapshot();
    snapshot.platform.incidents[1]!.reason = "";
    renderAt("/intent/0006", makeFlow({ snapshot }));
    expect(screen.getByText(/no reason recorded/)).toBeInTheDocument();
  });
});
