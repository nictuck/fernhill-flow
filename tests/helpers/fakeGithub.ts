// A `fetch` stub routed by URL with canned JSON, 304 support, delay and size
// knobs, plus builders for the GitHub shapes the collector reads. Keys are
// `pathname+search` for api.github.com and the full URL for anything else.

import type { GithubClient } from "../../src/collector/github.ts";

export interface FakeRoute {
  status?: number;
  json?: unknown;
  text?: string;
  /** body of this many bytes (size-cap tests) */
  bytes?: number;
  headers?: Record<string, string>;
  /** when set, a matching If-None-Match gets a 304 */
  etag?: string;
  delayMs?: number;
  /** never respond; reject when the signal aborts (timeout tests) */
  hang?: boolean;
}

export interface FakeCall {
  key: string;
  method: string;
  ifNoneMatch: string | null;
  status: number;
}

function sleep(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted", "AbortError"));
    });
  });
}

function hang(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(new DOMException("The operation was aborted", "AbortError"));
    signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
  });
}

export class FakeGithub {
  readonly calls: FakeCall[] = [];
  readonly misses: string[] = [];
  /** x-ratelimit-remaining reported on api.github.com responses; decremented per non-304 call */
  remaining = 4990;
  readonly fetch: typeof fetch;
  private readonly routes = new Map<string, FakeRoute>();

  constructor() {
    this.fetch = ((input: RequestInfo | URL, init?: RequestInit) => this.handle(input, init)) as typeof fetch;
  }

  static key(url: string): string {
    const u = new URL(url);
    return u.host === "api.github.com" ? `${u.pathname}${u.search}` : url;
  }

  route(key: string, route: FakeRoute): this {
    this.routes.set(key, route);
    return this;
  }

  json(key: string, body: unknown, extra: Omit<FakeRoute, "json"> = {}): this {
    return this.route(key, { ...extra, json: body });
  }

  text(key: string, body: string, extra: Omit<FakeRoute, "text"> = {}): this {
    return this.route(key, { ...extra, text: body });
  }

  has(key: string): boolean {
    return this.routes.has(key);
  }

  count(predicate: (key: string) => boolean = () => true): number {
    return this.calls.filter((c) => predicate(c.key)).length;
  }

  private async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = FakeGithub.key(url);
    const method = init?.method ?? "GET";
    const reqHeaders = new Headers(init?.headers);
    const ifNoneMatch = reqHeaders.get("if-none-match");
    const signal = init?.signal;
    const isApi = new URL(url).host === "api.github.com";
    const route = this.routes.get(key) ?? this.routes.get(url);

    const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
    if (isApi) {
      headers.set("x-ratelimit-limit", "5000");
      headers.set("x-ratelimit-remaining", String(this.remaining));
      headers.set("x-ratelimit-reset", String(Math.floor(Date.now() / 1000) + 3600));
    }

    if (!route) {
      this.misses.push(key);
      this.calls.push({ key, method, ifNoneMatch, status: 404 });
      if (isApi) this.remaining -= 1;
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404, headers });
    }

    if (route.hang) await hang(signal);
    if (route.delayMs) await sleep(route.delayMs, signal);

    for (const [k, v] of Object.entries(route.headers ?? {})) headers.set(k, v);
    if (route.etag) headers.set("etag", route.etag);

    if (route.etag && ifNoneMatch === route.etag) {
      this.calls.push({ key, method, ifNoneMatch, status: 304 });
      return new Response(null, { status: 304, headers });
    }

    const status = route.status ?? 200;
    this.calls.push({ key, method, ifNoneMatch, status });
    if (isApi) this.remaining -= 1;
    let body: string;
    if (route.text !== undefined) body = route.text;
    else if (route.bytes !== undefined) body = "x".repeat(route.bytes);
    else if (route.json !== undefined) body = JSON.stringify(route.json);
    else body = "";
    if (route.text !== undefined && !route.headers?.["content-type"]) headers.set("content-type", "text/plain");
    return new Response(body, { status, headers });
  }
}

