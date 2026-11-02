// Bounded, read-only GitHub REST client (R10, R15, R19).
//
// Every call: 5 s timeout, 1 MiB body cap, conditional request from an ETag
// cache, counted against a hard cap, and cut off at an overall deadline so a
// refresh stays inside the function's time budget. Errors are classified so
// the refresh can tell "token expired" from "GitHub is down". The call log
// holds paths only — never headers, never request objects (R10).

export type ErrorKind = "token" | "rate-limit" | "not-found" | "upstream" | "bounds" | "cap";

export class CollectError extends Error {
  readonly kind: ErrorKind;
  readonly status?: number;
  readonly resetAt?: string;

  constructor(kind: ErrorKind, message: string, extra: { status?: number; resetAt?: string } = {}) {
    super(message);
    this.name = "CollectError";
    this.kind = kind;
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.resetAt !== undefined) this.resetAt = extra.resetAt;
  }
}

export const BUDGET_MESSAGE = "time budget exceeded";

/** Fatal kinds end the whole refresh; anything else is one bad source. */
export function isFatalKind(kind: ErrorKind): boolean {
  return kind === "token" || kind === "rate-limit" || kind === "cap";
}

/** The overall time budget is fatal too: a partial snapshot would lie. */
export function isFatalError(err: unknown): boolean {
  if (!(err instanceof CollectError)) return true;
  return isFatalKind(err.kind) || err.message === BUDGET_MESSAGE;
}

export interface EtagEntry {
  etag: string;
  body: string;
}
/** Plain object so it round-trips through Blobs as JSON. */
export type EtagCache = Record<string, EtagEntry>;

export interface CallLogEntry {
  path: string;
  status: number;
  ms: number;
  fromCache: boolean;
}

export interface GithubClientOptions {
  token: string;
  fetch: typeof fetch;
  etagCache?: EtagCache;
  /** ms clock for durations and the deadline; tests inject a fake */
  now?: () => number;
  callCap?: number;
  timeoutMs?: number;
  maxBytes?: number;
  /** bodies larger than this are read but not kept in the ETag cache (default 64 KiB) */
  cacheMaxBytes?: number;
  /** absolute ms (same clock as `now`): calls started after it, or still running at it, fail */
  deadline?: number;
  log?: (entry: CallLogEntry) => void;
  baseUrl?: string;
}

export interface GithubStats {
  calls: number;
  cached: number;
  remaining?: number;
  log: CallLogEntry[];
}

export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 1024 * 1024;
export const DEFAULT_CACHE_MAX_BYTES = 64 * 1024;
export const DEFAULT_CALL_CAP = 200;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Read a body with a byte cap. Rejects with `bounds` before buffering more
 * than `maxBytes`, so a hostile or broken upstream cannot fill memory.
 */
