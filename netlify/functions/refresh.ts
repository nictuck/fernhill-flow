// POST /api/refresh (R17). Header-gated, floor + single-flight inside
// runRefresh. With no token it refreshes the bundled sample through the
// store so previews exercise the same path.

import type { Context } from "@netlify/functions";
import { makeStore, resolvePrefix } from "../lib/store.ts";
import { readSnapshot, runRefresh } from "../lib/refresh-core.ts";
import { fixtureCollect } from "../lib/fixture.ts";
import type { FlowDeps, FunctionContext } from "./flow.ts";
import { json } from "./flow.ts";

export const REFRESH_HEADER = "x-flow-refresh";
export const TRIGGER_HEADER = "x-flow-trigger";

export function makeRefreshHandler(deps: FlowDeps): (req: Request, context?: FunctionContext) => Promise<Response> {
  return async (req, context) => {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (req.headers.get(REFRESH_HEADER) !== "1") return json({ error: "missing X-Flow-Refresh header" }, 400);
    const prefix = resolvePrefix(context, deps.env ?? process.env);
    if (!prefix) return json({ error: "no deploy context" }, 500);
    const store = deps.makeStore(prefix);
    const ip = context?.ip ?? req.headers.get("x-nf-client-connection-ip") ?? undefined;
    // The page's background revalidation says so (R17 logs `page` vs `manual`).
    const trigger = req.headers.get(TRIGGER_HEADER) === "page" ? ("stale" as const) : ("manual" as const);
    const common = {
      store,
      fetch: deps.fetch,
      now: deps.now,
      trigger,
      ...(ip !== undefined ? { ip } : {}),
      ...(deps.platformRepo !== undefined ? { platformRepo: deps.platformRepo } : {}),
      ...(deps.log !== undefined ? { log: deps.log } : {}),
    };

    if (!deps.token) {
      const result = await runRefresh({ ...common, token: "", collectFn: fixtureCollect });
      const snapshot = await readSnapshot(store);
      const body: Record<string, unknown> = { mode: "fixture", outcome: result.outcome, snapshot };
      if (result.error) body["error"] = result.error;
      return json(body);
    }

    const result = await runRefresh({ ...common, token: deps.token });
    const body: Record<string, unknown> = { mode: "live", outcome: result.outcome, snapshot: result.snapshot };
    if (result.error) body["error"] = result.error;
    return json(body);
  };
}

const handler = makeRefreshHandler({
  makeStore,
  fetch: globalThis.fetch,
  token: process.env.GITHUB_TOKEN,
  now: () => new Date().toISOString(),
});

export default async (req: Request, context: Context): Promise<Response> => handler(req, context);