// ---- builders -----------------------------------------------------------------

/** Deterministic 40-hex sha from a seed. */
export function fakeSha(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i += 1) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i), 0x811c9dc5) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 5; i += 1) {
    h1 = Math.imul(h1 ^ (h1 >>> 15), 0x2c1b3c6d) >>> 0;
    h2 = Math.imul(h2 ^ (h2 >>> 13), 0x297a2d39) >>> 0;
    out += ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, 40);
}

export function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export const OWNER = "nictuck";
export const PLATFORM = "fernhill-platform";
export const PRODUCT = "fernhill-flow";

export function repoBase(repo: string, owner = OWNER): string {
  return `/repos/${owner}/${repo}`;
}

/** Register a `main` tree and one blob per file. Returns path → sha. */
export function addTree(
  fake: FakeGithub,
  repo: string,
  files: Record<string, string>,
  opts: { truncated?: boolean; owner?: string } = {},
): Record<string, string> {
  const owner = opts.owner ?? OWNER;
  const shas: Record<string, string> = {};
  const tree = Object.entries(files).map(([path, text]) => {
    const sha = fakeSha(`${repo}:${path}:${text}`);
    shas[path] = sha;
    fake.json(`${repoBase(repo, owner)}/git/blobs/${sha}`, { sha, content: b64(text), encoding: "base64", size: text.length }, { etag: `"b-${sha}"` });
    return { path, type: "blob", sha, mode: "100644", size: text.length };
  });
  fake.json(
    `${repoBase(repo, owner)}/git/trees/main?recursive=1`,
    { sha: fakeSha(`${repo}:tree`), tree, truncated: opts.truncated ?? false },
    { etag: `"t-${repo}"` },
  );
  return shas;
}

export interface PrOpts {
  number: number;
  branch: string;
  state?: "open" | "merged" | "closed";
  title?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string;
  headSha?: string;
  mergeCommit?: string;
  /** head repo differs from base (fork) */
  fork?: boolean;
  mergedBy?: string;
}

export function ghPr(repo: string, o: PrOpts, owner = OWNER): Record<string, unknown> {
  const state = o.state ?? "open";
  const createdAt = o.createdAt ?? "2026-11-01T10:00:00Z";
  const mergedAt = state === "merged" ? (o.mergedAt ?? "2026-11-02T10:00:00Z") : null;
  return {
    number: o.number,
    html_url: `https://github.com/${owner}/${repo}/pull/${o.number}`,
    title: o.title ?? `PR ${o.number}`,
    state: state === "open" ? "open" : "closed",
    draft: false,
    user: { login: o.author ?? "nictuck" },
    head: {
      ref: o.branch,
      sha: o.headSha ?? fakeSha(`${repo}:head:${o.number}`),
      repo: o.fork ? { full_name: `someone-else/${repo}` } : { full_name: `${owner}/${repo}` },
    },
    base: { ref: "main", repo: { full_name: `${owner}/${repo}` } },
    created_at: createdAt,
    updated_at: o.updatedAt ?? createdAt,
    merged_at: mergedAt,
    merge_commit_sha: state === "merged" ? (o.mergeCommit ?? fakeSha(`${repo}:merge:${o.number}`)) : null,
    merged_by: state === "merged" ? { login: o.mergedBy ?? "nictuck" } : null,
  };
}

/** Register the PR list and a detail route per PR. */
export function addPrs(fake: FakeGithub, repo: string, prs: Record<string, unknown>[], owner = OWNER): void {
  fake.json(`${repoBase(repo, owner)}/pulls?state=all&sort=updated&direction=desc&per_page=100`, prs, { etag: `"p-${repo}"` });
  for (const pr of prs) fake.json(`${repoBase(repo, owner)}/pulls/${String(pr["number"])}`, pr);
}

export type CheckSpec = "success" | "failure" | "in_progress" | "queued" | "cancelled" | "timed_out" | "neutral" | "skipped";