export async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new CollectError("bounds", `response of ${declared} bytes exceeds the ${maxBytes}-byte cap`);
  }
  const body = res.body;
  if (!body) {
    const text = await res.text();
    if (byteLength(text) > maxBytes) throw new CollectError("bounds", `response exceeds the ${maxBytes}-byte cap`);
    return text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new CollectError("bounds", `response exceeds the ${maxBytes}-byte cap`);
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

export interface TimeoutOptions {
  timeoutMs: number;
  /** absolute ms deadline on `now`'s clock */
  deadline?: number;
  now?: () => number;
}

/**
 * fetch with a hard per-call timeout and an optional overall deadline. Used
 * by the client and by the public `version.txt` reads (no token, no cache).
 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  opts: TimeoutOptions,
  read: (res: Response) => Promise<string>,
): Promise<{ res: Response; text: string }> {
  const now = opts.now ?? Date.now;
  let budgetMs = opts.timeoutMs;
  let deadlineBound = false;
  if (opts.deadline !== undefined) {
    const left = opts.deadline - now();
    if (left <= 0) throw new CollectError("upstream", BUDGET_MESSAGE);
    if (left < budgetMs) {
      budgetMs = left;
      deadlineBound = true;
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await read(res);
    return { res, text };
  } catch (err) {
    if (err instanceof CollectError) throw err;
    if (isAbort(err)) {
      throw new CollectError("upstream", deadlineBound ? BUDGET_MESSAGE : `timeout after ${opts.timeoutMs} ms`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new CollectError("upstream", `fetch failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

function classifyStatus(res: Response, path: string): CollectError {
  const status = res.status;
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (status === 401) return new CollectError("token", "GitHub rejected the token", { status });
  if ((status === 403 || status === 429) && remaining === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const extra: { status: number; resetAt?: string } = { status };
    if (Number.isFinite(reset) && reset > 0) extra.resetAt = new Date(reset * 1000).toISOString();
    return new CollectError("rate-limit", "GitHub rate limit reached", extra);
  }
  if (status === 404) return new CollectError("not-found", `not found: ${path}`, { status });
  return new CollectError("upstream", `GitHub ${status} on ${path}`, { status });
}

export class GithubClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: EtagCache;
  private readonly now: () => number;
  private readonly callCap: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly cacheMaxBytes: number;
  private readonly deadline: number | undefined;
  private dirty = false;
  private readonly onLog: ((entry: CallLogEntry) => void) | undefined;
  private readonly baseUrl: string;
  private calls = 0;
  private cached = 0;
  private remaining: number | undefined;
  private readonly log: CallLogEntry[] = [];
  private readonly touched = new Set<string>();

  constructor(opts: GithubClientOptions) {
    this.token = opts.token;
    this.fetchImpl = opts.fetch;
    this.cache = opts.etagCache ?? {};
    this.now = opts.now ?? Date.now;
    this.callCap = opts.callCap ?? DEFAULT_CALL_CAP;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.cacheMaxBytes = opts.cacheMaxBytes ?? DEFAULT_CACHE_MAX_BYTES;
    this.deadline = opts.deadline;
    this.onLog = opts.log;
    this.baseUrl = opts.baseUrl ?? "https://api.github.com";
  }

  get(path: string, opts: { raw: true }): Promise<string>;
  get(path: string, opts?: { raw?: false }): Promise<unknown>;
  async get(path: string, opts: { raw?: boolean } = {}): Promise<unknown> {
    if (this.calls >= this.callCap) {
      throw new CollectError("cap", `call cap of ${this.callCap} reached before ${path}`);
    }
    if (this.deadline !== undefined && this.now() >= this.deadline) {
      throw new CollectError("upstream", BUDGET_MESSAGE);
    }
    this.calls += 1;
    const started = this.now();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "fernhill-flow",
    };
    const cachedEntry = this.cache[path];
    if (cachedEntry) headers["If-None-Match"] = cachedEntry.etag;

    const timeout: TimeoutOptions = { timeoutMs: this.timeoutMs, now: this.now };
    if (this.deadline !== undefined) timeout.deadline = this.deadline;

    const { res, text } = await fetchWithTimeout(
      this.fetchImpl,
      `${this.baseUrl}${path}`,
      { method: "GET", headers },
      timeout,
      (r) => (r.status === 304 ? Promise.resolve("") : readBounded(r, this.maxBytes)),
    );

    const rem = Number(res.headers.get("x-ratelimit-remaining"));
    if (res.headers.has("x-ratelimit-remaining") && Number.isFinite(rem)) this.remaining = rem;

    const fromCache = res.status === 304 && cachedEntry !== undefined;
    this.record({ path, status: res.status, ms: this.now() - started, fromCache });

    let body: string;
    if (fromCache) {
      this.cached += 1;
      this.touched.add(path);
      body = cachedEntry.body;
    } else if (res.ok) {
      body = text;
      const etag = res.headers.get("etag");
      if (etag && byteLength(body) <= this.cacheMaxBytes) {
        this.cache[path] = { etag, body };
        this.touched.add(path);
        this.dirty = true;
      } else if (this.cache[path]) {
        // Too large to keep (or no ETag any more): drop the stale entry rather than serve it on a 304.
        delete this.cache[path];
        this.dirty = true;
      }
    } else {
      throw classifyStatus(res, path);
    }

    if (opts.raw) return body;
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new CollectError("upstream", `GitHub returned non-JSON for ${path}`, { status: res.status });
    }
  }

  private record(entry: CallLogEntry): void {
    this.log.push(entry);
    this.onLog?.(entry);
  }

  stats(): GithubStats {
    const out: GithubStats = { calls: this.calls, cached: this.cached, log: [...this.log] };
    if (this.remaining !== undefined) out.remaining = this.remaining;
    return out;
  }

  /** The cache as it stands; `pruneCache` drops entries this client never used. */
  etagCache(): EtagCache {
    return this.cache;
  }

  /** Remove entries not touched by this client (keeps the stored cache bounded). */
  pruneCache(): void {
    for (const key of Object.keys(this.cache)) {
      if (!this.touched.has(key)) {
        delete this.cache[key];
        this.dirty = true;
      }
    }
  }

  /** True when this client added, replaced or removed a cache entry (a 304 changes nothing). */
  cacheChanged(): boolean {
    return this.dirty;
  }
}
