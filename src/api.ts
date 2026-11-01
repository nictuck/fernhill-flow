// The browser side of the two functions, and the one hook the app reads.
// Stale-while-revalidate (R8): GET /api/flow; when the snapshot is older than
// the interval, POST /api/refresh (with the header, R17) and GET again. The
// previous snapshot stays on screen the whole time.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "./engine/types.ts";
import { needsRefresh } from "./engine/index.ts";

export type FlowErrorKind =
  | "token"
  | "rate-limit"
  | "not-found"
  | "upstream"
  | "bounds"
  | "cap"
  | "config"
  | "unknown";

export interface FlowError {
  kind: FlowErrorKind;
  message: string;
  /** ISO time the error happened */
  at: string;
  /** rate-limit only: when GitHub resets */
  resetAt?: string;
  /** upstream HTTP status when there was one */
  status?: number;
}

export type FlowResponse =
  | { mode: "fixture"; snapshot?: Snapshot | null }
  | { mode: "live"; snapshot: Snapshot | null; stale: boolean; lastError?: FlowError };

export interface RefreshResponse {
  outcome: "refreshed" | "floor" | "in-flight" | "failed";
  snapshot: Snapshot | null;
  error?: FlowError;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new ApiError(`${what} returned ${res.status}`, res.status);
  return (await res.json()) as T;
}

/** The three network calls, on one object so tests can spy on them. */
export const api = {
  async getFlow(): Promise<FlowResponse> {
    const res = await fetch("/api/flow", { headers: { accept: "application/json" } });
    return readJson<FlowResponse>(res, "GET /api/flow");
  },
  async postRefresh(): Promise<RefreshResponse> {
    const res = await fetch("/api/refresh", {
      method: "POST",
      headers: { accept: "application/json", "X-Flow-Refresh": "1" },
    });
    return readJson<RefreshResponse>(res, "POST /api/refresh");
  },
  async loadFixture(): Promise<Snapshot> {
    const mod = await import("./fixtures/sample.json");
    return mod.default as unknown as Snapshot;
  },
};

export type FlowStatus = "loading" | "ready" | "error";
export type FlowMode = "fixture" | "live";

export interface FlowState {
  status: FlowStatus;
  mode: FlowMode | null;
  snapshot: Snapshot | null;
  previousSnapshot: Snapshot | null;
  /** the function's own "older than the interval" flag */
  stale: boolean;
  refreshing: boolean;
  lastError: FlowError | null;
  /** when the last refresh attempt finished (client clock) */
  lastRefreshAt: string | null;
  /** the "now" to derive against: collectedAt in fixture mode so days are stable */
  now: string;
  refresh: () => void;
}

type Internal = Omit<FlowState, "refresh">;

const nowIso = () => new Date().toISOString();

const initial: Internal = {
  status: "loading",
  mode: null,
  snapshot: null,
  previousSnapshot: null,
  stale: false,
  refreshing: false,
  lastError: null,
  lastRefreshAt: null,
  now: nowIso(),
};

function networkError(e: unknown): FlowError {
  const status = e instanceof ApiError ? e.status : undefined;
  const err: FlowError = {
    kind: "upstream",
    message: e instanceof Error ? e.message : "Network request failed",
    at: nowIso(),
  };
  if (status !== undefined) err.status = status;
  return err;
}

function isFlowResponse(x: unknown): x is FlowResponse {
  return typeof x === "object" && x !== null && ((x as FlowResponse).mode === "fixture" || (x as FlowResponse).mode === "live");
}

async function safeGet(): Promise<FlowResponse> {
  try {
    const res = await api.getFlow();
    if (isFlowResponse(res)) return res;
    return {
      mode: "live",
      snapshot: null,
      stale: false,
      lastError: { kind: "upstream", message: "Unexpected response from /api/flow", at: nowIso() },
    };
  } catch (e) {
    return { mode: "live", snapshot: null, stale: false, lastError: networkError(e) };
  }
}

async function safePost(): Promise<RefreshResponse> {
  try {
    return await api.postRefresh();
  } catch (e) {
    return { outcome: "failed", snapshot: null, error: networkError(e) };
  }
}

function intervalOf(s: Snapshot | null): number {
  return s?.config.refresh.interval_minutes ?? 10;
}

export function useFlow(): FlowState {
  const [state, setState] = useState<Internal>(initial);
  const busy = useRef(false);
  const modeRef = useRef<FlowMode | null>(null);
  modeRef.current = state.mode;

  const applyFixture = useCallback((snapshot: Snapshot) => {
    setState((prev) => ({
      ...prev,
      status: "ready",
      mode: "fixture",
      snapshot,
      previousSnapshot: prev.snapshot && prev.snapshot !== snapshot ? prev.snapshot : prev.previousSnapshot,
      stale: false,
      refreshing: false,
      lastError: null,
      now: snapshot.collectedAt,
    }));
  }, []);

  const applyLive = useCallback(
    (res: Extract<FlowResponse, { mode: "live" }>, opts: { refreshing: boolean; fallbackError?: FlowError; done?: boolean }) => {
      const at = nowIso();
      setState((prev) => {
        const incoming = res.snapshot;
        const snapshot = incoming ?? prev.snapshot;
        const changed = incoming !== null && incoming.collectedAt !== prev.snapshot?.collectedAt;
        let lastError: FlowError | null = res.lastError ?? opts.fallbackError ?? null;
        const status: FlowStatus = snapshot ? "ready" : opts.refreshing ? "loading" : "error";
        if (status === "error" && !lastError) {
          lastError = { kind: "unknown", message: "No snapshot available.", at };
        }
        return {
          status,
          mode: "live",
          snapshot,
          previousSnapshot: changed ? prev.snapshot : prev.previousSnapshot,
          stale: res.stale,
          refreshing: opts.refreshing,
          lastError,
          lastRefreshAt: opts.done ? at : prev.lastRefreshAt,
          now: changed || !prev.snapshot ? at : prev.now,
        };
      });
    },
    [],
  );

  const run = useCallback(
    async (trigger: "mount" | "manual") => {
      if (busy.current) return;
      busy.current = true;
      try {
        let res: FlowResponse;
        if (trigger === "manual" && modeRef.current === "live") {
          // The button: straight to the refresh, the snapshot on screen stays.
          setState((prev) => ({ ...prev, refreshing: true }));
        } else {
          res = await safeGet();
          if (res.mode === "fixture") {
            applyFixture(res.snapshot ?? (await api.loadFixture()));
            return;
          }
          const want =
            trigger === "manual" ||
            res.stale ||
            res.snapshot === null ||
            needsRefresh(res.snapshot.collectedAt, nowIso(), intervalOf(res.snapshot));
          applyLive(res, { refreshing: want });
          if (!want) return;
        }

        const r = await safePost();
        const postError = r.outcome === "failed" ? (r.error ?? { kind: "unknown", message: "Refresh failed.", at: nowIso() }) : undefined;
        res = await safeGet();
        if (res.mode === "fixture") {
          applyFixture(res.snapshot ?? (await api.loadFixture()));
          return;
        }
        const opts: { refreshing: boolean; fallbackError?: FlowError; done?: boolean } = { refreshing: false, done: true };
        if (postError) opts.fallbackError = postError;
        applyLive(res, opts);
      } finally {
        busy.current = false;
      }
    },
    [applyFixture, applyLive],
  );

  useEffect(() => {
    void run("mount");
  }, [run]);

  const refresh = useCallback(() => {
    void run("manual");
  }, [run]);

  return { ...state, refresh };
}
