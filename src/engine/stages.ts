// R6: stage detail — occupants, stuck count, and median/max time-in-stage
// once five or more intents have a measurable duration for the stage.

import type { Derived, Intent, Snapshot, Stage } from "./types.ts";
import { daysBetween } from "./time.ts";
import { buildPrs, latestBuildPr, linkedRepo, releaseRunFor } from "./derive.ts";

export interface StageStats {
  n: number;
  medianDays: number;
  maxDays: number;
}

export interface StageDetail {
  count: number;
  stuckCount: number;
  stats?: StageStats;
}

export const STATS_MIN_N = 5;

function earliest(times: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const t of times) {
    if (best === undefined || Date.parse(t) < Date.parse(best)) best = t;
  }
  return best;
}

/** Days a past intent spent in `stage`, from timestamps already in the snapshot; undefined when not measurable. */
export function completedDuration(stage: Stage, intent: Intent, snapshot: Snapshot): number | undefined {
  const span = (from: string | undefined, to: string | undefined): number | undefined =>
    from === undefined || to === undefined ? undefined : daysBetween(from, to);
  const repo = linkedRepo(snapshot, intent);
  const pr = latestBuildPr(repo, intent.id);

  switch (stage) {
    case "plan": {
      const platform = snapshot.repos.find((r) => r.name === snapshot.config.platform_repo);
      const intentPr = platform?.prs.find(
        (p) => p.sameRepo && p.class === "intent" && p.intent === intent.id && p.state === "merged",
      );
      if (intentPr) return span(intentPr.createdAt, intentPr.mergedAt);
      return span(intent.prOpenedAt, intent.acceptedAt);
    }
    case "design":
      return span(intent.acceptedAt, intent.spec?.acceptedAt);
    case "build": {
      const all = repo ? repo.prs.filter((p) => p.sameRepo && p.class === "build" && p.intent === intent.id) : buildPrs(repo, intent.id);
      return span(intent.spec?.acceptedAt, earliest(all.map((p) => p.createdAt)));
    }
    case "test":
      return pr && pr.state === "merged" ? span(pr.createdAt, pr.mergedAt) : undefined;
    case "deploy": {
      if (!repo || !pr || pr.state !== "merged") return undefined;
      const run = releaseRunFor(repo, pr);
      return span(pr.mergedAt, run?.approvedAt);
    }
    case "maintain":
    case "done":
      return undefined;
  }
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function stageDetail(stage: Stage, rows: Derived[], snapshot: Snapshot, _now: string): StageDetail {
  const occupants = rows.filter((d) => d.onBoard && d.stage === stage);
  const occupantIds = new Set(occupants.map((d) => d.intent.id));

  const durations: number[] = occupants.map((d) => d.days);
  for (const intent of snapshot.platform.intents) {
    if (occupantIds.has(intent.id)) continue;
    const days = completedDuration(stage, intent, snapshot);
    if (days !== undefined) durations.push(days);
  }

  const detail: StageDetail = { count: occupants.length, stuckCount: occupants.filter((d) => d.stuck).length };
  if (durations.length >= STATS_MIN_N) {
    detail.stats = { n: durations.length, medianDays: median(durations), maxDays: Math.max(...durations) };
  }
  return detail;
}
