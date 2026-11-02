// GET /api/flow (R8, R10). Serves the snapshot for this deploy context; with
// no token it serves the bundled sample through the same store path.

import type { Context } from "@netlify/functions";
import type { Store } from "../lib/store.ts";
import { KEYS, makeStore, resolvePrefix } from "../lib/store.ts";
import type { FlowError } from "../lib/refresh-core.ts";
import { intervalMinutes, readSnapshot, runRefresh } from "../lib/refresh-core.ts";
import { fixtureCollect } from "../lib/fixture.ts";

/** The parts of the Functions v2 Context the handlers read; tests pass a literal. */
export interface FunctionContext {
  ip?: string;
  deploy?: { context?: string };
}

export interface FlowDeps {
  makeStore: (prefix: string) => Store;
  fetch: typeof fetch;
  token: string | undefined;
  now: () => string;
  platformRepo?: string;
  env?: { CONTEXT?: string | undefined };
  log?: (line: string) => void;
}

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

export function makeFlowHandler(deps: FlowDeps): (req: Request, context?: FunctionContext) => Promise<Response> {
  return async (req, context) => {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    const prefix = resolvePrefix(context, deps.env ?? process.env);
    if (!prefix) return json({ error: "no deploy context" }, 500);
    const store = deps.makeStore(prefix);
    const common = {
      store,
      fetch: deps.fetch,
      now: deps.now,
      ...(deps.platformRepo !== undefined ? { platformRepo: deps.platformRepo } : {}),
      ...(deps.log !== undefined ? { log: deps.log } : {}),
    };

    if (!deps.token) {
      if (!(await readSnapshot(store))) {
        await runRefresh({ ...common, token: "", trigger: "initial", collectFn: fixtureCollect });
      }
      const snapshot = await readSnapshot(store);
      return json({ mode: "fixture", snapshot });
    }

    let snapshot = await readSnapshot(store);
    let lastError = await store.getJSON<FlowError>(KEYS.lastError);
    if (!snapshot) {
      const result = await runRefresh({ ...common, token: deps.token, trigger: "initial" });
      snapshot = result.snapshot;
      if (result.error) lastError = result.error;
    }
    const stale = snapshot ? Date.parse(deps.now()) - Date.parse(snapshot.collectedAt) > intervalMinutes(snapshot) * 60_000 : false;
    const body: Record<string, unknown> = { mode: "live", snapshot, stale };
    if (lastError) body["lastError"] = lastError;
    return json(body);
  };
}

const handler = makeFlowHandler({
  makeStore,
  fetch: globalThis.fetch,
  token: process.env.GITHUB_TOKEN,
  now: () => new Date().toISOString(),
});

export default async (req: Request, context: Context): Promise<Response> => handler(req, context);
