// @vitest-environment jsdom
// R12: every action in Needs you and on every card is a focusable
// <a href> or <button>, in DOM order; every badge carries text; nav has
// aria-current; stage toggles have aria-expanded.

import { screen } from "@testing-library/react";
import { NOW } from "../helpers/build.ts";
import { makeFlow, populatedSnapshot, renderAt } from "../helpers/render.tsx";
import { derive, needsYou } from "../../src/engine/index.ts";
import type { Action } from "../../src/engine/types.ts";

const FOCUSABLE = 'a[href], button:not([disabled])';

function isFocusable(el: Element): boolean {
  if (el.matches("a[href]")) return true;
  if (el.matches("button") && !(el as HTMLButtonElement).disabled) return true;
  return false;
}

/** The element a person tabs to for this action, inside `root`. */
function controlFor(root: Element, action: Action): Element {
  if (action.copy) {
    const btn = Array.from(root.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === `Copy ${action.copy}`);
    expect(btn, `copy button for ${action.copy}`).toBeDefined();
    return btn!;
  }
  const a = Array.from(root.querySelectorAll("a[href]")).find((x) => x.textContent === action.text && x.getAttribute("href") === action.href);
  expect(a, `link for ${action.text}`).toBeDefined();
  return a!;
}

describe("R12 keyboard", () => {
  test("every Needs-you action is a focusable control, in row order", () => {
    const snapshot = populatedSnapshot();
    renderAt("/", makeFlow({ snapshot }));
    const needs = needsYou(derive(snapshot, NOW), snapshot, NOW);
    expect(needs.count).toBeGreaterThan(2);
    const panel = document.querySelector(".needs")!;
    const rows = Array.from(panel.querySelectorAll(".row"));
    expect(rows.length).toBe(needs.count);

    const all = Array.from(document.querySelectorAll(FOCUSABLE));
    let last = -1;
    let i = 0;
    for (const g of needs.groups) {
      for (const item of g.rows) {
        const row = rows[i++]!;
        const action = item.kind === "incident" ? item.action : item.action;
        expect(action, "every Needs-you row has an action").toBeDefined();
        const el = controlFor(row, action!);
        expect(isFocusable(el)).toBe(true);
        const idx = all.indexOf(el);
        expect(idx).toBeGreaterThan(last);
        last = idx;
      }
    }
    expect(rows[0]!.querySelector(".who a")).toHaveAttribute("href", expect.stringMatching(/^\/intent\//));
  });

  test("every card's action and title are focusable controls; Done cards have no action", () => {
    const snapshot = populatedSnapshot();
    renderAt("/", makeFlow({ snapshot }));
    const rows = derive(snapshot, NOW).filter((d) => d.onBoard);
    const stages = Array.from(document.querySelectorAll(".stages .card"));
    expect(stages.length).toBe(rows.length);
    for (const d of rows) {
      const card = stages.find((c) => c.querySelector(".id")?.textContent === d.intent.id)!;
      expect(card, `card ${d.intent.id}`).toBeDefined();
      expect(card.querySelector(".title a[href]")).toHaveAttribute("href", `/intent/${d.intent.id}`);
      if (d.state === "done") {
        expect(card.querySelector(".action")).toBeNull();
      } else if (d.action) {
        const el = controlFor(card, d.action);
        expect(isFocusable(el)).toBe(true);
        if (d.action.copy) {
          expect(card.querySelector(".action a[href]"), "copyable commands come with their View link").not.toBeNull();
        }
      }
    }
  });

  test("badges have text; status never color alone", () => {
    renderAt("/", makeFlow({ snapshot: populatedSnapshot() }));
    const badges = Array.from(document.querySelectorAll(".badge"));
    expect(badges.length).toBeGreaterThan(5);
    for (const b of badges) expect(b.textContent?.trim()).not.toBe("");
    expect(screen.queryByText("CI green")).toBeNull();
    expect(screen.getAllByText("CI red").length).toBeGreaterThan(0);
  });

  test("nav aria-current, stage toggles aria-expanded, visible-focus rules in CSS", async () => {
    renderAt("/systems", makeFlow({ snapshot: populatedSnapshot() }));
    expect(screen.getByRole("link", { name: "Systems" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Board" })).not.toHaveAttribute("aria-current");

    renderAt("/", makeFlow({ snapshot: populatedSnapshot() }));
    const toggles = Array.from(document.querySelectorAll(".stage-col > header button"));
    expect(toggles.length).toBeGreaterThan(3);
    for (const t of toggles) expect(["true", "false"]).toContain(t.getAttribute("aria-expanded"));

    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/a:focus-visible, button:focus-visible \{ outline: 2px solid/);
    expect(css).toMatch(/@media \(max-width: 600px\)/);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(css).not.toMatch(/@container/);
    expect(css).not.toMatch(/\.mock-|\.frame/);
  });

  test("Copy button copies via the clipboard and labels the command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderAt("/", makeFlow({ snapshot: populatedSnapshot() }));
    const btn = screen.getAllByRole("button", { name: "Copy /plan 0002" })[0]!;
    btn.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("/plan 0002"));
  });
});
