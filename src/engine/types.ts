// The snapshot schema: what the collector writes, what the engine reads,
// what Blobs stores. Bump SCHEMA_VERSION on any shape change — `flow`
// treats a mismatch as "no snapshot, refresh needed" (spec: Shape).
// Everything here is plain data; no functions, no Dates (ISO strings).

export const SCHEMA_VERSION = 1;

export type IntentStatus = "proposed" | "accepted" | "parked" | "rejected" | "done";
export type SpecStatus = "proposed" | "accepted" | "superseded";
export type PlanStatus = "proposed" | "approved" | "superseded";
export type IncidentStatus = "open" | "fix-now" | "scheduled" | "dismissed" | "resolved";
export type PrClass = "intent" | "spec" | "incident" | "release" | "build" | "fix" | "permission" | "docs";
export type PrState = "open" | "merged" | "closed";
export type CiStatus = "green" | "red" | "running" | "none";
export type Role = "product owner" | "engineer" | "code owner" | "release manager" | "on-call";
export type Stage = "plan" | "design" | "build" | "test" | "deploy" | "maintain" | "done";
export type StateKind = "waiting" | "progress" | "live" | "done";

export const STAGES: readonly Stage[] = ["plan", "design", "build", "test", "deploy", "maintain", "done"];
export const ROLES: readonly Role[] = ["product owner", "engineer", "code owner", "release manager", "on-call"];

// Threshold keys, one per stuck condition in flow.md. The coverage test
// (R3) asserts this list ⇄ config.thresholds ⇄ engine conditions.
export const THRESHOLD_KEYS = [
  "plan.pr_open_days",
  "design.no_spec_pr_days",
  "design.spec_pr_open_days",
  "build.no_repo_days",
  "build.no_plan_days",
  "build.branch_idle_days",
  "test.ci_red_days",
  "test.review_pending_days",
  "deploy.approval_pending_days",
  "maintain.untriaged_days",
] as const;
export type ThresholdKey = (typeof THRESHOLD_KEYS)[number];

export interface RepoRef {
  name: string;
  site: string;
  kind: "platform" | "product";
}

export interface FlowConfig {
  github_owner: string;
  platform_repo: string;
  repos: RepoRef[];
  thresholds: Record<ThresholdKey, number>;
  refresh: { interval_minutes: number; floor_seconds: number };
  board: { done_days: number };
}

export interface Pr {
  number: number;
  url: string;
  title: string;
  branch: string;
  class: PrClass;
  /** intent id parsed from the branch (`build/0001-x` → "0001"), if any */
  intent?: string;
  state: PrState;
  /** false for fork PRs — never trusted, shown only (R18) */
  sameRepo: boolean;
  author: string;
  createdAt: string;
  /** last head push; the Test clock and branch-idle checks use it */
  updatedAt: string;
  mergedAt?: string;
  mergedBy?: string;
  mergeCommit?: string;
  headSha: string;
  ci: CiStatus;
  /** the failing (or latest) check's URL */
  ciUrl?: string;
  /** true once the merge commit is reachable from the `production` branch */
  inProduction?: boolean;
  /** true once the production site serves a sha that contains the merge commit */
  servedLive?: boolean;
}

export interface Spec {
  status: SpecStatus;
  flagged: number;
  url: string;
  /** merge time of the spec PR (Build clock) */
  acceptedAt?: string;
  /** open same-repo PR adding/changing it, if any */
  prNumber?: number;
  /** when that PR was opened (Design "spec PR open" clock) */
  prOpenedAt?: string;
}

export interface Intent {
  id: string;
  title: string;
  status: IntentStatus;
  author: string;
  origin: string;
  /** product repo name, "" until scripts/new-product links one */
  product: string;
  created: string;
  /** directory under intent/, e.g. "0001-flow-dashboard" */
  dir: string;
  url: string;
  /** merge time of the PR that added intent.md (Design clock) */
  acceptedAt?: string;
  /** commit that last touched intent.md: used as the Done / parked / rejected time */
  statusSetAt?: string;
  statusSetBy?: string;
  /** open same-repo PR adding this intent (Plan stage), if the intent is not on main yet.
   *  Such an intent is built from the branch name and PR title only — never from
   *  the PR's file content (R18). */
  prNumber?: number;
  /** when that PR was opened (Plan clock) */
  prOpenedAt?: string;
  spec?: Spec;
}

export interface Exception {
  id: string;
  status: string;
  grants: string[];
  repos: string[];
  /** when the delegation started (the merge of the exception file); the timeline
   *  marks a merge as "under exception" when granted ≤ mergedAt ≤ expires */
  granted?: string;
  expires: string;
  authorizedBy: string;
  url: string;
}

export interface Incident {
  path: string;
  url: string;
  product: string;
  severity: string;
  status: IncidentStatus;
  intent: string;
  opened: string;
  triagedBy: string;
  reason: string;
  /** open same-repo PR adding it, if not on main yet */
  prNumber?: number;
}