export function checkRuns(specs: CheckSpec[], repo = PRODUCT, startedAt?: string): Record<string, unknown> {
  const check_runs = specs.map((s, i) => {
    const running = s === "in_progress" || s === "queued";
    return {
      id: 1000 + i,
      name: `check-${i}`,
      status: running ? s : "completed",
      conclusion: running ? null : s,
      // later checks start a little later; the collector takes the earliest
      started_at: startedAt ? (i === 0 ? startedAt : new Date(Date.parse(startedAt) + i * 60_000).toISOString()) : null,
      html_url: `https://github.com/${OWNER}/${repo}/runs/${1000 + i}`,
      details_url: `https://github.com/${OWNER}/${repo}/runs/${1000 + i}`,
    };
  });
  return { total_count: check_runs.length, check_runs };
}

export function addCheckRuns(fake: FakeGithub, repo: string, sha: string, specs: CheckSpec[], owner = OWNER, startedAt?: string): void {
  fake.json(`${repoBase(repo, owner)}/commits/${sha}/check-runs?per_page=50`, checkRuns(specs, repo, startedAt));
}

export function commitAt(date: string, login: string | null = "nictuck", name = "Nicholas Tucker"): Record<string, unknown> {
  return {
    sha: fakeSha(`commit:${date}:${login ?? name}`),
    commit: { committer: { date, name }, author: { date, name }, message: "x" },
    author: login ? { login } : null,
  };
}

export function compareBody(status: "identical" | "behind" | "ahead" | "diverged", aheadBy = 0, since?: string): Record<string, unknown> {
  return {
    status,
    ahead_by: aheadBy,
    behind_by: 0,
    commits: since ? [commitAt(since)] : [],
  };
}

export interface RunOpts {
  id: number;
  sha: string;
  status: "queued" | "in_progress" | "waiting" | "completed";
  conclusion?: string | null;
  createdAt?: string;
}

export function releaseRuns(repo: string, runs: RunOpts[], owner = OWNER): Record<string, unknown> {
  return {
    total_count: runs.length,
    workflow_runs: runs.map((r) => ({
      id: r.id,
      html_url: `https://github.com/${owner}/${repo}/actions/runs/${r.id}`,
      head_sha: r.sha,
      status: r.status,
      conclusion: r.conclusion ?? null,
      created_at: r.createdAt ?? "2026-11-03T10:00:00Z",
      updated_at: r.createdAt ?? "2026-11-03T10:00:00Z",
    })),
  };
}

export interface RepoOpts {
  owner?: string;
  mainSha?: string;
  productionSha?: string | null;
  /** compare production...main */
  aheadBy?: number;
  aheadSince?: string;
  mainChecks?: CheckSpec[];
  branches?: string[];
  runs?: RunOpts[];
  /** omit the release.yml runs route (404) */
  noReleaseWorkflow?: boolean;
}

/** Register repo meta, heads, main CI, compare, branch list and release runs. */
export function addRepo(fake: FakeGithub, repo: string, o: RepoOpts = {}): { mainSha: string; productionSha: string | undefined } {
  const owner = o.owner ?? OWNER;
  const base = repoBase(repo, owner);
  const mainSha = o.mainSha ?? fakeSha(`${repo}:main`);
  const productionSha = o.productionSha === null ? undefined : (o.productionSha ?? mainSha);
  fake.json(base, { name: repo, full_name: `${owner}/${repo}`, html_url: `https://github.com/${owner}/${repo}`, default_branch: "main" }, { etag: `"r-${repo}"` });
  fake.json(`${base}/branches/main`, { name: "main", commit: { sha: mainSha } });
  if (productionSha) fake.json(`${base}/branches/production`, { name: "production", commit: { sha: productionSha } });
  addCheckRuns(fake, repo, mainSha, o.mainChecks ?? ["success"], owner);
  if (productionSha) {
    const ahead = o.aheadBy ?? (productionSha === mainSha ? 0 : 1);
    fake.json(`${base}/compare/production...main`, compareBody(ahead === 0 ? "identical" : "ahead", ahead, o.aheadSince));
  }
  const branchNames = ["main", ...(productionSha ? ["production"] : []), ...(o.branches ?? [])];
  fake.json(
    `${base}/branches?per_page=100`,
    branchNames.map((name) => ({ name, commit: { sha: name === "main" ? mainSha : name === "production" ? productionSha : fakeSha(`${repo}:${name}`) } })),
  );
  if (!o.noReleaseWorkflow) fake.json(`${base}/actions/workflows/release.yml/runs?per_page=10`, releaseRuns(repo, o.runs ?? [], owner));
  return { mainSha, productionSha };
}

