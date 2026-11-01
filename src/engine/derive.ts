// The one encoding of flow.md → "Stage state machine". Evaluated per intent
// in the order Done → Maintain → Deploy → Test → Build → Design → Plan on
// the intent's latest build PR; the first matching row wins. Pure: a
// Snapshot and a `now` in, Derived rows out; never throws on odd data.

import type {
  Action,
  CiStatus,
  Derived,
  FlowConfig,
  Incident,
  Intent,
  Plan,
  Pr,
  ReleaseRun,
  RepoSnapshot,
  Role,
  Snapshot,
  Stage,
  StateKind,
  ThresholdKey,
} from "./types.ts";
import { daysBetween, plural } from "./time.ts";
import { safeHref } from "./links.ts";

export function derive(snapshot: Snapshot, now: string): Derived[] {
  return snapshot.platform.intents.map((intent) => {
    try {
      return deriveIntent(intent, snapshot, now);
    } catch (err) {
      return unclassified(intent, undefined, now, `derivation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

// ---- shared lookups (also used by needsYou, systems, timeline) -------------

/** The repo an intent is linked to, when `product` names one present in the snapshot. */
export function linkedRepo(snapshot: Snapshot, intent: Intent): RepoSnapshot | undefined {
  if (intent.product === "") return undefined;
  return snapshot.repos.find((r) => r.name === intent.product);
}

/** The intent's build PRs: same-repo, class build, open or merged (closed-unmerged ones are history). */
export function buildPrs(repo: RepoSnapshot | undefined, intentId: string): Pr[] {
  if (!repo) return [];
  return repo.prs.filter(
    (pr) => pr.sameRepo && pr.class === "build" && pr.intent === intentId && pr.state !== "closed",
  );
}

/** The unit of evaluation: the highest-numbered build PR for the intent. */
export function latestBuildPr(repo: RepoSnapshot | undefined, intentId: string): Pr | undefined {
  let best: Pr | undefined;
  for (const pr of buildPrs(repo, intentId)) {
    if (!best || pr.number > best.number) best = pr;
  }
  return best;
}

/** The newest release run by createdAt (ties: highest id). */
export function newestRun(runs: readonly ReleaseRun[]): ReleaseRun | undefined {
  let best: ReleaseRun | undefined;
  for (const run of runs) {
    if (!best) {
      best = run;
      continue;
    }
    const a = Date.parse(run.createdAt);
    const b = Date.parse(best.createdAt);
    if (a > b || (a === b && run.id > best.id)) best = run;
  }
  return best;
}

/** The release run for a merged PR: the one whose sha is its merge commit, else the newest run. */
export function releaseRunFor(repo: RepoSnapshot, pr: Pr): ReleaseRun | undefined {
  if (pr.mergeCommit) {
    const matching = repo.releaseRuns.filter((r) => r.sha === pr.mergeCommit);
    const match = newestRun(matching);
    if (match) return match;
  }
  return newestRun(repo.releaseRuns);
}

/** The plan that counts for an intent: an approved one, else the newest non-superseded one. */
export function planFor(repo: RepoSnapshot, intentId: string): Plan | undefined {
  const plans = repo.plans.filter((p) => p.intent === intentId && p.status !== "superseded");
  return newestPlan(plans.filter((p) => p.status === "approved")) ?? newestPlan(plans);
}

function newestPlan(plans: Plan[]): Plan | undefined {
  let best: Plan | undefined;
  for (const p of plans) {
    if (!best || Date.parse(p.createdAt) > Date.parse(best.createdAt)) best = p;
  }
  return best;
}

export function openIncidents(snapshot: Snapshot, product: string): Incident[] {
  return snapshot.platform.incidents.filter((i) => i.product === product && i.status === "open");
}

/** Oldest incident by `opened`. */
export function oldestIncident(incidents: readonly Incident[]): Incident | undefined {
  let best: Incident | undefined;
  for (const i of incidents) {
    if (!best || Date.parse(i.opened) < Date.parse(best.opened)) best = i;
  }
  return best;
}

/** `incidents/2026-11-09-blank-board.md` → `blank-board`. */
export function incidentSlug(incident: Incident): string {
  const base = incident.path.split("/").pop() ?? incident.path;
  return base.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

/** `0001-flow-dashboard` → `flow-dashboard`. */
export function intentSlug(intent: Intent): string {
  const slug = intent.dir.replace(/^\d{4}-/, "");
  return slug === "" ? intent.id : slug;
}

export function triageAction(incident: Incident, config: FlowConfig): Action {
  return link(`Triage incident ${incidentSlug(incident)}`, incident.url, config);
}

// ---- action builders --------------------------------------------------------

function link(text: string, href: string | undefined, config: FlowConfig): Action {
  const safe = safeHref(href, config);
  return safe === undefined ? { text } : { text, href: safe };
}

function command(copy: string, viewText: string, viewHref: string | undefined, config: FlowConfig): Action {
  const action: Action = { text: copy, copy };
  const safe = safeHref(viewHref, config);
  if (safe !== undefined) action.secondary = { text: viewText, href: safe };
  return action;
}

// ---- row construction -------------------------------------------------------

interface Row {
  stage: Stage;
  state: StateKind;
  clockStart: string;
  waitingOn?: Role;
  action?: Action;
  stuck?: boolean;
  threshold?: { key: ThresholdKey; limit: number };
  onBoard?: boolean;
  ci?: CiStatus;
  notes?: string[];
}

function row(intent: Intent, repo: RepoSnapshot | undefined, now: string, r: Row): Derived {
  const d: Derived = {
    intent,
    stage: r.stage,
    state: r.state,
    clockStart: r.clockStart,
    days: daysBetween(r.clockStart, now),
    stuck: r.stuck ?? false,
    onBoard: r.onBoard ?? true,
    notes: r.notes ?? [],
  };
  if (r.waitingOn !== undefined) d.waitingOn = r.waitingOn;
  if (r.action !== undefined) d.action = r.action;
  if (r.threshold !== undefined) {
    d.limit = r.threshold.limit;
    d.thresholdKey = r.threshold.key;
  }
  if (r.ci !== undefined) d.ci = r.ci;
  if (repo !== undefined) d.repo = repo;
  return d;
}

function unclassified(intent: Intent, repo: RepoSnapshot | undefined, now: string, why: string): Derived {
  return row(intent, repo, now, {
    stage: "plan",
    state: "progress",
    clockStart: intent.created,
    notes: [`unclassified: ${why}`],
  });
}

// ---- the state machine ------------------------------------------------------

function deriveIntent(intent: Intent, snapshot: Snapshot, now: string): Derived {
  const { config } = snapshot;
  const thresholds = config.thresholds;
  const repo = linkedRepo(snapshot, intent);
  const pr = latestBuildPr(repo, intent.id);

  /** Stuck check: `days since from` strictly greater than the threshold; at the limit is not stuck. */
  const check = (key: ThresholdKey, from: string): Pick<Row, "stuck" | "threshold"> => {
    const limit = thresholds[key];
    return { stuck: daysBetween(from, now) > limit, threshold: { key, limit } };
  };

  // Done: status done stays on the board for board.done_days; parked and
  // rejected go straight to Archive.
  if (intent.status === "done" || intent.status === "parked" || intent.status === "rejected") {
    const clockStart = intent.statusSetAt ?? intent.acceptedAt ?? intent.created;
    const onBoard = intent.status === "done" && daysBetween(clockStart, now) <= config.board.done_days;
    return row(intent, repo, now, {
      stage: "done",
      state: "done",
      clockStart,
      onBoard,
      notes: intent.status === "done" ? [] : [intent.status],
    });
  }

  // Maintain: merge commit in production and served live.
  if (repo && pr && pr.state === "merged" && pr.inProduction === true && pr.servedLive === true) {
    const clockStart = pr.mergedAt ?? pr.updatedAt;
    const open = openIncidents(snapshot, repo.name);
    const triaged = snapshot.platform.incidents.filter(
      (i) => i.product === repo.name && (i.status === "fix-now" || i.status === "scheduled"),
    );
    if (open.length === 0) {
      return row(intent, repo, now, {
        stage: "maintain",
        state: "live",
        clockStart,
        notes: [triaged.length > 0 ? `${plural(triaged.length, "incident")} triaged` : "no open incidents"],
      });
    }
    const oldest = oldestIncident(open) ?? open[0]!;
    return row(intent, repo, now, {
      stage: "maintain",
      state: "waiting",
      waitingOn: "on-call",
      clockStart,
      action: triageAction(oldest, config),
      ...check("maintain.untriaged_days", oldest.opened),
      notes: [`${plural(open.length, "open incident")}`],
    });
  }

  // Deploy: merged, not yet in production and served.
  if (repo && pr && pr.state === "merged") {
    const clockStart = pr.mergedAt ?? pr.updatedAt;
    const run = releaseRunFor(repo, pr);
    if (!run || ((run.status === "queued" || run.status === "in_progress") && !run.pendingApproval)) {
      return row(intent, repo, now, { stage: "deploy", state: "progress", clockStart, notes: ["staging"] });
    }
    if (run.pendingApproval || run.status === "waiting") {
      return row(intent, repo, now, {
        stage: "deploy",
        state: "waiting",
        waitingOn: "release manager",
        clockStart,
        action: link(`Approve production for run #${run.id}`, run.url, config),
        ...check("deploy.approval_pending_days", run.createdAt),
        notes: ["production approval pending"],
      });
    }
    if (run.conclusion === "failure" || run.conclusion === "timed_out" || run.conclusion === "cancelled") {
      return row(intent, repo, now, {
        stage: "deploy",
        state: "waiting",
        waitingOn: "release manager",
        clockStart,
        action: link(`Release run #${run.id} failed`, run.url, config),
        stuck: true,
        notes: ["release run failed"],
      });
    }
    return row(intent, repo, now, {
      stage: "deploy",
      state: "progress",
      clockStart,
      notes: ["waiting for production to serve"],
    });
  }

  // Test: latest build PR open.
  if (repo && pr && pr.state === "open") {
    const clockStart = pr.createdAt;
    if (pr.ci === "running") {
      return row(intent, repo, now, { stage: "test", state: "progress", clockStart, ci: pr.ci, notes: ["CI running"] });
    }
    if (pr.ci === "red") {
      return row(intent, repo, now, {
        stage: "test",
        state: "waiting",
        waitingOn: "engineer",
        clockStart,
        ci: pr.ci,
        action: link(`CI failing on PR #${pr.number}`, pr.ciUrl ?? `${pr.url}/checks`, config),
        ...check("test.ci_red_days", pr.updatedAt),
        notes: ["CI red"],
      });
    }
    return row(intent, repo, now, {
      stage: "test",
      state: "waiting",
      waitingOn: "code owner",
      clockStart,
      ci: pr.ci,
      action: link(`Review and merge PR #${pr.number}`, pr.url, config),
      ...check("test.review_pending_days", pr.updatedAt),
      notes: [pr.ci === "green" ? "CI green" : "no CI"],
    });
  }

  // Build: spec accepted on main.
  const spec = intent.spec;
  if (spec && spec.status === "accepted") {
    const clockStart = spec.acceptedAt ?? intent.acceptedAt ?? intent.created;
    if (!repo) {
      return row(intent, undefined, now, {
        stage: "build",
        state: "waiting",
        waitingOn: "product owner",
        clockStart,
        action: command(`scripts/new-product ${intentSlug(intent)} --intent ${intent.id}`, "View spec", spec.url, config),
        ...check("build.no_repo_days", clockStart),
        notes: [intent.product === "" ? "no product repo" : `repo ${intent.product} not in snapshot`],
      });
    }
    const plan = planFor(repo, intent.id);
    if (!plan) {
      return row(intent, repo, now, {
        stage: "build",
        state: "waiting",
        waitingOn: "engineer",
        clockStart,
        action: command(`/plan ${intent.id}`, "View repo", repo.url, config),
        ...check("build.no_plan_days", clockStart),
        notes: ["no plan"],
      });
    }
    if (plan.status === "proposed") {
      return row(intent, repo, now, {
        stage: "build",
        state: "waiting",
        waitingOn: "engineer",
        clockStart,
        action: link(`Approve plan ${plan.path}`, plan.url, config),
        ...check("build.no_plan_days", plan.createdAt),
        notes: ["plan proposed"],
      });
    }
    // Plan approved, no open or merged build PR yet: an agent is (or should be) building.
    let branch: RepoSnapshot["buildBranches"][number] | undefined;
    for (const b of repo.buildBranches) {
      if (b.intent !== intent.id) continue;
      if (!branch || Date.parse(b.lastCommitAt) > Date.parse(branch.lastCommitAt)) branch = b;
    }
    return row(intent, repo, now, {
      stage: "build",
      state: "progress",
      clockStart,
      ...check("build.branch_idle_days", branch ? branch.lastCommitAt : plan.createdAt),
      notes: [branch ? `branch ${branch.name}` : "no build branch yet"],
    });
  }

  // Design: intent on main and accepted, no accepted spec.
  if (intent.prNumber === undefined && intent.status === "accepted") {
    const clockStart = intent.acceptedAt ?? intent.created;
    if (spec && spec.prNumber !== undefined) {
      const concerns = spec.flagged > 0 ? ` (${plural(spec.flagged, "concern")} open)` : "";
      return row(intent, repo, now, {
        stage: "design",
        state: "waiting",
        waitingOn: "product owner",
        clockStart,
        action: link(`Accept spec ${intent.id}${concerns}`, spec.url, config),
        ...check("design.spec_pr_open_days", spec.prOpenedAt ?? clockStart),
        notes: [`spec PR #${spec.prNumber} open`],
      });
    }
    return row(intent, repo, now, {
      stage: "design",
      state: "waiting",
      waitingOn: "product owner",
      clockStart,
      action: command(`/design ${intent.id}`, "View intent", intent.url, config),
      ...check("design.no_spec_pr_days", clockStart),
      notes: [spec ? `spec ${spec.status}, no spec PR` : "no spec"],
    });
  }

  // Plan: the intent exists only on an open PR.
  if (intent.prNumber !== undefined) {
    const clockStart = intent.prOpenedAt ?? intent.created;
    return row(intent, repo, now, {
      stage: "plan",
      state: "waiting",
      waitingOn: "product owner",
      clockStart,
      action: link(`Accept or reject intent ${intent.id}`, intent.url, config),
      ...check("plan.pr_open_days", clockStart),
      notes: [`intent PR #${intent.prNumber} open`],
    });
  }

  return unclassified(intent, repo, now, `intent ${intent.status} on main matches no stage`);
}
