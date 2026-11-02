// @vitest-environment jsdom
// R8 stale-while-revalidate in the hook: GET, refresh when older than the
// interval (with the X-Flow-Refresh header), re-GET; the old snapshot stays;
// floor/in-flight just re-GET; network failure → upstream; fixture mode.

import { act, render, screen } from "@testing-library/react";
import { useFlow } from "../../src/api.ts";
import { makeSnapshot } from "../helpers/build.ts";

function Probe() {
  const f = useFlow();
  return (
    <div>
      <span data-testid="status">{f.status}</span>
      <span data-testid="mode">{String(f.mode)}</span>
      <span data-testid="refreshing">{String(f.refreshing)}</span>
      <span data-testid="collected">{f.snapshot?.collectedAt ?? "-"}</span>
      <span data-testid="error">{f.lastError ? `${f.lastError.kind}:${f.lastError.message}` : "-"}</span>
      <button onClick={f.refresh}>go</button>
    </div>
  );
}

type Call = { url: string; init: RequestInit | undefined };
const calls: Call[] = [];
let queue: (() => Promise<Response>)[] = [];

const json = (body: unknown, status = 200) => () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

beforeEach(() => {
  calls.length = 0;
  queue = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    return next ? next() : Promise.reject(new Error("unexpected fetch " + url));
  });
});
afterEach(() => vi.unstubAllGlobals());

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
const minutesAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

test("fresh snapshot: one GET, ready, no refresh", async () => {
  const snap = makeSnapshot({ collectedAt: minutesAgo(1) });
  queue = [json({ mode: "live", snapshot: snap, stale: false })];
  render(<Probe />);
  await settle();
  expect(screen.getByTestId("status").textContent).toBe("ready");
  expect(screen.getByTestId("mode").textContent).toBe("live");
  expect(calls.map((c) => c.url)).toEqual(["/api/flow"]);
});

test("older than the interval: POST with the header, re-GET, old snapshot visible meanwhile", async () => {
  const old = makeSnapshot({ collectedAt: minutesAgo(12) });
  const fresh = makeSnapshot({ collectedAt: minutesAgo(0) });
  let releasePost!: () => void;
  const gate = new Promise<void>((r) => (releasePost = r));
  queue = [
    json({ mode: "live", snapshot: old, stale: true }),
    () => gate.then(() => new Response(JSON.stringify({ outcome: "refreshed", snapshot: fresh }), { status: 200 })),
    json({ mode: "live", snapshot: fresh, stale: false }),
  ];
  render(<Probe />);
  await settle();
  expect(screen.getByTestId("refreshing").textContent).toBe("true");
  expect(screen.getByTestId("collected").textContent).toBe(old.collectedAt);
  expect(calls[1]?.url).toBe("/api/refresh");
  expect(calls[1]?.init?.method).toBe("POST");
  expect((calls[1]?.init?.headers as Record<string, string>)["X-Flow-Refresh"]).toBe("1");

  await act(async () => { releasePost(); });
  await settle();
  expect(screen.getByTestId("refreshing").textContent).toBe("false");
  expect(screen.getByTestId("collected").textContent).toBe(fresh.collectedAt);
  expect(calls.map((c) => c.url)).toEqual(["/api/flow", "/api/refresh", "/api/flow"]);
});

test("floor outcome just re-GETs; manual refresh does the same", async () => {
  const snap = makeSnapshot({ collectedAt: minutesAgo(1) });
  queue = [json({ mode: "live", snapshot: snap, stale: false })];
  render(<Probe />);
  await settle();
  queue = [json({ outcome: "floor", snapshot: snap }), json({ mode: "live", snapshot: snap, stale: false })];
  await act(async () => { screen.getByRole("button", { name: "go" }).click(); });
  await settle();
  expect(calls.map((c) => c.url)).toEqual(["/api/flow", "/api/refresh", "/api/flow"]);
  expect(screen.getByTestId("error").textContent).toBe("-");
});

test("refresh failure keeps the previous snapshot and records the error", async () => {
  const snap = makeSnapshot({ collectedAt: minutesAgo(30) });
  queue = [
    json({ mode: "live", snapshot: snap, stale: true }),
    json({ outcome: "failed", snapshot: snap, error: { kind: "rate-limit", message: "403", at: new Date().toISOString() } }),
    json({ mode: "live", snapshot: snap, stale: true }),
  ];
  render(<Probe />);
  await settle();
  expect(screen.getByTestId("status").textContent).toBe("ready");
  expect(screen.getByTestId("collected").textContent).toBe(snap.collectedAt);
  expect(screen.getByTestId("error").textContent).toBe("rate-limit:403");
});

test("network failure of the GET → upstream error, error status with no snapshot", async () => {
  queue = [() => Promise.reject(new TypeError("Failed to fetch")), () => Promise.reject(new TypeError("Failed to fetch")), () => Promise.reject(new TypeError("Failed to fetch"))];
  render(<Probe />);
  await settle();
  expect(screen.getByTestId("status").textContent).toBe("error");
  expect(screen.getByTestId("error").textContent).toMatch(/^upstream:/);
});

test("fixture mode uses the function's snapshot when present, else the bundled sample", async () => {
  const snap = makeSnapshot({ collectedAt: "2026-11-10T12:00:00.000Z" });
  queue = [json({ mode: "fixture", snapshot: snap })];
  render(<Probe />);
  await settle();
  expect(screen.getByTestId("mode").textContent).toBe("fixture");
  expect(screen.getByTestId("collected").textContent).toBe(snap.collectedAt);
  expect(calls.length).toBe(1);
});

test("fixture mode with no snapshot loads src/fixtures/sample.json", async () => {
  queue = [json({ mode: "fixture" })];
  render(<Probe />);
  await settle();
  await vi.waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
  expect(screen.getByTestId("mode").textContent).toBe("fixture");
  expect(screen.getByTestId("collected").textContent).toBe("2026-11-10T12:00:00.000Z");
});