export interface Plan {
  path: string;
  url: string;
  intent: string;
  status: PlanStatus;
  approvedBy: string;
  /** first commit of the file (Build "no plan" clock ends here) */
  createdAt: string;
  /** true if the plan is on main; false if only on an open PR branch */
  onMain: boolean;
}

export interface ReleaseRun {
  id: number;
  url: string;
  sha: string;
  status: "queued" | "in_progress" | "waiting" | "completed";
  conclusion?: "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "action_required" | "neutral";
  /** the production environment is waiting for the release manager */
  pendingApproval: boolean;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface SiteState {
  url: string;
  /** sha served by version.txt, when it parsed as a 40-char hex sha */
  version?: string;
  error?: string;
}

export interface RepoSnapshot {
  name: string;
  kind: "platform" | "product";
  site: string;
  url: string;
  mainHead?: string;
  mainCi: CiStatus;
  productionHead?: string;
  /** compare production...main; undefined when either branch is missing */
  productionBehindMain?: { count: number; since?: string };
  staging: SiteState;
  production: SiteState;
  prs: Pr[];
  plans: Plan[];
  releaseRuns: ReleaseRun[];
  /** `build/NNNN-*` branches with their last commit time (Build idle check) */
  buildBranches: { name: string; intent?: string; lastCommitAt: string }[];
  /** set when the repo could not be read ("repo not found" copy, R9) */
  error?: string;
}

export interface Snapshot {
  schemaVersion: number;
  collectedAt: string;
  config: FlowConfig;
  platform: {
    intents: Intent[];
    exceptions: Exception[];
    incidents: Incident[];
    personas: { id: string; enabled: boolean }[];
  };
  repos: RepoSnapshot[];
  stats: { calls: number; durationMs: number; rateLimitRemaining?: number };
  /** non-fatal collection problems, shown on Systems */
  warnings: string[];
}

// ---- derived (engine output) ----------------------------------------------

export interface Action {
  /** the one line the person reads */
  text: string;
  /** link to the exact page, or … */
  href?: string;
  /** … a command to copy; then `secondary` is the "View …" link */
  copy?: string;
  secondary?: { text: string; href: string };
}

export interface Derived {
  intent: Intent;
  stage: Stage;
  state: StateKind;
  waitingOn?: Role;
  action?: Action;
  /** ISO time the stage clock started */
  clockStart: string;
  /** whole days since clockStart at `now` (time in stage) */
  days: number;
  /** ISO time the current wait began — exactly what the stuck threshold is measured
   *  from (oldest open incident `opened`, `pr.updatedAt`, `run.createdAt`,
   *  `plan.createdAt`); equals clockStart when the wait began with the stage */
  waitStart: string;
  /** whole days since waitStart at `now`; "Waiting on ‹role› for N days" shows this,
   *  and `stuck` is exactly `waitDays > limit` */
  waitDays: number;
  stuck: boolean;
  /** the threshold that applies in this state, when there is one */
  limit?: number;
  thresholdKey?: ThresholdKey;
  /** false for Done cards past board.done_days (Archive only) */
  onBoard: boolean;
  ci?: CiStatus;
  /** extra facts for the state line, e.g. "CI red", "2 open incidents" */
  notes: string[];
  /** the product repo snapshot, when linked and present */
  repo?: RepoSnapshot;
}

/** One Needs-you row: an intent waiting on a role, or an open incident (on-call). */
export type NeedsYouItem =
  | { kind: "intent"; derived: Derived; days: number; stuck: boolean; limit?: number; action?: Action }
  | { kind: "incident"; incident: Incident; days: number; stuck: boolean; limit?: number; action: Action };

export interface NeedsYou {
  /** total rows across groups; goes in the document title */
  count: number;
  /** ROLES order; empty groups omitted; rows stuck first, then oldest */
  groups: { role: Role; rows: NeedsYouItem[] }[];
  inProgress: number;
  stuck: number;
}

export interface SystemsRow {
  repo: RepoSnapshot;
  line: { kind: "ok" | "behind" | "rollback" | "unknown"; text: string };
  lastRelease?: ReleaseRun;
  openPrs: number;
  openIncidents: number;
}

export type TimelineKind =
  | "intent-pr"
  | "intent-accepted"
  | "spec-pr"
  | "spec-accepted"
  | "plan"
  | "build-pr"
  | "merged"
  | "release"
  | "deployed"
  | "incident"
  | "status";

/** One entry of an intent's timeline (R5): every artifact and gate, who and when, linked to its source. */
export interface TimelineEntry {
  /** ISO time the entry happened; the timeline is sorted by this ascending */
  at: string;
  kind: TimelineKind;
  text: string;
  /** GitHub login or display name, never an email */
  who?: string;
  /** already passed through safeHref */
  href?: string;
  ci?: CiStatus;
  /** id of the exception in effect when this merge happened */
  exception?: string;
}
