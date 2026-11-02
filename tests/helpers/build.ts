// Builders for test snapshots. Every suite (engine, functions, UI) starts
// from these so a schema change is one edit. Defaults describe a healthy,
// quiet company: one platform repo, no intents. Override what the case is
// about and nothing else.

import type {
  FlowConfig,
  Intent,
  Pr,
  RepoSnapshot,
  Snapshot,
  Plan,
  ReleaseRun,
  Incident,
  Exception,
} from "../../src/engine/types.ts";
import { SCHEMA_VERSION } from "../../src/engine/types.ts";

/** Fixed "now" for every test: 2026-11-10T12:00:00Z. */
export const NOW = "2026-11-10T12:00:00.000Z";

/** ISO time `days` days before NOW (fractions allowed). */
export function daysAgo(days: number, from: string = NOW): string {
  return new Date(Date.parse(from) - days * 86_400_000).toISOString();
}

export const OWNER = "nictuck";
export const PLATFORM = "fernhill-platform";
export const GH = `https://github.com/${OWNER}`;

export function makeConfig(over: Partial<FlowConfig> = {}): FlowConfig {
  return {
    github_owner: OWNER,
    platform_repo: PLATFORM,
    repos: [
      { name: PLATFORM, site: "fernhillplatform", kind: "platform" },
      { name: "fernhill-flow", site: "fernhill-flow", kind: "product" },
    ],
    thresholds: {
      "plan.pr_open_days": 3,
      "design.no_spec_pr_days": 5,
      "design.spec_pr_open_days": 3,
      "build.no_repo_days": 5,
      "build.no_plan_days": 5,
      "build.branch_idle_days": 3,
      "test.ci_red_days": 1,
      "test.review_pending_days": 2,
      "deploy.approval_pending_days": 2,
      "maintain.untriaged_days": 1,
    },
    refresh: { interval_minutes: 10, floor_seconds: 60 },
    board: { done_days: 30 },
    ...over,
  };
}

export function makeIntent(over: Partial<Intent> = {}): Intent {
  const id = over.id ?? "0001";
  const dir = over.dir ?? `${id}-example`;
  return {
    id,
    title: "Example intent",
    status: "accepted",
    author: "Nicholas Tucker",
    origin: "idea",
    product: "",
    created: "2026-11-01",
    dir,
    url: `${GH}/${PLATFORM}/tree/main/intent/${dir}`,
    acceptedAt: daysAgo(10),
    ...over,
  };
}

export function makePr(over: Partial<Pr> = {}): Pr {
  const number = over.number ?? 1;
  const repo = "fernhill-flow";
  return {
    number,
    url: `${GH}/${repo}/pull/${number}`,
    title: `PR ${number}`,
    branch: "build/0001-example",
    class: "build",
    intent: "0001",
    state: "open",
    sameRepo: true,
    author: "nictuck",
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    headSha: "a".repeat(40),
    ci: "green",
    ...over,
  };
}

export function makePlan(over: Partial<Plan> = {}): Plan {
  return {
    path: "plan/0001-example.md",
    url: `${GH}/fernhill-flow/blob/main/plan/0001-example.md`,
    intent: "0001",
    status: "approved",
    approvedBy: "Nicholas Tucker",
    createdAt: daysAgo(2),
    onMain: true,
    ...over,
  };
}

export function makeRun(over: Partial<ReleaseRun> = {}): ReleaseRun {
  return {
    id: 100,
    url: `${GH}/fernhill-flow/actions/runs/100`,
    sha: "b".repeat(40),
    status: "waiting",
    pendingApproval: true,
    createdAt: daysAgo(0.5),
    ...over,
  };
}

export function makeIncident(over: Partial<Incident> = {}): Incident {
  const path = over.path ?? "incidents/2026-11-09-blank-board.md";
  return {
    path,
    url: `${GH}/${PLATFORM}/blob/main/${path}`,
    product: "fernhill-flow",
    severity: "sev2",
    status: "open",
    intent: "",
    opened: daysAgo(0.5),
    triagedBy: "",
    reason: "",
    ...over,
  };
}

export function makeException(over: Partial<Exception> = {}): Exception {
  return {
    id: "EX-001",
    status: "active",
    grants: ["merge"],
    repos: [PLATFORM, "fernhill-flow"],
    expires: "2026-11-30",
    authorizedBy: "Nicholas Tucker",
    url: `${GH}/${PLATFORM}/blob/main/exceptions/EX-001-agent-merges-during-platform-build.md`,
    ...over,
  };
}

export function makeRepo(over: Partial<RepoSnapshot> = {}): RepoSnapshot {
  const name = over.name ?? "fernhill-flow";
  const site = over.site ?? name;
  return {
    name,
    kind: name === PLATFORM ? "platform" : "product",
    site,
    url: `${GH}/${name}`,
    mainHead: "c".repeat(40),
    mainCi: "green",
    productionHead: "c".repeat(40),
    productionBehindMain: { count: 0 },
    staging: { url: `https://main--${site}.netlify.app`, version: "c".repeat(40) },
    production: { url: `https://${site}.netlify.app`, version: "c".repeat(40) },
    prs: [],
    plans: [],
    releaseRuns: [],
    buildBranches: [],
    ...over,
  };
}

export function makeSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    collectedAt: NOW,
    config: makeConfig(),
    platform: { intents: [], exceptions: [], incidents: [], personas: [] },
    repos: [makeRepo({ name: PLATFORM, site: "fernhillplatform" })],
    stats: { calls: 0, durationMs: 0 },
    warnings: [],
    ...over,
  };
}
