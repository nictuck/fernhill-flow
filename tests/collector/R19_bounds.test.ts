// R19: every outbound call is bounded — 5 s timeout, 1 MiB body cap, call
// cap, overall deadline — and GitHub errors are classified.

import { BUDGET_MESSAGE, CollectError, GithubClient, readBounded } from "../../src/collector/github.ts";
import { FakeGithub } from "../helpers/fakeGithub.ts";

const PATH = "/repos/nictuck/fernhill-platform";

async function failure(p: Promise<unknown>): Promise<CollectError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof CollectError) return err;
    throw err;
  }
  throw new Error("expected the call to fail");
}

describe("R19 bounds", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a hanging upstream fails with `upstream` at 5 s, not before", async () => {
    vi.useFakeTimers();
    const fake = new FakeGithub().route(PATH, { hang: true });
    const client = new GithubClient({ token: "t", fetch: fake.fetch });
    let settled = false;
    const p = client.get(PATH).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const outcome = failure(client.get(PATH));
    await vi.advanceTimersByTimeAsync(4_990);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    await p;
    expect(settled).toBe(true);
    const err = await outcome;
    expect(err.kind).toBe("upstream");
    expect(err.message).toBe("timeout after 5000 ms");
  });

  test("an oversized body is rejected with `bounds` before parsing", async () => {
    const fake = new FakeGithub().route(PATH, { bytes: 2_048 });
    const client = new GithubClient({ token: "t", fetch: fake.fetch, maxBytes: 1_024 });
    const err = await failure(client.get(PATH));
    expect(err.kind).toBe("bounds");
  });

  test("readBounded stops at the cap even when content-length is absent", async () => {
    const res = new Response("x".repeat(1_500));
    await expect(readBounded(res, 1_024)).rejects.toMatchObject({ kind: "bounds" });
    const ok = await readBounded(new Response("y".repeat(1_024)), 1_024);
    expect(ok.length).toBe(1_024);
  });

  test("a declared content-length over the cap is refused without reading", async () => {
    const res = new Response("short", { headers: { "content-length": "9999999" } });
    await expect(readBounded(res, 1_024)).rejects.toMatchObject({ kind: "bounds" });
  });

  test("the call cap throws `cap` and makes no further request", async () => {
    const fake = new FakeGithub().json(PATH, { ok: true });
    const client = new GithubClient({ token: "t", fetch: fake.fetch, callCap: 3 });
    await client.get(PATH);
    await client.get(PATH);
    await client.get(PATH);
    const err = await failure(client.get(PATH));
    expect(err.kind).toBe("cap");
    expect(fake.calls.length).toBe(3);
    expect(client.stats().calls).toBe(3);
  });

  test("401 → token", async () => {
    const fake = new FakeGithub().json(PATH, { message: "Bad credentials" }, { status: 401 });
    const client = new GithubClient({ token: "t", fetch: fake.fetch });
    const err = await failure(client.get(PATH));
    expect(err.kind).toBe("token");
    expect(err.status).toBe(401);
  });

  test("403 with x-ratelimit-remaining: 0 → rate-limit with resetAt", async () => {
    const reset = 1_800_000_000;
    const fake = new FakeGithub().json(
      PATH,
      { message: "API rate limit exceeded" },
      { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } },
    );
    const client = new GithubClient({ token: "t", fetch: fake.fetch });
    const err = await failure(client.get(PATH));
    expect(err.kind).toBe("rate-limit");
    expect(err.resetAt).toBe(new Date(reset * 1000).toISOString());
    expect(client.stats().remaining).toBe(0);
  });

  test("403 without an exhausted limit, 404 and 5xx are classified", async () => {
    const fake = new FakeGithub()
      .json("/a", { message: "forbidden" }, { status: 403, headers: { "x-ratelimit-remaining": "42" } })
      .json("/b", { message: "nope" }, { status: 404 })
      .json("/c", { message: "down" }, { status: 502 })
      .text("/d", "<html>not json</html>");
    const client = new GithubClient({ token: "t", fetch: fake.fetch });
    expect((await failure(client.get("/a"))).kind).toBe("upstream");
    expect((await failure(client.get("/b"))).kind).toBe("not-found");
    expect((await failure(client.get("/c"))).kind).toBe("upstream");
    expect((await failure(client.get("/d"))).kind).toBe("upstream");
  });

  test("the overall deadline aborts a running call and refuses later ones", async () => {
    const fake = new FakeGithub().json("/slow", { ok: true }, { delayMs: 200 }).json("/fast", { ok: true });
    const client = new GithubClient({ token: "t", fetch: fake.fetch, deadline: Date.now() + 50 });
    const err = await failure(client.get("/slow"));
    expect(err.kind).toBe("upstream");
    expect(err.message).toBe(BUDGET_MESSAGE);
    const later = await failure(client.get("/fast"));
    expect(later.message).toBe(BUDGET_MESSAGE);
    expect(fake.count((k) => k === "/fast")).toBe(0);
  });

  test("the ETag cache keeps bodies up to 64 KiB only, and reports whether it changed", async () => {
    const fake = new FakeGithub().route("/big", { bytes: 70 * 1024, etag: '"big"' }).json("/small", { ok: true }, { etag: '"s"' });
    const cache = {};
    const c1 = new GithubClient({ token: "t", fetch: fake.fetch, etagCache: cache });
    await c1.get("/big", { raw: true });
    expect(c1.cacheChanged()).toBe(false);
    expect(Object.keys(cache)).toEqual([]);
    await c1.get("/small");
    expect(c1.cacheChanged()).toBe(true);
    expect(Object.keys(cache)).toEqual(["/small"]);

    const c2 = new GithubClient({ token: "t", fetch: fake.fetch, etagCache: cache });
    await c2.get("/small");
    await c2.get("/big", { raw: true });
    expect(c2.stats().cached).toBe(1);
    expect(c2.cacheChanged()).toBe(false);
    expect(fake.calls.filter((c) => c.key === "/big").every((c) => c.ifNoneMatch === null)).toBe(true);
  });

  test("conditional requests: 304 serves the cached body and counts as cached", async () => {
    const fake = new FakeGithub().json(PATH, { name: "fernhill-platform" }, { etag: '"abc"' });
    const cache = {};
    const first = new GithubClient({ token: "t", fetch: fake.fetch, etagCache: cache });
    expect(await first.get(PATH)).toEqual({ name: "fernhill-platform" });
    expect(first.stats().cached).toBe(0);

    const second = new GithubClient({ token: "t", fetch: fake.fetch, etagCache: cache });
    expect(await second.get(PATH)).toEqual({ name: "fernhill-platform" });
    const stats = second.stats();
    expect(stats.calls).toBe(1);
    expect(stats.cached).toBe(1);
    expect(stats.log[0]).toMatchObject({ path: PATH, status: 304, fromCache: true });
    expect(fake.calls[1]?.ifNoneMatch).toBe('"abc"');
  });

  test("the call log holds paths only, never headers or the token", async () => {
    const fake = new FakeGithub().json(PATH, { ok: true });
    const client = new GithubClient({ token: "super-secret-token", fetch: fake.fetch });
    await client.get(PATH);
    const text = JSON.stringify(client.stats());
    expect(text).not.toContain("super-secret-token");
    expect(text).not.toContain("Authorization");
    expect(Object.keys(client.stats().log[0] ?? {})).toEqual(["path", "status", "ms", "fromCache"]);
  });

  test("the client sends the documented headers", async () => {
    let seen: Headers | undefined;
    const spy: typeof fetch = async (_input, init) => {
      seen = new Headers(init?.headers);
      return new Response("{}", { status: 200 });
    };
    const client = new GithubClient({ token: "tok", fetch: spy });
    await client.get(PATH);
    expect(seen?.get("authorization")).toBe("Bearer tok");
    expect(seen?.get("accept")).toBe("application/vnd.github+json");
    expect(seen?.get("x-github-api-version")).toBe("2022-11-28");
    expect(seen?.get("user-agent")).toBe("fernhill-flow");
  });
});
