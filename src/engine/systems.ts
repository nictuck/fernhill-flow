// R7: one row per repo — what staging and production serve, in plain words.

import type { RepoSnapshot, Snapshot, SystemsRow } from "./types.ts";
import { fmtDate } from "./time.ts";
import { newestRun } from "./derive.ts";

export function short(sha: string): string {
  return sha.slice(0, 7);
}

export function systemsLine(repo: RepoSnapshot, now?: string): SystemsRow["line"] {
  if (repo.error !== undefined && repo.error !== "") return { kind: "unknown", text: repo.error };

  const prod = repo.production.version;
  const staging = repo.staging.version;
  const head = repo.productionHead;
  const behind = repo.productionBehindMain;

  if (prod !== undefined && staging !== undefined && prod === staging) {
    return { kind: "ok", text: "Production matches staging" };
  }
  if (prod !== undefined && head !== undefined && prod !== head) {
    return {
      kind: "rollback",
      text: `Rollback in effect: production serves ${short(prod)}, branch is at ${short(head)}`,
    };
  }
  if (behind !== undefined && behind.count > 0) {
    const since = behind.since !== undefined ? ` (since ${fmtDate(behind.since, now)})` : "";
    const commits = behind.count === 1 ? "commit" : "commits";
    return { kind: "behind", text: `Production is ${behind.count} ${commits} behind staging${since}` };
  }
  if (prod === undefined) {
    return { kind: "unknown", text: `Production version unknown (${repo.production.error ?? "version.txt missing or invalid"})` };
  }
  if (staging === undefined) {
    return { kind: "unknown", text: `Staging version unknown (${repo.staging.error ?? "version.txt missing or invalid"})` };
  }
  if (head === undefined) {
    return { kind: "unknown", text: "Production branch missing" };
  }
  if (behind === undefined) {
    return { kind: "unknown", text: "Production branch comparison unavailable" };
  }
  return {
    kind: "unknown",
    text: `Staging serves ${short(staging)}, production serves ${short(prod)} (staging may still be deploying)`,
  };
}

/** Repos in flow.config.json order; repos the config does not list come last, in snapshot order. */
export function systems(snapshot: Snapshot): SystemsRow[] {
  const order = new Map(snapshot.config.repos.map((r, i) => [r.name, i]));
  const rank = (name: string): number => order.get(name) ?? Number.MAX_SAFE_INTEGER;
  const repos = [...snapshot.repos].sort((a, b) => rank(a.name) - rank(b.name));

  return repos.map((repo) => {
    const row: SystemsRow = {
      repo,
      line: systemsLine(repo, snapshot.collectedAt),
      openPrs: repo.prs.filter((p) => p.state === "open").length,
      openIncidents: snapshot.platform.incidents.filter((i) => i.product === repo.name && i.status === "open").length,
    };
    const last = newestRun(repo.releaseRuns);
    if (last !== undefined) row.lastRelease = last;
    return row;
  });
}
