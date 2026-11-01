// R17: the floor makes zero GitHub calls, concurrent refreshes coalesce
// through the Blobs lock (including the expired-lock takeover race), the
// route is header-gated, and the log line carries the budget numbers.

import { runRefresh } from "../../netlify/lib/refresh-core.ts";
import type { CollectContext, RefreshDeps } from "../../netlify/lib/refresh-core.ts";
import { KEYS } from "../../netlify/lib/store.ts";
import { makeRefreshHandler } from "../../netlify/functions/refresh.ts";
import { CollectError } from "../../src/collector/github.ts";
import { SCHEMA_VERSION } from "../../src/engine/types.ts";
import { NOW, daysAgo, makeSnapshot } from "../helpers/build.ts";
import { FakeGithub, PLATFORM, repoBase } from "../helpers/fakeGithub.ts";
import { MemoryStore } from "../helpers/memoryStore.ts";

const PLATFORM_PATH = repoBase(PLATFORM);

/** A collector stub that makes one GitHub call so `fake.calls` proves a collection happened. */
function harness(now = NOW) {
  const fake = new FakeGithub().json(PLATFORM_PATH, { name: PLATFORM });
  const store = new MemoryStore();
  const lines: string[] = [];
  let collections = 0;
  const collectFn = async (ctx: CollectContext) => {
    collections += 1;
    await ctx.client.get(PLATFORM_PATH);
    return makeSnapshot({ collectedAt: ctx.now() });
  };
  const deps = (over: Partial<RefreshDeps> = {}): RefreshDeps => ({
    store,
    fetch: fake.fetch,
    token: "t",
    now: () => now,
    trigger: "manual",
    collectFn,
    log: (l) => lines.push(l),
    ...over,
  });
  return { fake, store, lines, deps, collections: () => collections };
}

