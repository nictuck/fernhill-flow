// R8: GET /api/flow reports `stale` around refresh.interval_minutes, treats a
// schemaVersion mismatch as "no snapshot", serves the sample through the
// store when there is no token, and never lets the browser cache it.

import { makeFlowHandler } from "../../netlify/functions/flow.ts";
import type { FlowDeps } from "../../netlify/functions/flow.ts";
import { KEYS } from "../../netlify/lib/store.ts";
import { SCHEMA_VERSION } from "../../src/engine/types.ts";
import type { Snapshot } from "../../src/engine/types.ts";
import { NOW, makeConfig, makeSnapshot } from "../helpers/build.ts";
import { FakeGithub, PLATFORM, repoBase } from "../helpers/fakeGithub.ts";
import { MemoryStore } from "../helpers/memoryStore.ts";

const ctx = { deploy: { context: "branch-deploy" } };

function minutesAgo(minutes: number, from = NOW): string {
  return new Date(Date.parse(from) - minutes * 60_000).toISOString();
}

interface FlowBody {
  mode: "live" | "fixture";
  snapshot: Snapshot | null;
  stale?: boolean;
  lastError?: { kind: string; message: string };
}

function handler(over: Partial<FlowDeps> = {}) {
  const fake = new FakeGithub().json(repoBase(PLATFORM), { name: PLATFORM });
  const store = new MemoryStore();
  const prefixes: string[] = [];
  const h = makeFlowHandler({
    makeStore: (prefix) => {
      prefixes.push(prefix);
      return store;
    },
    fetch: fake.fetch,
    token: "t",
    now: () => NOW,
    log: () => undefined,
    env: {},
    ...over,
  });
  const get = async (): Promise<{ res: Response; body: FlowBody }> => {
    const res = await h(new Request("https://x.test/api/flow"), ctx);
    return { res, body: (await res.json()) as FlowBody };
  };
  return { h, get, store, fake, prefixes };
}

describe("R8 GET /api/flow", () => {
  test("stale is false inside the interval and true past it", async () => {
    const fresh = handler();
    fresh.store.seed(KEYS.latest, makeSnapshot({ collectedAt: minutesAgo(5) }));
    const a = await fresh.get();
    expect(a.res.status).toBe(200);
    expect(a.body).toMatchObject({ mode: "live", stale: false });
    expect(a.body.snapshot?.collectedAt).toBe(minutesAgo(5));
    expect(fresh.fake.calls.length).toBe(0);

    const old = handler();
    old.store.seed(KEYS.latest, makeSnapshot({ collectedAt: minutesAgo(11) }));
    const b = await old.get();
    expect(b.body.stale).toBe(true);
    expect(b.body.snapshot?.collectedAt).toBe(minutesAgo(11));
    expect(old.fake.calls.length).toBe(0);
  });

  test("the interval comes from the snapshot's config", async () => {
    const h = handler();
    h.store.seed(KEYS.latest, makeSnapshot({ collectedAt: minutesAgo(25), config: makeConfig({ refresh: { interval_minutes: 30, floor_seconds: 60 } }) }));
    expect((await h.get()).body.stale).toBe(false);
  });

  test("a schemaVersion mismatch runs the initial refresh (real collector, failing fast)", async () => {
    const h = handler({ platformRepo: "nictuck/fernhill-platform" });
    h.store.seed(KEYS.latest, makeSnapshot({ schemaVersion: SCHEMA_VERSION + 1, collectedAt: minutesAgo(1) }));
    // The collector's first call 404s, so the refresh path runs without a full canned platform.
    h.fake.json(`${repoBase(PLATFORM)}/git/trees/main?recursive=1`, { message: "Not Found" }, { status: 404 });
    const { body } = await h.get();
    expect(h.fake.count((k) => k.includes("/git/trees/main"))).toBe(1);
    expect(body.mode).toBe("live");
    expect(body.snapshot).toBeNull();
    expect(body.lastError).toMatchObject({ kind: "not-found" });
    expect(body.stale).toBe(false);
    expect(h.store.data.has(KEYS.lock)).toBe(false);
  });

  test("a valid stored snapshot is served without any GitHub call", async () => {
    const h = handler();
    h.store.seed(KEYS.latest, makeSnapshot({ collectedAt: NOW }));
    const { body } = await h.get();
    expect(body.snapshot?.collectedAt).toBe(NOW);
    expect(body.stale).toBe(false);
    expect(h.fake.calls.length).toBe(0);
  });

  test("a stored last-error is surfaced alongside the snapshot", async () => {
    const h = handler();
    h.store.seed(KEYS.latest, makeSnapshot({ collectedAt: minutesAgo(2) }));
    h.store.seed(KEYS.lastError, { kind: "rate-limit", message: "GitHub rate limit reached", at: NOW });
    const { body } = await h.get();
    expect(body.lastError).toMatchObject({ kind: "rate-limit" });
    expect(body.snapshot).not.toBeNull();
  });

  test("no token → { mode: 'fixture', snapshot } read back from the store under the deploy prefix", async () => {
    const h = handler({ token: undefined });
    const { res, body } = await h.get();
    expect(res.status).toBe(200);
    expect(body.mode).toBe("fixture");
    expect(body.snapshot?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(body.snapshot?.collectedAt).toBe(NOW);
    expect(h.prefixes).toEqual(["branch-deploy"]);
    expect(h.store.data.has(KEYS.latest)).toBe(true);
    expect(h.fake.calls.length).toBe(0);

    // Second request: served from the store, no second "collection".
    const before = h.store.ops.filter((o) => o.startsWith("set")).length;
    const again = await h.get();
    expect(again.body.snapshot?.collectedAt).toBe(NOW);
    expect(h.store.ops.filter((o) => o.startsWith("set")).length).toBe(before);
  });

  test("Cache-Control: no-store on every response; non-GET is 405; no context is 500", async () => {
    const h = handler();
    h.store.seed(KEYS.latest, makeSnapshot());
    const ok = await h.h(new Request("https://x.test/api/flow"), ctx);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const post = await h.h(new Request("https://x.test/api/flow", { method: "POST" }), ctx);
    expect(post.status).toBe(405);
    expect(post.headers.get("cache-control")).toBe("no-store");
    const noCtx = await h.h(new Request("https://x.test/api/flow"), undefined);
    expect(noCtx.status).toBe(500);
    expect(await noCtx.json()).toEqual({ error: "no deploy context" });
  });

  test("CONTEXT from the environment is the fallback prefix", async () => {
    const h = handler({ env: { CONTEXT: "production" } });
    h.store.seed(KEYS.latest, makeSnapshot());
    const res = await h.h(new Request("https://x.test/api/flow"), undefined);
    expect(res.status).toBe(200);
    expect(h.prefixes).toEqual(["production"]);
  });
});
