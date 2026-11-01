// One refresh (R15, R17): floor, single-flight lock, collect under a time
// budget, store, one log line. `flow` imports this directly for
// stale-while-revalidate; `refresh` exposes it as POST /api/refresh.

import type { Snapshot } from "../../src/engine/types.ts";
import { SCHEMA_VERSION } from "../../src/engine/types.ts";
import { GithubClient } from "../../src/collector/github.ts";
import type { ErrorKind, EtagCache } from "../../src/collector/github.ts";
import { CollectError } from "../../src/collector/github.ts";
import { collect, DEFAULT_PLATFORM_REPO } from "../../src/collector/collect.ts";
import { ConfigError, parsePlatformRepo } from "../../src/collector/validate.ts";
import type { Store } from "./store.ts";
import { KEYS } from "./store.ts";

export type Trigger = "manual" | "stale" | "initial";
export type Outcome = "refreshed" | "floor" | "in-flight" | "failed";
export type FlowErrorKind = ErrorKind | "config" | "unknown";

export interface FlowError {
  kind: FlowErrorKind;
  message: string;
  at: string;
  resetAt?: string;
  status?: number;
}

export interface RefreshResult {
  outcome: Outcome;
  snapshot: Snapshot | null;
  error?: FlowError;
}

/** What a collector receives; the fixture collector ignores the client. */
export interface CollectContext {
  client: GithubClient;
  fetch: typeof fetch;
  now: () => string;
  platformRepo: string;
  deadline: number;
}

export interface RefreshDeps {
  store: Store;
  fetch: typeof fetch;
  token: string;
  now: () => string;
  trigger: Trigger;
  ip?: string;
  platformRepo?: string;
  collectFn?: (ctx: CollectContext) => Promise<Snapshot>;
  budgetMs?: number;
  lockTtlMs?: number;
  /** test seam for the log line; default console.info */
  log?: (line: string) => void;
}

export const BUDGET_MS = 8_000;
export const LOCK_TTL_MS = 90_000;
export const DEFAULT_FLOOR_SECONDS = 60;
export const DEFAULT_INTERVAL_MINUTES = 10;

interface Lock {
  at: string;
  ttlMs: number;
}

/** A stored snapshot counts only when its schema is the one this code reads. */
export async function readSnapshot(store: Store): Promise<Snapshot | null> {
  const stored = await store.getJSON<Snapshot>(KEYS.latest);
  if (!stored || typeof stored !== "object" || stored.schemaVersion !== SCHEMA_VERSION) return null;
  return stored;
}

export function floorSeconds(snapshot: Snapshot | null): number {
  const v = snapshot?.config?.refresh?.floor_seconds;
  return typeof v === "number" && v > 0 ? v : DEFAULT_FLOOR_SECONDS;
}

export function intervalMinutes(snapshot: Snapshot | null): number {
  const v = snapshot?.config?.refresh?.interval_minutes;
  return typeof v === "number" && v > 0 ? v : DEFAULT_INTERVAL_MINUTES;
}

export function toFlowError(err: unknown, at: string): FlowError {
  if (err instanceof CollectError) {
    const out: FlowError = { kind: err.kind, message: err.message, at };
    if (err.resetAt !== undefined) out.resetAt = err.resetAt;
    if (err.status !== undefined) out.status = err.status;
    return out;
  }
  if (err instanceof ConfigError) return { kind: "config", message: err.message, at };
  const message = err instanceof Error ? err.message : String(err);
  return { kind: "unknown", message, at };
}

function defaultCollect(ctx: CollectContext): Promise<Snapshot> {
  return collect({ client: ctx.client, fetch: ctx.fetch, now: ctx.now, platformRepo: ctx.platformRepo, deadline: ctx.deadline });
}