function secondsLater(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

describe("R17 floor", () => {
  test("a second refresh within floor_seconds returns the snapshot with zero GitHub calls", async () => {
    const h = harness();
    const first = await runRefresh(h.deps());
    expect(first.outcome).toBe("refreshed");
    expect(h.fake.calls.length).toBe(1);

    const second = await runRefresh(h.deps({ now: () => secondsLater(NOW, 30) }));
    expect(second.outcome).toBe("floor");
    expect(second.snapshot?.collectedAt).toBe(NOW);
    expect(h.fake.calls.length).toBe(1);
    expect(h.collections()).toBe(1);
    expect(h.store.ops.filter((o) => o.startsWith("set"))).toHaveLength(3); // latest, etags, (no previous on first run)

    const third = await runRefresh(h.deps({ now: () => secondsLater(NOW, 61) }));
    expect(third.outcome).toBe("refreshed");
    expect(h.collections()).toBe(2);
    expect(await h.store.getJSON(KEYS.previous)).toMatchObject({ collectedAt: NOW });
  });
});

describe("R17 single flight", () => {
  test("two concurrent refreshes produce one collection; the other reports in-flight", async () => {
    const h = harness();
    h.store.latencyMs = 2;
    const [a, b] = await Promise.all([runRefresh(h.deps()), runRefresh(h.deps())]);
    expect([a.outcome, b.outcome].sort()).toEqual(["in-flight", "refreshed"]);
    expect(h.collections()).toBe(1);
    expect(h.fake.calls.length).toBe(1);
    expect(h.store.data.has(KEYS.lock)).toBe(false);
  });

  test("an expired lock is taken over", async () => {
    const h = harness();
    h.store.seed(KEYS.lock, { at: secondsLater(NOW, -120), ttlMs: 90_000 });
    const r = await runRefresh(h.deps());
    expect(r.outcome).toBe("refreshed");
    expect(h.collections()).toBe(1);
    expect(h.store.data.has(KEYS.lock)).toBe(false);
    expect(h.store.ops).toContain("set lock (onlyIfNew: lost)");
    expect(h.store.ops).toContain("set lock");
  });

  test("a live lock is respected", async () => {
    const h = harness();
    h.store.seed(KEYS.lock, { at: secondsLater(NOW, -10), ttlMs: 90_000 });
    const r = await runRefresh(h.deps());
    expect(r.outcome).toBe("in-flight");
    expect(h.collections()).toBe(0);
    expect(h.store.data.has(KEYS.lock)).toBe(true);
  });

  test("double takeover of an expired lock: exactly one wins", async () => {
    const h = harness();
    h.store.seed(KEYS.lock, { at: secondsLater(NOW, -120), ttlMs: 90_000 });
    h.store.latencyMs = 2;
    const [a, b] = await Promise.all([runRefresh(h.deps()), runRefresh(h.deps())]);
    expect([a.outcome, b.outcome].sort()).toEqual(["in-flight", "refreshed"]);
    expect(h.collections()).toBe(1);
    expect(h.store.ops.filter((o) => o === "set lock (onlyIfMatch: lost)")).toHaveLength(1);
  });
});

describe("R17 failure keeps the previous snapshot", () => {
  test("a collector error → failed, last-error stored, latest untouched, lock released", async () => {
    const h = harness();
    await runRefresh(h.deps());
    const r = await runRefresh(
      h.deps({
        now: () => secondsLater(NOW, 120),
        collectFn: async () => {
          throw new CollectError("token", "GitHub rejected the token", { status: 401 });
        },
      }),
    );
    expect(r.outcome).toBe("failed");
    expect(r.error).toMatchObject({ kind: "token", status: 401, at: secondsLater(NOW, 120) });
    expect(r.snapshot?.collectedAt).toBe(NOW);
    expect(await h.store.getJSON(KEYS.lastError)).toMatchObject({ kind: "token" });
    expect(await h.store.getJSON(KEYS.latest)).toMatchObject({ collectedAt: NOW });
    expect(h.store.data.has(KEYS.lock)).toBe(false);

    const ok = await runRefresh(h.deps({ now: () => secondsLater(NOW, 240) }));
    expect(ok.outcome).toBe("refreshed");
    expect(await h.store.getJSON(KEYS.lastError)).toBeNull();
  });

  test("the time budget fails the refresh and keeps the previous snapshot", async () => {
    const h = harness();
    await runRefresh(h.deps());
    h.fake.route("/slow", { json: { ok: true }, delayMs: 300 });
    const r = await runRefresh(
      h.deps({
        now: () => secondsLater(NOW, 120),
        budgetMs: 40,
        collectFn: async (ctx) => {
          await ctx.client.get("/slow");
          return makeSnapshot();
        },
      }),
    );
    expect(r.outcome).toBe("failed");
    expect(r.error).toMatchObject({ kind: "upstream", message: "time budget exceeded" });
    expect(r.snapshot?.collectedAt).toBe(NOW);
  });

  test("a malformed PLATFORM_REPO refuses to refresh with kind config and takes no lock", async () => {
    const h = harness();
    const r = await runRefresh(h.deps({ platformRepo: "https://evil.example/x" }));
    expect(r.outcome).toBe("failed");
    expect(r.error).toMatchObject({ kind: "config" });
    expect(r.error?.message).toMatch(/PLATFORM_REPO/);
    expect(h.collections()).toBe(0);
    expect(h.store.ops.some((o) => o.startsWith("set"))).toBe(false);

    const ok = await runRefresh(h.deps({ platformRepo: "nictuck/fernhill-platform" }));
    expect(ok.outcome).toBe("refreshed");
  });

  test("a stored snapshot with another schemaVersion is treated as absent", async () => {
    const h = harness();
    h.store.seed(KEYS.latest, makeSnapshot({ schemaVersion: SCHEMA_VERSION + 1, collectedAt: NOW }));
    const r = await runRefresh(h.deps());
    expect(r.outcome).toBe("refreshed");
    expect(h.collections()).toBe(1);
    expect(await h.store.getJSON(KEYS.previous)).toBeNull();
  });
});

describe("R17 log line", () => {
  test("exactly one JSON line per run with trigger, ip, outcome, calls, cached and ratio; no headers", async () => {
    const h = harness();
    await runRefresh(h.deps({ ip: "203.0.113.9" }));
    await runRefresh(h.deps({ now: () => secondsLater(NOW, 10) }));
    await runRefresh(h.deps({ trigger: "stale", now: () => secondsLater(NOW, 120) }));
    expect(h.lines).toHaveLength(3);
    // Spec vocabulary (R17): trigger page | manual; outcome stored | kept-previous (+ reason).
    const first = JSON.parse(h.lines[0] ?? "{}") as Record<string, unknown>;
    expect(first).toMatchObject({ trigger: "manual", ip: "203.0.113.9", outcome: "stored", calls: 1, cached: 0, cachedRatio: 0, snapshotAt: NOW });
    expect(first["durationMs"]).toBeTypeOf("number");
    expect(first).not.toHaveProperty("reason");
    expect(JSON.parse(h.lines[1] ?? "{}")).toMatchObject({ outcome: "kept-previous", reason: "floor", calls: 0, cached: 0 });
    expect(JSON.parse(h.lines[2] ?? "{}")).toMatchObject({ trigger: "page", outcome: "stored" });
    for (const line of h.lines) {
      expect(line).not.toMatch(/authorization|bearer|if-none-match/i);
    }
  });
});

describe("R17 POST /api/refresh handler", () => {
  const ctx = { deploy: { context: "deploy-preview" }, ip: "198.51.100.7" };

  function handler(token: string | undefined, store = new MemoryStore(), prefixes: string[] = []) {
    const fake = new FakeGithub().json(PLATFORM_PATH, { name: PLATFORM });
    const lines: string[] = [];
    const h = makeRefreshHandler({
      makeStore: (prefix) => {
        prefixes.push(prefix);
        return store;
      },
      fetch: fake.fetch,
      token,
      now: () => NOW,
      log: (l) => lines.push(l),
      env: {},
    });
    return { h, store, lines, prefixes };
  }

  test("a POST without X-Flow-Refresh: 1 is rejected with 400", async () => {
    const { h } = handler("t");
    const res = await h(new Request("https://x.test/api/refresh", { method: "POST" }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing X-Flow-Refresh header" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("a GET is 405", async () => {
    const { h } = handler("t");
    const res = await h(new Request("https://x.test/api/refresh", { method: "GET", headers: { "X-Flow-Refresh": "1" } }), ctx);
    expect(res.status).toBe(405);
  });

  test("no deploy context → 500 and no key touched", async () => {
    const { h, store, prefixes } = handler("t");
    const res = await h(new Request("https://x.test/api/refresh", { method: "POST", headers: { "X-Flow-Refresh": "1" } }), undefined);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "no deploy context" });
    expect(prefixes).toEqual([]);
    expect(store.ops).toEqual([]);
  });

  test("no token → the sample snapshot goes through the store and is read back", async () => {
    const { h, store, prefixes, lines } = handler(undefined);
    const res = await h(new Request("https://x.test/api/refresh", { method: "POST", headers: { "X-Flow-Refresh": "1" } }), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; outcome: string; snapshot: { schemaVersion: number; collectedAt: string } | null };
    expect(body.mode).toBe("fixture");
    expect(body.outcome).toBe("refreshed");
    expect(body.snapshot?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(body.snapshot?.collectedAt).toBe(NOW);
    expect(prefixes).toEqual(["deploy-preview"]);
    expect(store.data.has(KEYS.latest)).toBe(true);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ trigger: "manual", ip: "198.51.100.7", outcome: "stored", calls: 0 });
    // The page's background revalidation announces itself; the log says `page`.
    const again = await h(
      new Request("https://x.test/api/refresh", { method: "POST", headers: { "X-Flow-Refresh": "1", "X-Flow-Trigger": "page" } }),
      ctx,
    );
    expect(again.status).toBe(200);
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ trigger: "page", outcome: "kept-previous", reason: "floor" });
  });

  test("with a token the result is the RefreshResult; the floor applies", async () => {
    const store = new MemoryStore();
    store.seed(KEYS.latest, makeSnapshot({ collectedAt: daysAgo(0.0001) }));
    const { h } = handler("t", store);
    const res = await h(new Request("https://x.test/api/refresh", { method: "POST", headers: { "x-flow-refresh": "1" } }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "live", outcome: "floor" });
  });
});