export function addSite(fake: FakeGithub, site: string, bodies: { staging?: string | FakeRoute; production?: string | FakeRoute }): void {
  const put = (url: string, body: string | FakeRoute | undefined) => {
    if (body === undefined) return;
    if (typeof body === "string") fake.text(url, body);
    else fake.route(url, body);
  };
  put(`https://main--${site}.netlify.app/version.txt`, bodies.staging);
  put(`https://${site}.netlify.app/version.txt`, bodies.production);
}

// ---- artifact text ------------------------------------------------------------

function fm(lines: string[], body = "\n## Body\n\nText.\n"): string {
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

export function intentMd(o: { id: string; title?: string; status?: string; author?: string; product?: string; created?: string }): string {
  return fm([
    `id: "${o.id}"`,
    `title: ${o.title ?? `Intent ${o.id}`}`,
    `status: ${o.status ?? "accepted"}`,
    `author: ${o.author ?? "Nicholas Tucker"}`,
    "origin: idea",
    `product: "${o.product ?? ""}"`,
    `created: ${o.created ?? "2026-10-31"}`,
  ]);
}

export function specMd(o: { intent: string; status?: string; flagged?: number | string }): string {
  return fm([`intent: "${o.intent}"`, `status: ${o.status ?? "accepted"}`, "personas: [tech-lead, ux]", `flagged: ${o.flagged ?? 0}`]);
}

export function planMd(o: { intent: string; status?: string; approvedBy?: string }): string {
  return fm([`intent: "${o.intent}"`, `status: ${o.status ?? "approved"}`, `approved_by: "${o.approvedBy ?? "Nicholas Tucker"}"`]);
}

export function incidentMd(o: { product: string; status?: string; severity?: string; intent?: string; opened?: string; reason?: string }): string {
  return fm([
    `product: ${o.product}`,
    `severity: ${o.severity ?? "sev2"}`,
    `status: ${o.status ?? "open"}`,
    `intent: "${o.intent ?? ""}"`,
    `opened: ${o.opened ?? "2026-11-04"}`,
    'triaged_by: ""',
    `reason: "${o.reason ?? ""}"`,
  ]);
}

export function exceptionMd(o: { id: string; status?: string; grants?: string[]; repos?: string[]; expires?: string; granted?: string }): string {
  return fm([
    `id: ${o.id}`,
    "title: Agent merges during build",
    `status: ${o.status ?? "active"}`,
    `grants: [${(o.grants ?? ["merge"]).join(", ")}]`,
    `repos: [${(o.repos ?? [PLATFORM, PRODUCT]).join(", ")}]`,
    "authorized_by: Nicholas Tucker",
    "role: product owner, code owner",
    `granted: ${o.granted ?? "2026-10-31"}`,
    `expires: ${o.expires ?? "2026-11-30"}`,
  ]);
}

export function personaMd(o: { id: string; enabled?: boolean }): string {
  return fm([`id: ${o.id}`, `name: ${o.id}`, `enabled: ${o.enabled ?? true}`, "gates: [design]", "owner: Nicholas Tucker"]);
}

export function configJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    company: "Fernhill Software",
    github_owner: OWNER,
    platform_repo: PLATFORM,
    repos: [
      { name: PLATFORM, site: "fernhillplatform", kind: "platform" },
      { name: PRODUCT, site: PRODUCT, kind: "product" },
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
  });
}

/** Paths of every GitHub call the client made, for budget assertions. */
export function callPaths(client: GithubClient): string[] {
  return client.stats().log.map((l) => l.path);
}
