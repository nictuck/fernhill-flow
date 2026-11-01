// One snapshot per flow.md row, built from the shared builders. Every
// scenario holds exactly one intent "0001" so `derive(...)[0]` is the row
// under test. Durations are parameters so the threshold tests can place a
// timestamp exactly at and one day over the limit.

import type {
  CiStatus,
  Incident,
  Intent,
  Pr,
  ReleaseRun,
  RepoSnapshot,
  Snapshot,
  Spec,
  ThresholdKey,
} from "../../src/engine/types.ts";
import {
  GH,
  PLATFORM,
  daysAgo,
  makeIntent,
  makePlan,
  makePr,
  makeRepo,
  makeRun,
  makeSnapshot,
} from "../helpers/build.ts";

export const PRODUCT = "fernhill-flow";
export const SPEC_URL = `${GH}/${PLATFORM}/blob/main/intent/0001-example/spec.md`;
export const INTENT_PR_URL = `${GH}/${PLATFORM}/pull/7`;
export const SPEC_PR_URL = `${GH}/${PLATFORM}/pull/12`;
export const MERGE_SHA = "d".repeat(40);

/** Copy without the given keys (the builders cannot take `undefined` under exactOptionalPropertyTypes). */
export function strip<T extends object>(obj: T, ...keys: (keyof T)[]): T {
  const copy = { ...obj } as Record<string, unknown>;
  for (const k of keys) delete copy[k as string];
  return copy as T;
}

export function acceptedSpec(acceptedDaysAgo = 8, over: Partial<Spec> = {}): Spec {
  return { status: "accepted", flagged: 0, url: SPEC_URL, acceptedAt: daysAgo(acceptedDaysAgo), ...over };
}

export interface SnapshotOpts {
  intents?: Intent[];
  repos?: RepoSnapshot[];
  incidents?: Incident[];
  thresholds?: Partial<Record<ThresholdKey, number>>;
}

/** The default snapshot (platform repo only) plus what the case needs. */
export function snapshotWith(opts: SnapshotOpts = {}): Snapshot {
  const base = makeSnapshot();
  return {
    ...base,
    config: { ...base.config, thresholds: { ...base.config.thresholds, ...opts.thresholds } },
    platform: { ...base.platform, intents: opts.intents ?? [], incidents: opts.incidents ?? [] },
    repos: [...base.repos, ...(opts.repos ?? [])],
  };
}

/** An intent past gate 2 and linked to the product repo. */
export function linkedIntent(over: Partial<Intent> = {}): Intent {
  return makeIntent({ product: PRODUCT, spec: acceptedSpec(), ...over });
}

export function productRepo(over: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return makeRepo({ name: PRODUCT, ...over });
}

export function mergedPr(over: Partial<Pr> = {}): Pr {
  return makePr({
    number: 5,
    state: "merged",
    createdAt: daysAgo(6),
    updatedAt: daysAgo(2),
    mergedAt: daysAgo(2),
    mergedBy: "nictuck",
    mergeCommit: MERGE_SHA,
    ...over,
  });
}

/** A release run for the merged PR's commit. */
export function runFor(over: Partial<ReleaseRun> = {}): ReleaseRun {
  return makeRun({ sha: MERGE_SHA, ...over });
}