export async function runRefresh(deps: RefreshDeps): Promise<RefreshResult> {
  const at = deps.now();
  const nowMs = Date.parse(at);
  const startedMs = Date.now();
  const emit = deps.log ?? ((line: string) => console.info(line));
  let logged = false;
  // The log line uses the spec's vocabulary (R17): trigger `page` | `manual`,
  // outcome `stored` | `kept-previous` (+ reason). Internal names stay finer.
  const log = (fields: Record<string, unknown>): void => {
    if (logged) return;
    logged = true;
    const { outcome, ...rest } = fields;
    const line: Record<string, unknown> = {
      trigger: deps.trigger === "manual" ? "manual" : "page",
      ip: deps.ip ?? null,
      outcome: outcome === "refreshed" ? "stored" : "kept-previous",
      ...(outcome !== "refreshed" ? { reason: outcome } : {}),
      ...rest,
    };
    emit(JSON.stringify(line));
  };
  const idle = (outcome: Outcome, extra: Record<string, unknown> = {}) =>
    log({ outcome, calls: 0, cached: 0, cachedRatio: 0, durationMs: Date.now() - startedMs, remaining: null, ...extra });

  const latest = await readSnapshot(deps.store);
  const snapshotAt = latest?.collectedAt ?? null;

  const platformRepo = deps.platformRepo ?? process.env.PLATFORM_REPO ?? DEFAULT_PLATFORM_REPO;
  if (!parsePlatformRepo(platformRepo)) {
    const error: FlowError = { kind: "config", message: `PLATFORM_REPO "${platformRepo}" must be owner/repo`, at };
    idle("failed", { snapshotAt, error });
    return { outcome: "failed", snapshot: latest, error };
  }

  if (latest && nowMs - Date.parse(latest.collectedAt) < floorSeconds(latest) * 1000) {
    idle("floor", { snapshotAt });
    return { outcome: "floor", snapshot: latest };
  }

  // Single flight: create the lock; if it exists and has expired, take it
  // over against its etag so two takers cannot both win.
  const lock: Lock = { at, ttlMs: deps.lockTtlMs ?? LOCK_TTL_MS };
  let acquired = (await deps.store.setJSON(KEYS.lock, lock, { onlyIfNew: true })).modified;
  if (!acquired) {
    const held = await deps.store.getWithEtag<Lock>(KEYS.lock);
    if (held) {
      const expired = !(typeof held.value?.at === "string") || Date.parse(held.value.at) + (held.value.ttlMs ?? LOCK_TTL_MS) <= nowMs;
      if (expired) acquired = (await deps.store.setJSON(KEYS.lock, lock, { onlyIfMatch: held.etag })).modified;
    } else {
      acquired = (await deps.store.setJSON(KEYS.lock, lock, { onlyIfNew: true })).modified;
    }
  }
  if (!acquired) {
    idle("in-flight", { snapshotAt });
    return { outcome: "in-flight", snapshot: latest };
  }

  const deadline = Date.now() + (deps.budgetMs ?? BUDGET_MS);
  const etagCache = (await deps.store.getJSON<EtagCache>(KEYS.etags)) ?? {};
  const client = new GithubClient({ token: deps.token, fetch: deps.fetch, etagCache, deadline });
  const collectFn = deps.collectFn ?? defaultCollect;
  try {
    const snapshot = await collectFn({ client, fetch: deps.fetch, now: deps.now, platformRepo, deadline });
    if (latest) await deps.store.setJSON(KEYS.previous, latest);
    await deps.store.setJSON(KEYS.latest, snapshot);
    await deps.store.delete(KEYS.lastError);
    client.pruneCache();
    await deps.store.setJSON(KEYS.etags, client.etagCache());
    const s = client.stats();
    log({
      outcome: "refreshed",
      calls: s.calls,
      cached: s.cached,
      cachedRatio: s.calls ? Number((s.cached / s.calls).toFixed(3)) : 0,
      durationMs: Date.now() - startedMs,
      remaining: s.remaining ?? null,
      snapshotAt: snapshot.collectedAt,
      warnings: snapshot.warnings.length,
    });
    return { outcome: "refreshed", snapshot };
  } catch (err) {
    const error = toFlowError(err, at);
    await deps.store.setJSON(KEYS.lastError, error);
    await deps.store.setJSON(KEYS.etags, client.etagCache());
    const s = client.stats();
    log({
      outcome: "failed",
      calls: s.calls,
      cached: s.cached,
      cachedRatio: s.calls ? Number((s.cached / s.calls).toFixed(3)) : 0,
      durationMs: Date.now() - startedMs,
      remaining: s.remaining ?? null,
      snapshotAt,
      error,
    });
    return { outcome: "failed", snapshot: latest, error };
  } finally {
    await deps.store.delete(KEYS.lock);
  }
}
