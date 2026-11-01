// The collector: platform `main` + PRs, each configured repo, each site →
// one Snapshot (spec: Data sources and collection). Read-only. Fatal errors
// (platform tree/config unreadable, token, rate limit, call cap, time
// budget) end the refresh; everything else becomes a warning and the
// snapshot still ships.

import type {
  CiStatus,
  Exception,
  Incident,
  Intent,
  Plan,
  Pr,
  ReleaseRun,
  RepoRef,
  RepoSnapshot,
  SiteState,
  Snapshot,
  Spec,
} from "../engine/types.ts";
import { SCHEMA_VERSION } from "../engine/types.ts";
import type { GithubClient, TimeoutOptions } from "./github.ts";
import { BUDGET_MESSAGE, CollectError, DEFAULT_TIMEOUT_MS, fetchWithTimeout, isFatalError, readBounded } from "./github.ts";
import {
  exceptionFrontmatter,
  incidentFrontmatter,
  intentFrontmatter,
  parseFrontmatter,
  personaFrontmatter,
  planFrontmatter,
  specFrontmatter,
} from "./frontmatter.ts";
import type { Validated } from "./frontmatter.ts";
import { classifyBranch, classifyFiles } from "./classify.ts";
import { ConfigError, isSameRepo, isSha, parsePlatformRepo, parseVersion, validateConfig } from "./validate.ts";

export const DEFAULT_PLATFORM_REPO = "nictuck/fernhill-platform";
export const MERGED_WINDOW_DAYS = 90;
export const MERGED_BY_CAP = 20;
export const COMPARE_CAP = 10;
export const PLAN_CAP = 10;
export const BRANCH_CAP = 10;
export const APPROVAL_RUNS = 3;
export const SITE_MAX_BYTES = 1024;

export interface CollectDeps {
  client: GithubClient;
  /** plain fetch for the public version.txt reads (no token) */
  fetch: typeof fetch;
  /** ISO clock */
  now: () => string;
  /** `owner/repo` of the platform; default nictuck/fernhill-platform */
  platformRepo?: string;
  /** per-call timeout for site reads; default 5 s */
  timeoutMs?: number;
  /** absolute ms deadline shared with the client (Date.now clock) */
  deadline?: number;
}

// ---- GitHub response shapes (the fields we read) ----------------------------

interface GhUser {
  login?: string | null;
}
interface GhTreeEntry {
  path?: string;
  type?: string;
  sha?: string;
}
interface GhTree {
  tree?: GhTreeEntry[];
  truncated?: boolean;
}
interface GhBlob {
  content?: string;
  encoding?: string;
}
interface GhPr {
  number: number;
  html_url: string;
  title: string;
  state: string;
  user?: GhUser | null;
  head: { ref: string; sha: string; repo?: { full_name?: string } | null };
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  merged_by?: GhUser | null;
}
interface GhFile {
  filename?: string;
}
interface GhCheckRun {
  status?: string | null;
  conclusion?: string | null;
  html_url?: string | null;
  details_url?: string | null;
}
interface GhCheckRuns {
  check_runs?: GhCheckRun[];
}
interface GhCombinedStatus {
  statuses?: { state?: string; target_url?: string | null }[];
}
interface GhCommit {
  sha?: string;
  commit?: {
    committer?: { date?: string; name?: string } | null;
    author?: { date?: string; name?: string } | null;
  };
  author?: GhUser | null;
}
interface GhBranch {
  name?: string;
  commit?: { sha?: string };
}
interface GhCompare {
  status?: string;
  ahead_by?: number;
  commits?: GhCommit[];
}
interface GhRun {
  id: number;
  html_url: string;
  head_sha: string;
  status?: string | null;
  conclusion?: string | null;
  created_at: string;
}
interface GhRuns {
  workflow_runs?: GhRun[];
}
interface GhApproval {
  state?: string;
  user?: GhUser | null;
  created_at?: string;
  updated_at?: string;
}

// ---- context -----------------------------------------------------------------

interface Ctx {
  client: GithubClient;
  fetch: typeof fetch;
  owner: string;
  platform: string;
  nowIso: string;
  nowMs: number;
  sinceMs: number;
  warnings: string[];
  budget: { mergedBy: number; compares: number };
  siteTimeout: TimeoutOptions;
}

function warn(ctx: Ctx, message: string): void {
  ctx.warnings.push(message);
}

