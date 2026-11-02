// Fixture mode (R10): a deploy with no GitHub token still goes through the
// store, the lock and the schema check — it just "collects" the bundled
// sample snapshot instead of talking to GitHub.
//
// The sample was built against a fixed clock (its `collectedAt`). Serving
// it "as of now" means shifting every timestamp in it by the same delta;
// otherwise every age clamps to 0 days and nothing is ever stuck.

import sample from "../../src/fixtures/sample.json" with { type: "json" };
import type { Snapshot } from "../../src/engine/types.ts";
import type { CollectContext } from "./refresh-core.ts";

export const SAMPLE_SNAPSHOT = sample as unknown as Snapshot;

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a deep copy of `value` with every ISO timestamp moved by `deltaMs`. */
export function shiftTimestamps<T>(value: T, deltaMs: number): T {
  if (typeof value === "string") {
    if (ISO_DATETIME.test(value)) return new Date(Date.parse(value) + deltaMs).toISOString() as T;
    if (ISO_DATE.test(value)) return new Date(Date.parse(`${value}T00:00:00Z`) + deltaMs).toISOString().slice(0, 10) as T;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => shiftTimestamps(v, deltaMs)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = shiftTimestamps(v, deltaMs);
    return out as T;
  }
  return value;
}

export async function fixtureCollect(ctx: CollectContext): Promise<Snapshot> {
  const now = ctx.now();
  const delta = Date.parse(now) - Date.parse(SAMPLE_SNAPSHOT.collectedAt);
  const shifted = shiftTimestamps(SAMPLE_SNAPSHOT, delta);
  return { ...shifted, collectedAt: now };
}
