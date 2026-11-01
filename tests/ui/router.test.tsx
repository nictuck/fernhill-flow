// @vitest-environment jsdom
// The four routes, `?stage=`, Link interception and history.

import { act, render, screen } from "@testing-library/react";
import type { FlowState } from "../../src/api.ts";

const flowRef = vi.hoisted(() => ({ current: null as FlowState | null }));
vi.mock("../../src/api.ts", () => ({
  useFlow: () => flowRef.current!,
  api: { getFlow: vi.fn(), postRefresh: vi.fn(), loadFixture: vi.fn() },
}));

import { App } from "../../src/App.tsx";
import { hrefFor, navigate, parseRoute } from "../../src/router.ts";
import { makeFlow, populatedSnapshot } from "../helpers/render.tsx";

function go(path: string) {
  window.history.replaceState(null, "", path);
}

describe("parseRoute", () => {
  test("the four routes", () => {
    expect(parseRoute("/")).toEqual({ name: "board", stage: null });
    expect(parseRoute("/systems/")).toEqual({ name: "systems" });
    expect(parseRoute("/archive")).toEqual({ name: "archive" });
    expect(parseRoute("/intent/0001")).toEqual({ name: "intent", id: "0001" });
    expect(parseRoute("/nope")).toEqual({ name: "not-found", path: "/nope" });
  });

  test("?stage= opens a stage; unknown stages are ignored", () => {
    expect(parseRoute("/", "?stage=design")).toEqual({ name: "board", stage: "design" });
    expect(parseRoute("/", "?stage=bogus")).toEqual({ name: "board", stage: null });
    expect(hrefFor({ name: "board", stage: "design" })).toBe("/?stage=design");
    expect(hrefFor({ name: "intent", id: "0001" })).toBe("/intent/0001");
  });
});

describe("App routing", () => {
  beforeEach(() => {
    flowRef.current = makeFlow({ snapshot: populatedSnapshot() });
  });

  test("renders each route and marks the nav", async () => {
    go("/");
    render(<App />);
    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
    expect(document.querySelector(".stages")).not.toBeNull();

    await act(async () => navigate("/systems"));
    expect(screen.getByRole("link", { name: "Systems" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("table")).toBeInTheDocument();

    await act(async () => navigate("/archive"));
    expect(screen.getByRole("link", { name: "Archive" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Final status")).toBeInTheDocument();

    await act(async () => navigate("/intent/0001"));
    expect(screen.getByRole("heading", { level: 1, name: "Flow dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");

    await act(async () => navigate("/nowhere"));
    expect(screen.getByText(/There is no page at/)).toBeInTheDocument();
  });

  test("Link clicks use pushState; popstate goes back", async () => {
    go("/");
    render(<App />);
    const before = window.history.length;
    await act(async () => {
      screen.getByRole("link", { name: "Systems" }).click();
    });
    expect(window.location.pathname).toBe("/systems");
    expect(window.history.length).toBe(before + 1);
    expect(screen.getByRole("table")).toBeInTheDocument();

    await act(async () => {
      window.history.back();
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await vi.waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  });

  test("?stage=design opens the Design detail; the toggle writes the URL back", async () => {
    go("/?stage=design");
    render(<App />);
    const open = document.querySelector(".stage-col.is-open")!;
    expect(open.querySelector("h2")?.textContent).toBe("2 Design");
    expect(open.querySelector("button")).toHaveAttribute("aria-expanded", "true");

    await act(async () => {
      (open.querySelector("button") as HTMLButtonElement).click();
    });
    expect(window.location.search).toBe("");
    expect(document.querySelector(".stage-col.is-open")).toBeNull();

    const build = Array.from(document.querySelectorAll(".stage-col")).find((s) => s.querySelector("h2")?.textContent === "3 Build")!;
    await act(async () => {
      (build.querySelector("button") as HTMLButtonElement).click();
    });
    expect(window.location.search).toBe("?stage=build");
    expect(build.classList.contains("is-open")).toBe(true);
  });

  test("the card title links to /intent/:id through the router", async () => {
    go("/");
    render(<App />);
    await act(async () => {
      screen.getByRole("link", { name: "Flow dashboard" }).click();
    });
    expect(window.location.pathname).toBe("/intent/0001");
    expect(screen.getByRole("heading", { level: 1, name: "Flow dashboard" })).toBeInTheDocument();
  });
});
