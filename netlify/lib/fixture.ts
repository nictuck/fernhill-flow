// Fixture mode (R10): a deploy with no GitHub token still goes through the
// store, the lock and the schema check — it just "collects" the bundled
// sample snapshot instead of talking to GitHub.

import sample from "../../src/fixtures/sample.json" with { type: "json" };
import type { Snapshot } from "../../src/engine/types.ts";
import type { CollectContext } from "./refresh-core.ts";

export const SAMPLE_SNAPSHOT = sample as unknown as Snapshot;

export async function fixtureCollect(ctx: CollectContext): Promise<Snapshot> {
  return { ...SAMPLE_SNAPSHOT, collectedAt: ctx.now() };
}