export const scenario = {
  /** 1 Plan: intent PR open for `n` days. */
  planPr: (n = 1): Snapshot =>
    snapshotWith({
      intents: [
        strip(makeIntent({ status: "proposed", prNumber: 7, prOpenedAt: daysAgo(n), url: INTENT_PR_URL }), "acceptedAt"),
      ],
    }),

  /** 2 Design: accepted `n` days ago, no spec. */
  designNoSpec: (n = 2): Snapshot => snapshotWith({ intents: [makeIntent({ acceptedAt: daysAgo(n) })] }),

  /** 2 Design: spec PR open for `n` days with `flagged` concerns. */
  designSpecPr: (n = 1, flagged = 2): Snapshot =>
    snapshotWith({
      intents: [
        makeIntent({
          acceptedAt: daysAgo(n + 3),
          spec: { status: "proposed", flagged, url: SPEC_PR_URL, prNumber: 12, prOpenedAt: daysAgo(n) },
        }),
      ],
    }),

  /** 3 Build: spec accepted `n` days ago, `product: ""`. */
  buildNoRepo: (n = 2): Snapshot => snapshotWith({ intents: [makeIntent({ spec: acceptedSpec(n) })] }),

  /** 3 Build: product names a repo the snapshot does not hold. */
  buildRepoMissing: (n = 2): Snapshot =>
    snapshotWith({ intents: [makeIntent({ product: "fernhill-x", spec: acceptedSpec(n) })] }),

  /** 3 Build: repo linked, no plan, spec accepted `n` days ago. */
  buildNoPlan: (n = 2): Snapshot =>
    snapshotWith({ intents: [linkedIntent({ spec: acceptedSpec(n) })], repos: [productRepo()] }),

  /** 3 Build: plan proposed `n` days ago. */
  buildProposedPlan: (n = 1): Snapshot =>
    snapshotWith({
      intents: [linkedIntent()],
      repos: [productRepo({ plans: [makePlan({ status: "proposed", approvedBy: "", createdAt: daysAgo(n) })] })],
    }),

  /** 3 Build: plan approved, build branch last pushed `idleDays` ago, no PR. */
  buildApproved: (idleDays = 1): Snapshot =>
    snapshotWith({
      intents: [linkedIntent()],
      repos: [
        productRepo({
          plans: [makePlan({ createdAt: daysAgo(idleDays + 1) })],
          buildBranches: [{ name: "build/0001-example", intent: "0001", lastCommitAt: daysAgo(idleDays) }],
        }),
      ],
    }),

  /** 3 Build: plan approved `planDays` ago, no branch, no PR. */
  buildApprovedNoBranch: (planDays = 1): Snapshot =>
    snapshotWith({ intents: [linkedIntent()], repos: [productRepo({ plans: [makePlan({ createdAt: daysAgo(planDays) })] })] }),

  /** 4 Test: build PR #5 open, last pushed `updatedDaysAgo` ago. */
  testPr: (ci: CiStatus, updatedDaysAgo = 0.5, over: Partial<Pr> = {}): Snapshot =>
    snapshotWith({
      intents: [linkedIntent()],
      repos: [
        productRepo({
          plans: [makePlan()],
          prs: [makePr({ number: 5, ci, createdAt: daysAgo(updatedDaysAgo + 2), updatedAt: daysAgo(updatedDaysAgo), ...over })],
        }),
      ],
    }),

  /** 4 Test with several PRs: the engine must pick the latest same-repo build PR. */
  testPrs: (prs: Pr[]): Snapshot =>
    snapshotWith({ intents: [linkedIntent()], repos: [productRepo({ plans: [makePlan()], prs })] }),

  /** 5 Deploy: PR #5 merged 2 days ago with the given release runs. */
  deploy: (runs: ReleaseRun[], prOver: Partial<Pr> = {}): Snapshot =>
    snapshotWith({
      intents: [linkedIntent()],
      repos: [productRepo({ plans: [makePlan()], prs: [mergedPr(prOver)], releaseRuns: runs })],
    }),

  /** 6 Maintain: merge commit in production and served, `mergedDaysAgo` days ago. */
  maintain: (incidents: Incident[] = [], mergedDaysAgo = 20): Snapshot =>
    snapshotWith({
      intents: [linkedIntent()],
      repos: [
        productRepo({
          plans: [makePlan()],
          prs: [
            mergedPr({
              mergedAt: daysAgo(mergedDaysAgo),
              updatedAt: daysAgo(mergedDaysAgo),
              inProduction: true,
              servedLive: true,
            }),
          ],
        }),
      ],
      incidents,
    }),

  /** Done / parked / rejected, status set `n` days ago. */
  done: (n = 18, status: "done" | "parked" | "rejected" = "done"): Snapshot =>
    snapshotWith({ intents: [makeIntent({ status, statusSetAt: daysAgo(n), statusSetBy: "nictuck" })] }),
};