/** Run one non-essential step: fatal errors propagate, the rest become a warning. */
async function soft<T>(ctx: Ctx, label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isFatalError(err)) throw err;
    warn(ctx, `${label}: ${(err as Error).message}`);
    return fallback;
  }
}

function asObject<T extends object>(value: unknown, what: string): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CollectError("upstream", `unexpected shape for ${what}`);
  }
  return value as T;
}

function asArray<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) throw new CollectError("upstream", `unexpected shape for ${what}`);
  return value as T[];
}

function decodeBlob(blob: GhBlob): string {
  const content = blob.content ?? "";
  if (blob.encoding !== "base64") return content;
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function githubUrl(ctx: Ctx, repo: string, rest = ""): string {
  return `https://github.com/${ctx.owner}/${repo}${rest}`;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function isIgnoredDoc(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return base === "readme.md" || base === "template.md";
}

// ---- GitHub reads -------------------------------------------------------------

async function getTree(ctx: Ctx, repo: string): Promise<GhTreeEntry[]> {
  const tree = asObject<GhTree>(await ctx.client.get(`/repos/${ctx.owner}/${repo}/git/trees/main?recursive=1`), "tree");
  if (tree.truncated) warn(ctx, `${repo}: tree of main is truncated; some files were not read`);
  return (tree.tree ?? []).filter((e) => e.type === "blob" && typeof e.path === "string" && typeof e.sha === "string");
}

async function getBlobText(ctx: Ctx, repo: string, sha: string): Promise<string> {
  const blob = asObject<GhBlob>(await ctx.client.get(`/repos/${ctx.owner}/${repo}/git/blobs/${sha}`), "blob");
  return decodeBlob(blob);
}

/** Read and validate one artifact; null (with a warning) when it is not usable. */
async function readArtifact<T>(
  ctx: Ctx,
  repo: string,
  entry: GhTreeEntry,
  validate: (fm: Record<string, unknown>) => Validated<T>,
): Promise<T | null> {
  const path = entry.path ?? "";
  try {
    const text = await getBlobText(ctx, repo, entry.sha ?? "");
    const fm = parseFrontmatter(text);
    const v = validate(fm);
    if (v.value === null) {
      warn(ctx, `${repo}/${path} skipped: ${v.reason}`);
      return null;
    }
    return v.value;
  } catch (err) {
    if (isFatalError(err) && err instanceof CollectError) throw err;
    warn(ctx, `${repo}/${path} skipped: ${(err as Error).message}`);
    return null;
  }
}

async function listPrs(ctx: Ctx, repo: string): Promise<GhPr[]> {
  const prs = asArray<GhPr>(
    await ctx.client.get(`/repos/${ctx.owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`),
    "pull list",
  );
  return prs.filter((p) => typeof p.number === "number" && typeof p.head?.ref === "string");
}

const BAD_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"]);
const RUNNING_STATUSES = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

async function checkRuns(ctx: Ctx, repo: string, sha: string): Promise<{ ci: CiStatus; ciUrl?: string }> {
  const data = asObject<GhCheckRuns>(
    await ctx.client.get(`/repos/${ctx.owner}/${repo}/commits/${sha}/check-runs?per_page=50`),
    "check runs",
  );
  const runs = data.check_runs ?? [];
  if (runs.length === 0) {
    const combined = asObject<GhCombinedStatus>(
      await ctx.client.get(`/repos/${ctx.owner}/${repo}/commits/${sha}/status`),
      "combined status",
    );
    const statuses = combined.statuses ?? [];
    if (statuses.length === 0) return { ci: "none" };
    const failing = statuses.find((s) => s.state === "failure" || s.state === "error");
    if (failing) return failing.target_url ? { ci: "red", ciUrl: failing.target_url } : { ci: "red" };
    if (statuses.some((s) => s.state === "pending")) return { ci: "running" };
    return { ci: "green" };
  }
  const bad = runs.filter((r) => r.status === "completed" && BAD_CONCLUSIONS.has(r.conclusion ?? ""));
  const pick = bad[0] ?? runs[0];
  const url = pick?.html_url ?? pick?.details_url ?? undefined;
  const withUrl = (ci: CiStatus): { ci: CiStatus; ciUrl?: string } => (url ? { ci, ciUrl: url } : { ci });
  if (bad.length > 0) return withUrl("red");
  if (runs.some((r) => RUNNING_STATUSES.has(r.status ?? ""))) return withUrl("running");
  if (runs.some((r) => r.conclusion === "success")) return withUrl("green");
  return { ci: "none" };
}

/** Raw PR → Pr, with classification, CI and mergedBy. Null when it is out of scope. */
async function buildPr(ctx: Ctx, repo: string, raw: GhPr): Promise<Pr | null> {
  const merged = typeof raw.merged_at === "string";
  const state: Pr["state"] = raw.state === "open" ? "open" : merged ? "merged" : "closed";
  if (state === "closed") return null;
  if (state === "merged" && Date.parse(raw.merged_at ?? "") < ctx.sinceMs) return null;

  const sameRepo = isSameRepo(raw.head.repo?.full_name, ctx.owner, repo);
  let cls = classifyBranch(raw.head.ref);
  if (!cls && state === "open" && sameRepo) {
    cls = await soft(
      ctx,
      `${repo}#${raw.number} files`,
      async () => {
        const files = asArray<GhFile>(
          await ctx.client.get(`/repos/${ctx.owner}/${repo}/pulls/${raw.number}/files?per_page=100`),
          "pull files",
        );
        return classifyFiles(files.map((f) => f.filename ?? ""));
      },
      { class: "docs" as const },
    );
  }
  cls ??= { class: "docs" };

  const pr: Pr = {
    number: raw.number,
    url: raw.html_url,
    title: raw.title ?? "",
    branch: raw.head.ref,
    class: cls.class,
    state,
    sameRepo,
    author: raw.user?.login ?? "",
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    headSha: raw.head.sha,
    ci: "none",
  };
  if (cls.intent) pr.intent = cls.intent;
  if (merged && raw.merged_at) pr.mergedAt = raw.merged_at;
  if (merged && isSha(raw.merge_commit_sha)) pr.mergeCommit = raw.merge_commit_sha;

  if (!sameRepo) return pr;

  if (state === "open") {
    const ci = await soft(ctx, `${repo}#${raw.number} checks`, () => checkRuns(ctx, repo, raw.head.sha), { ci: "none" as CiStatus });
    pr.ci = ci.ci;
    if (ci.ciUrl) pr.ciUrl = ci.ciUrl;
  }

  const wantsMergedBy = pr.class === "intent" || pr.class === "spec" || pr.class === "build";
  if (state === "merged" && wantsMergedBy && ctx.budget.mergedBy > 0) {
    ctx.budget.mergedBy -= 1;
    const detail = await soft(
      ctx,
      `${repo}#${raw.number} detail`,
      async () => asObject<GhPr>(await ctx.client.get(`/repos/${ctx.owner}/${repo}/pulls/${raw.number}`), "pull"),
      null,
    );
    const login = detail?.merged_by?.login;
    if (typeof login === "string" && login) pr.mergedBy = login;
  }
  return pr;
}

async function buildPrs(ctx: Ctx, repo: string, raw: GhPr[]): Promise<Pr[]> {
  const built = await Promise.all(raw.map((r) => buildPr(ctx, repo, r)));
  return built.filter((p): p is Pr => p !== null).sort((a, b) => b.number - a.number);
}

async function branchHead(ctx: Ctx, repo: string, branch: string): Promise<string | undefined> {
  try {
    const b = asObject<GhBranch>(await ctx.client.get(`/repos/${ctx.owner}/${repo}/branches/${branch}`), "branch");
    return isSha(b.commit?.sha) ? b.commit.sha : undefined;
  } catch (err) {
    if (err instanceof CollectError && err.kind === "not-found") return undefined;
    throw err;
  }
}

async function firstCommitDate(ctx: Ctx, repo: string, path: string): Promise<string | undefined> {
  const commits = asArray<GhCommit>(
    await ctx.client.get(`/repos/${ctx.owner}/${repo}/commits?path=${encodeURIComponent(path)}&per_page=100`),
    "commits",
  );
  const last = commits[commits.length - 1];
  return last?.commit?.committer?.date ?? last?.commit?.author?.date ?? undefined;
}

// ---- sites --------------------------------------------------------------------

async function fetchSite(ctx: Ctx, url: string): Promise<SiteState> {
  try {
    const { res, text } = await fetchWithTimeout(
      ctx.fetch,
      `${url}/version.txt`,
      { method: "GET", headers: { "User-Agent": "fernhill-flow" } },
      ctx.siteTimeout,
      (r) => (r.ok ? readBounded(r, SITE_MAX_BYTES) : Promise.resolve("")),
    );
    if (!res.ok) return { url, error: `HTTP ${res.status}` };
    const version = parseVersion(text);
    if (!version) return { url, error: "version.txt is not a commit sha" };
    return { url, version };
  } catch (err) {
    if (err instanceof CollectError && err.message === BUDGET_MESSAGE) throw err;
    return { url, error: (err as Error).message };
  }
}

// ---- platform -----------------------------------------------------------------

interface PlatformArtifacts {
  intents: Map<string, Intent>;
  exceptions: Exception[];
  incidents: Incident[];
  personas: { id: string; enabled: boolean }[];
}

async function readPlatformArtifacts(ctx: Ctx, tree: GhTreeEntry[]): Promise<PlatformArtifacts> {
  const repo = ctx.platform;
  const intentEntries = tree.filter((e) => /^intent\/[^/]+\/intent\.md$/.test(e.path ?? ""));
  const specEntries = tree.filter((e) => /^intent\/[^/]+\/spec\.md$/.test(e.path ?? ""));
  const incidentEntries = tree.filter((e) => /^incidents\/[^/]+\.md$/.test(e.path ?? "") && !isIgnoredDoc(e.path ?? ""));
  const exceptionEntries = tree.filter((e) => /^exceptions\/[^/]+\.md$/.test(e.path ?? "") && !isIgnoredDoc(e.path ?? ""));
  const personaEntries = tree.filter((e) => /^personas\/[^/]+\.md$/.test(e.path ?? "") && !isIgnoredDoc(e.path ?? ""));

  const [intentsRaw, specsRaw, incidentsRaw, exceptionsRaw, personasRaw] = await Promise.all([
    Promise.all(intentEntries.map(async (e) => ({ entry: e, fm: await readArtifact(ctx, repo, e, intentFrontmatter) }))),
    Promise.all(specEntries.map(async (e) => ({ entry: e, fm: await readArtifact(ctx, repo, e, specFrontmatter) }))),
    Promise.all(incidentEntries.map(async (e) => ({ entry: e, fm: await readArtifact(ctx, repo, e, incidentFrontmatter) }))),
    Promise.all(exceptionEntries.map(async (e) => ({ entry: e, fm: await readArtifact(ctx, repo, e, exceptionFrontmatter) }))),
    Promise.all(personaEntries.map(async (e) => ({ entry: e, fm: await readArtifact(ctx, repo, e, personaFrontmatter) }))),
  ]);

  const intents = new Map<string, Intent>();
  for (const { entry, fm } of intentsRaw) {
    if (!fm) continue;
    const dir = (entry.path ?? "").split("/")[1] ?? "";
    if (intents.has(fm.id)) {
      warn(ctx, `${repo}/${entry.path} skipped: duplicate intent id ${fm.id}`);
      continue;
    }
    intents.set(fm.id, {
      id: fm.id,
      title: fm.title,
      status: fm.status,
      author: fm.author,
      origin: fm.origin,
      product: fm.product,
      created: fm.created,
      dir,
      url: githubUrl(ctx, repo, `/tree/main/intent/${dir}`),
    });
  }
  for (const { entry, fm } of specsRaw) {
    if (!fm) continue;
    const dir = (entry.path ?? "").split("/")[1] ?? "";
    const intent = [...intents.values()].find((i) => i.dir === dir);
    if (!intent) {
      warn(ctx, `${repo}/${entry.path} skipped: no valid intent.md beside it`);
      continue;
    }
    if (intent.id !== fm.intent) {
      warn(ctx, `${repo}/${entry.path} skipped: intent "${fm.intent}" does not match the directory's intent ${intent.id}`);
      continue;
    }
    intent.spec = { status: fm.status, flagged: fm.flagged, url: githubUrl(ctx, repo, `/blob/main/${entry.path}`) };
  }

  const exceptions: Exception[] = [];
  for (const { entry, fm } of exceptionsRaw) {
    if (!fm) continue;
    const ex: Exception = {
      id: fm.id,
      status: fm.status,
      grants: fm.grants,
      repos: fm.repos,
      expires: fm.expires,
      authorizedBy: fm.authorizedBy,
      url: githubUrl(ctx, repo, `/blob/main/${entry.path}`),
    };
    if (fm.granted) ex.granted = fm.granted;
    exceptions.push(ex);
  }
  exceptions.sort((a, b) => a.id.localeCompare(b.id));

  const incidents: Incident[] = [];
  for (const { entry, fm } of incidentsRaw) {
    if (!fm) continue;
    const path = entry.path ?? "";
    incidents.push({
      path,
      url: githubUrl(ctx, repo, `/blob/main/${path}`),
      product: fm.product,
      severity: fm.severity,
      status: fm.status,
      intent: fm.intent,
      opened: fm.opened,
      triagedBy: fm.triagedBy,
      reason: fm.reason,
    });
  }
  incidents.sort((a, b) => a.path.localeCompare(b.path));

  const personas = personasRaw
    .map((p) => p.fm)
    .filter((p): p is { id: string; enabled: boolean } => p !== null)
    .map((p) => ({ id: p.id, enabled: p.enabled }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { intents, exceptions, incidents, personas };
}

/** Gate 1/2 evidence and Plan-stage intents from the platform's PRs. */
async function enrichIntents(ctx: Ctx, intents: Map<string, Intent>, prs: Pr[]): Promise<Intent[]> {
  const byMergedAsc = (a: Pr, b: Pr) => Date.parse(a.mergedAt ?? "") - Date.parse(b.mergedAt ?? "");
  const merged = prs.filter((p) => p.state === "merged" && p.sameRepo && p.intent).sort(byMergedAsc);
  const open = prs.filter((p) => p.state === "open" && p.sameRepo && p.intent).sort((a, b) => a.number - b.number);

  for (const pr of merged) {
    const intent = intents.get(pr.intent ?? "");
    if (!intent || !pr.mergedAt) continue;
    if (pr.class === "intent" && intent.acceptedAt === undefined) intent.acceptedAt = pr.mergedAt;
    if (pr.class === "spec" && intent.spec && intent.spec.acceptedAt === undefined) intent.spec.acceptedAt = pr.mergedAt;
  }

  for (const pr of open) {
    const id = pr.intent ?? "";
    const intent = intents.get(id);
    if (pr.class === "spec" && intent) {
      if (!intent.spec || intent.spec.status !== "accepted") {
        const spec: Spec = { status: "proposed", flagged: 0, url: pr.url, prNumber: pr.number, prOpenedAt: pr.createdAt };
        intent.spec = spec;
      }
    }
    if (pr.class === "intent" && !intent) {
      // Not on main yet: branch name and PR metadata only — never PR file content (R18).
      intents.set(id, {
        id,
        title: pr.title,
        status: "proposed",
        author: pr.author,
        origin: "idea",
        product: "",
        created: dateOnly(pr.createdAt),
        dir: pr.branch.slice("intent/".length),
        url: pr.url,
        prNumber: pr.number,
        prOpenedAt: pr.createdAt,
      });
    }
  }

  const finished = [...intents.values()].filter((i) => i.status === "done" || i.status === "parked" || i.status === "rejected");
  await Promise.all(
    finished.map(async (intent) => {
      const path = `intent/${intent.dir}/intent.md`;
      const commit = await soft(
        ctx,
        `${ctx.platform}/${path} history`,
        async () =>
          asArray<GhCommit>(
            await ctx.client.get(`/repos/${ctx.owner}/${ctx.platform}/commits?path=${encodeURIComponent(path)}&per_page=1`),
            "commits",
          )[0] ?? null,
        null,
      );
      if (!commit) return;
      const at = commit.commit?.committer?.date ?? commit.commit?.author?.date;
      if (at) intent.statusSetAt = at;
      const by = commit.author?.login ?? commit.commit?.author?.name;
      if (by) intent.statusSetBy = by;
    }),
  );

  return [...intents.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ---- repos --------------------------------------------------------------------

interface Prefetched {
  tree?: GhTreeEntry[];
  prs?: Pr[];
}

const BUILD_BRANCH = /^build\/(\d{4})-/;
const PLAN_FILE = /^plan\/(\d{4})-[^/]+\.md$/;

async function readPlans(ctx: Ctx, repo: string, tree: GhTreeEntry[]): Promise<Plan[]> {
  const entries = tree
    .filter((e) => PLAN_FILE.test(e.path ?? ""))
    .sort((a, b) => (a.path ?? "").localeCompare(b.path ?? ""));
  if (entries.length > PLAN_CAP) warn(ctx, `${repo}: ${entries.length} plan files; only the first ${PLAN_CAP} were read`);
  const plans = await Promise.all(
    entries.slice(0, PLAN_CAP).map(async (entry): Promise<Plan | null> => {
      const fm = await readArtifact(ctx, repo, entry, planFrontmatter);
      if (!fm) return null;
      const path = entry.path ?? "";
      const createdAt = await soft(ctx, `${repo}/${path} history`, () => firstCommitDate(ctx, repo, path), undefined);
      if (!createdAt) warn(ctx, `${repo}/${path}: first commit unknown; using the snapshot time`);
      return {
        path,
        url: githubUrl(ctx, repo, `/blob/main/${path}`),
        intent: fm.intent,
        status: fm.status,
        approvedBy: fm.approvedBy,
        createdAt: createdAt ?? ctx.nowIso,
        onMain: true,
      };
    }),
  );
  return plans.filter((p): p is Plan => p !== null);
}

async function readBuildBranches(ctx: Ctx, repo: string): Promise<RepoSnapshot["buildBranches"]> {
  const branches = asArray<GhBranch>(await ctx.client.get(`/repos/${ctx.owner}/${repo}/branches?per_page=100`), "branches");
  const build = branches
    .filter((b) => BUILD_BRANCH.test(b.name ?? ""))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  if (build.length > BRANCH_CAP) warn(ctx, `${repo}: ${build.length} build branches; only the first ${BRANCH_CAP} were read`);
  const out = await Promise.all(
    build.slice(0, BRANCH_CAP).map(async (b) => {
      const name = b.name ?? "";
      const commit = await soft(
        ctx,
        `${repo} branch ${name}`,
        async () =>
          asArray<GhCommit>(
            await ctx.client.get(`/repos/${ctx.owner}/${repo}/commits?sha=${encodeURIComponent(name)}&per_page=1`),
            "commits",
          )[0] ?? null,
        null,
      );
      const lastCommitAt = commit?.commit?.committer?.date ?? commit?.commit?.author?.date;
      if (!lastCommitAt) return null;
      const intent = BUILD_BRANCH.exec(name)?.[1];
      return intent ? { name, intent, lastCommitAt } : { name, lastCommitAt };
    }),
  );
  return out.filter((b): b is NonNullable<typeof b> => b !== null);
}

const RUN_STATUSES = new Set(["queued", "in_progress", "waiting", "completed"]);
const RUN_CONCLUSIONS = new Set(["success", "failure", "cancelled", "skipped", "timed_out", "action_required", "neutral"]);

async function readReleaseRuns(ctx: Ctx, repo: string): Promise<ReleaseRun[]> {
  let data: GhRuns;
  try {
    data = asObject<GhRuns>(
      await ctx.client.get(`/repos/${ctx.owner}/${repo}/actions/workflows/release.yml/runs?per_page=10`),
      "workflow runs",
    );
  } catch (err) {
    if (err instanceof CollectError && err.kind === "not-found") return [];
    throw err;
  }
  const runs: ReleaseRun[] = (data.workflow_runs ?? [])
    .filter((r) => typeof r.id === "number")
    .map((r) => {
      const rawStatus = r.status ?? "queued";
      const status = (RUN_STATUSES.has(rawStatus) ? rawStatus : "queued") as ReleaseRun["status"];
      const run: ReleaseRun = {
        id: r.id,
        url: r.html_url,
        sha: r.head_sha,
        status,
        pendingApproval: status === "waiting",
        createdAt: r.created_at,
      };
      const c = r.conclusion ?? "";
      if (RUN_CONCLUSIONS.has(c)) run.conclusion = c as NonNullable<ReleaseRun["conclusion"]>;
      else if (c === "stale" || c === "startup_failure") run.conclusion = "failure";
      return run;
    });

  const approved = runs.filter((r) => r.status === "completed" && r.conclusion === "success").slice(0, APPROVAL_RUNS);
  await Promise.all(
    approved.map(async (run) => {
      const approvals = await soft(
        ctx,
        `${repo} run ${run.id} approvals`,
        async () => asArray<GhApproval>(await ctx.client.get(`/repos/${ctx.owner}/${repo}/actions/runs/${run.id}/approvals`), "approvals"),
        [],
      );
      const first = approvals.find((a) => a.state === "approved") ?? approvals[0];
      if (!first) return;
      const login = first.user?.login;
      if (typeof login === "string" && login) run.approvedBy = login;
      const at = first.created_at ?? first.updated_at;
      if (typeof at === "string" && at) run.approvedAt = at;
    }),
  );
  return runs;
}

async function compareContains(ctx: Ctx, repo: string, base: string, head: string): Promise<boolean> {
  const cmp = asObject<GhCompare>(await ctx.client.get(`/repos/${ctx.owner}/${repo}/compare/${base}...${head}`), "compare");
  return cmp.status === "identical" || cmp.status === "behind";
}

async function markProduction(ctx: Ctx, repo: string, snap: RepoSnapshot): Promise<void> {
  const candidates = snap.prs
    .filter((p) => p.state === "merged" && p.sameRepo && p.class === "build" && p.mergeCommit)
    .sort((a, b) => Date.parse(b.mergedAt ?? "") - Date.parse(a.mergedAt ?? ""));
  const productionHead = snap.productionHead;
  const served = snap.production.version;
  for (const pr of candidates) {
    const sha = pr.mergeCommit ?? "";
    if (!productionHead) {
      pr.inProduction = false;
      pr.servedLive = false;
      continue;
    }
    if (ctx.budget.compares <= 0) {
      warn(ctx, `${repo}#${pr.number}: compare cap reached; production state unknown`);
      continue;
    }
    ctx.budget.compares -= 1;
    const inProd = await soft(ctx, `${repo}#${pr.number} compare`, () => compareContains(ctx, repo, "production", sha), undefined);
    if (inProd === undefined) continue;
    pr.inProduction = inProd;
    if (!isSha(served)) continue;
    if (served === productionHead) {
      pr.servedLive = inProd;
      continue;
    }
    if (ctx.budget.compares <= 0) {
      warn(ctx, `${repo}#${pr.number}: compare cap reached; served state unknown`);
      continue;
    }
    ctx.budget.compares -= 1;
    const live = await soft(ctx, `${repo}#${pr.number} served compare`, () => compareContains(ctx, repo, served, sha), undefined);
    if (live !== undefined) pr.servedLive = live;
  }
}

async function collectRepo(ctx: Ctx, ref: RepoRef, pre: Prefetched): Promise<RepoSnapshot> {
  const repo = ref.name;
  const base = `/repos/${ctx.owner}/${repo}`;
  const stagingUrl = `https://main--${ref.site}.netlify.app`;
  const productionUrl = `https://${ref.site}.netlify.app`;
  const snap: RepoSnapshot = {
    name: repo,
    kind: ref.kind,
    site: ref.site,
    url: githubUrl(ctx, repo),
    mainCi: "none",
    staging: { url: stagingUrl },
    production: { url: productionUrl },
    prs: [],
    plans: [],
    releaseRuns: [],
    buildBranches: [],
  };

  const sites = Promise.all([fetchSite(ctx, stagingUrl), fetchSite(ctx, productionUrl)]);

  try {
    await ctx.client.get(base);
  } catch (err) {
    if (isFatalError(err)) throw err;
    const e = err as CollectError;
    snap.error = e.kind === "not-found" ? "not found or the token cannot see it" : e.message;
    warn(ctx, `${repo}: ${snap.error}`);
    [snap.staging, snap.production] = await sites;
    for (const s of [snap.staging, snap.production]) if (s.error) warn(ctx, `site ${s.url}: ${s.error}`);
    return snap;
  }

  const [mainHead, productionHead] = await Promise.all([
    soft(ctx, `${repo} main`, () => branchHead(ctx, repo, "main"), undefined),
    soft(ctx, `${repo} production`, () => branchHead(ctx, repo, "production"), undefined),
  ]);
  if (mainHead) snap.mainHead = mainHead;
  if (productionHead) snap.productionHead = productionHead;

  const [mainCi, behind, tree, prs, branches, runs, siteStates] = await Promise.all([
    mainHead ? soft(ctx, `${repo} main checks`, () => checkRuns(ctx, repo, mainHead), { ci: "none" as CiStatus }) : { ci: "none" as CiStatus },
    mainHead && productionHead
      ? soft(
          ctx,
          `${repo} compare production...main`,
          async () => {
            const cmp = asObject<GhCompare>(await ctx.client.get(`${base}/compare/production...main`), "compare");
            const since = cmp.commits?.[0]?.commit?.committer?.date;
            const count = typeof cmp.ahead_by === "number" ? cmp.ahead_by : 0;
            return since ? { count, since } : { count };
          },
          undefined,
        )
      : undefined,
    pre.tree ? Promise.resolve(pre.tree) : soft(ctx, `${repo} tree`, () => getTree(ctx, repo), [] as GhTreeEntry[]),
    pre.prs ? Promise.resolve(pre.prs) : soft(ctx, `${repo} pulls`, async () => buildPrs(ctx, repo, await listPrs(ctx, repo)), [] as Pr[]),
    soft(ctx, `${repo} branches`, () => readBuildBranches(ctx, repo), [] as RepoSnapshot["buildBranches"]),
    soft(ctx, `${repo} release runs`, () => readReleaseRuns(ctx, repo), [] as ReleaseRun[]),
    sites,
  ]);

  snap.mainCi = mainCi.ci;
  if (behind) snap.productionBehindMain = behind;
  snap.prs = prs;
  snap.buildBranches = branches;
  snap.releaseRuns = runs;
  [snap.staging, snap.production] = siteStates;
  for (const s of [snap.staging, snap.production]) if (s.error) warn(ctx, `site ${s.url}: ${s.error}`);

  snap.plans = await readPlans(ctx, repo, tree);
  await markProduction(ctx, repo, snap);
  return snap;
}

// ---- entry --------------------------------------------------------------------

export async function collect(deps: CollectDeps): Promise<Snapshot> {
  const startedMs = Date.now();
  const platformRepo = deps.platformRepo ?? DEFAULT_PLATFORM_REPO;
  const parsed = parsePlatformRepo(platformRepo);
  if (!parsed) throw new ConfigError(`PLATFORM_REPO "${platformRepo}" must be owner/repo`);

  const nowIso = deps.now();
  const nowMs = Date.parse(nowIso);
  const siteTimeout: TimeoutOptions = { timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS };
  if (deps.deadline !== undefined) siteTimeout.deadline = deps.deadline;
  const ctx: Ctx = {
    client: deps.client,
    fetch: deps.fetch,
    owner: parsed.owner,
    platform: parsed.repo,
    nowIso,
    nowMs,
    sinceMs: nowMs - MERGED_WINDOW_DAYS * 86_400_000,
    warnings: [],
    budget: { mergedBy: MERGED_BY_CAP, compares: COMPARE_CAP },
    siteTimeout,
  };

  // Platform main: tree, config, artifacts. Unreadable tree/config is fatal.
  const tree = await getTree(ctx, ctx.platform);
  const configEntry = tree.find((e) => e.path === "flow.config.json");
  if (!configEntry?.sha) throw new ConfigError("flow.config.json not found on the platform's main");
  const configText = await getBlobText(ctx, ctx.platform, configEntry.sha);
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(configText);
  } catch {
    throw new ConfigError("flow.config.json is not valid JSON");
  }
  const { config, warnings: configWarnings } = validateConfig(rawConfig, { owner: ctx.owner, platformRepo: ctx.platform });
  ctx.warnings.push(...configWarnings);

  const [artifacts, platformPrs] = await Promise.all([
    readPlatformArtifacts(ctx, tree),
    soft(ctx, `${ctx.platform} pulls`, async () => buildPrs(ctx, ctx.platform, await listPrs(ctx, ctx.platform)), [] as Pr[]),
  ]);
  const intents = await enrichIntents(ctx, artifacts.intents, platformPrs);

  // Every configured repo, in parallel; the platform reuses its tree and PRs.
  const repos = await Promise.all(
    config.repos.map((ref) => collectRepo(ctx, ref, ref.name === ctx.platform ? { tree, prs: platformPrs } : {})),
  );

  const stats = ctx.client.stats();
  const snapshot: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    collectedAt: nowIso,
    config,
    platform: {
      intents,
      exceptions: artifacts.exceptions,
      incidents: artifacts.incidents,
      personas: artifacts.personas,
    },
    repos,
    stats: { calls: stats.calls, durationMs: Date.now() - startedMs },
    warnings: ctx.warnings,
  };
  if (stats.remaining !== undefined) snapshot.stats.rateLimitRemaining = stats.remaining;
  return snapshot;
}
