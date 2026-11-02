// A full canned platform + one product repo + one missing repo → the expected
// Snapshot. Also: a second run against the same ETag cache is mostly 304s.

import { collect } from "../../src/collector/collect.ts";
import { GithubClient } from "../../src/collector/github.ts";
import { SCHEMA_VERSION } from "../../src/engine/types.ts";
import type { Snapshot } from "../../src/engine/types.ts";
import { NOW } from "../helpers/build.ts";
import {
  FakeGithub,
  OWNER,
  PLATFORM,
  PRODUCT,
  addCheckRuns,
  addPrs,
  addRepo,
  addSite,
  addTree,
  b64,
  commitAt,
  compareBody,
  configJson,
  exceptionMd,
  fakeSha,
  ghPr,
  incidentMd,
  intentMd,
  personaMd,
  planMd,
  repoBase,
  specMd,
} from "../helpers/fakeGithub.ts";

const GH = `https://github.com/${OWNER}`;
const P = repoBase(PLATFORM);
const F = repoBase(PRODUCT);

function scenario(): FakeGithub {
  const fake = new FakeGithub();

  // ---- platform main
  addTree(fake, PLATFORM, {
    "flow.config.json": configJson({
      repos: [
        { name: PLATFORM, site: "fernhillplatform", kind: "platform" },
        { name: PRODUCT, site: PRODUCT, kind: "product" },
        { name: "fernhill-x", site: "fernhill-x", kind: "product" },
      ],
    }),
    "intent/README.md": "# intents\n",
    "intent/TEMPLATE.md": "---\nid: \"0000\"\n---\n",
    "intent/0001-flow-dashboard/intent.md": intentMd({ id: "0001", title: "Flow dashboard", product: PRODUCT }),
    "intent/0001-flow-dashboard/spec.md": specMd({ intent: "0001", status: "accepted", flagged: 0 }),
    "intent/0002-second/intent.md": intentMd({ id: "0002", title: "Second idea" }),
    "intent/0003-done-thing/intent.md": intentMd({ id: "0003", title: "Done thing", status: "done" }),
    "intent/0004-bad/intent.md": intentMd({ id: "0004", status: "wip" }),
    "exceptions/README.md": "# exceptions\n",
    "exceptions/EX-001-agent.md": exceptionMd({ id: "EX-001", granted: "2026-10-31", expires: "2026-11-30" }),
    "personas/README.md": "# personas\n",
    "personas/ux.md": personaMd({ id: "ux" }),
    "personas/compliance.md": personaMd({ id: "compliance", enabled: false }),
    "incidents/2026-11-04-blank-board.md": incidentMd({ product: PRODUCT, opened: "2026-11-04" }),
  });

  // ---- platform PRs
  const platformPrs = [
    ghPr(PLATFORM, { number: 1, branch: "intent/0001-flow-dashboard", state: "merged", mergedAt: "2026-10-31T12:00:00Z", createdAt: "2026-10-30T09:00:00Z" }),
    ghPr(PLATFORM, { number: 2, branch: "design/0001-flow-dashboard", state: "merged", mergedAt: "2026-11-01T12:00:00Z", createdAt: "2026-10-31T15:00:00Z" }),
    ghPr(PLATFORM, { number: 3, branch: "design/0002-second", createdAt: "2026-11-05T10:00:00Z" }),
    ghPr(PLATFORM, { number: 4, branch: "intent/0005-new-idea", title: "New idea", author: "originator", createdAt: "2026-11-08T10:00:00Z" }),
    ghPr(PLATFORM, { number: 5, branch: "docs-tweak", createdAt: "2026-11-09T10:00:00Z" }),
    ghPr(PLATFORM, { number: 6, branch: "intent/0006-fork", fork: true, createdAt: "2026-11-09T11:00:00Z" }),
    ghPr(PLATFORM, { number: 7, branch: "fix/typo", state: "closed" }),
    ghPr(PLATFORM, { number: 8, branch: "intent/0003-done-thing", state: "merged", mergedAt: "2026-10-20T12:00:00Z", createdAt: "2026-10-19T09:00:00Z" }),
    ghPr(PLATFORM, { number: 9, branch: "chore/old", state: "merged", mergedAt: "2026-07-01T12:00:00Z" }),
  ];
  addPrs(fake, PLATFORM, platformPrs);
  const head = (n: number) => fakeSha(`${PLATFORM}:head:${n}`);
  addCheckRuns(fake, PLATFORM, head(3), ["success"]);
  addCheckRuns(fake, PLATFORM, head(4), ["in_progress", "success"]);
  fake.json(`${P}/commits/${head(5)}/check-runs?per_page=50`, { total_count: 0, check_runs: [] });
  fake.json(`${P}/commits/${head(5)}/status`, { state: "pending", statuses: [] });
  fake.json(`${P}/pulls/5/files?per_page=100`, [{ filename: "docs/flow.md" }]);
  // The open design PR's head carries the live concern count; only `flagged` may come from it.
  fake.json(`${P}/contents/intent/0002-second/spec.md?ref=${head(3)}`, {
    content: b64(specMd({ intent: "0002", status: "accepted", flagged: 2 })),
    encoding: "base64",
  });
  fake.json(`${P}/commits?path=${encodeURIComponent("intent/0003-done-thing/intent.md")}&per_page=1`, [commitAt("2026-11-01T09:00:00Z", "nictuck")]);

  const platformMain = fakeSha(`${PLATFORM}:main`);
  addRepo(fake, PLATFORM, { noReleaseWorkflow: true });
  addSite(fake, "fernhillplatform", { staging: platformMain, production: platformMain });

  // ---- product repo
  const M = fakeSha(`${PRODUCT}:main`);
  const PROD = fakeSha(`${PRODUCT}:production`);
  addRepo(fake, PRODUCT, {
    mainSha: M,
    productionSha: PROD,
    aheadBy: 2,
    aheadSince: "2026-11-08T08:00:00Z",
    mainChecks: ["success", "neutral"],
    branches: ["build/0002-second"],
    runs: [
      { id: 500, sha: M, status: "waiting", createdAt: "2026-11-09T12:00:00Z" },
      { id: 400, sha: PROD, status: "completed", conclusion: "success", createdAt: "2026-11-05T13:00:00Z" },
    ],
  });
  fake.json(`${F}/actions/runs/400/approvals`, [
    { state: "approved", user: { login: "nictuck" }, comment: "", environments: [{ name: "production", created_at: "2026-11-05T14:00:00Z", updated_at: "2026-11-05T14:00:00Z" }] },
  ]);
  fake.json(`${F}/commits?sha=${encodeURIComponent("build/0002-second")}&per_page=1`, [commitAt("2026-11-06T10:00:00Z")]);
  addTree(fake, PRODUCT, {
    "plan/0001-flow-dashboard.md": planMd({ intent: "0001" }),
    "plan/README.md": "# plans\n",
    "README.md": "# flow\n",
  });
  fake.json(`${F}/commits?path=${encodeURIComponent("plan/0001-flow-dashboard.md")}&per_page=100`, [
    commitAt("2026-11-04T10:00:00Z"),
    commitAt("2026-11-02T08:00:00Z"),
  ]);
  const MC10 = fakeSha(`${PRODUCT}:merge:10`);
  const MC9 = fakeSha(`${PRODUCT}:merge:9`);
  addPrs(fake, PRODUCT, [
    // 0003 shipped long ago: #9 is its newest build PR (92 days before NOW, outside the
    // 90-day window) and must survive; #8 is an older one for the same intent and may go.
    ghPr(PRODUCT, { number: 8, branch: "build/0003-done-thing", state: "merged", mergedAt: "2026-07-20T12:00:00Z" }),
    ghPr(PRODUCT, { number: 9, branch: "build/0003-done-thing", state: "merged", mergedAt: "2026-08-10T12:00:00Z", mergeCommit: MC9 }),
    ghPr(PRODUCT, { number: 10, branch: "build/0001-flow-dashboard", state: "merged", mergedAt: "2026-11-05T12:00:00Z", mergeCommit: MC10, mergedBy: "codeowner" }),
    ghPr(PRODUCT, { number: 11, branch: "build/0001-flow-dashboard", createdAt: "2026-11-09T09:00:00Z", updatedAt: "2026-11-09T18:00:00Z" }),
    ghPr(PRODUCT, { number: 12, branch: "fix/thing", fork: true }),
    ghPr(PRODUCT, { number: 13, branch: "fix/ancient", state: "merged", mergedAt: "2026-08-01T12:00:00Z" }),
  ]);
  // Check-runs for #11 started at 09:30; GitHub's updated_at (18:00) moved on a comment.
  addCheckRuns(fake, PRODUCT, fakeSha(`${PRODUCT}:head:11`), ["success", "failure"], OWNER, "2026-11-09T09:30:00Z");
  fake.json(`${F}/compare/production...${MC10}`, compareBody("behind"));
  fake.json(`${F}/compare/production...${MC9}`, compareBody("behind"));
  addSite(fake, PRODUCT, { staging: M, production: PROD });

  // fernhill-x: nothing registered → 404 everywhere
  return fake;
}

async function run(fake: FakeGithub, etagCache = {}): Promise<{ snap: Snapshot; client: GithubClient }> {
  const client = new GithubClient({ token: "t", fetch: fake.fetch, etagCache });
  const snap = await collect({ client, fetch: fake.fetch, now: () => NOW });
  return { snap, client };
}

describe("collect: canned platform + product", () => {
  test("produces the expected Snapshot", async () => {
    const fake = scenario();
    const { snap, client } = await run(fake);

    expect(snap.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snap.collectedAt).toBe(NOW);
    expect(snap.config.repos.map((r) => r.name)).toEqual([PLATFORM, PRODUCT, "fernhill-x"]);
    expect(snap.config.thresholds["plan.pr_open_days"]).toBe(3);

    // intents
    expect(snap.platform.intents.map((i) => i.id)).toEqual(["0001", "0002", "0003", "0005"]);
    const [i1, i2, i3, i5] = snap.platform.intents;
    expect(i1).toMatchObject({
      title: "Flow dashboard",
      status: "accepted",
      product: PRODUCT,
      dir: "0001-flow-dashboard",
      url: `${GH}/${PLATFORM}/tree/main/intent/0001-flow-dashboard`,
      acceptedAt: "2026-10-31T12:00:00Z",
      spec: { status: "accepted", flagged: 0, url: `${GH}/${PLATFORM}/blob/main/intent/0001-flow-dashboard/spec.md`, acceptedAt: "2026-11-01T12:00:00Z" },
    });
    expect(i1?.prNumber).toBeUndefined();
    // flagged comes from the PR head; the head's `status: accepted` is ignored (R18).
    expect(i2?.spec).toEqual({ status: "proposed", flagged: 2, url: `${GH}/${PLATFORM}/pull/3`, prNumber: 3, prOpenedAt: "2026-11-05T10:00:00Z" });
    expect(i2?.acceptedAt).toBeUndefined();
    expect(i3).toMatchObject({ status: "done", acceptedAt: "2026-10-20T12:00:00Z", statusSetAt: "2026-11-01T09:00:00Z", statusSetBy: "nictuck" });
    expect(i5).toEqual({
      id: "0005",
      title: "New idea",
      status: "proposed",
      author: "originator",
      origin: "idea",
      product: "",
      created: "2026-11-08",
      dir: "0005-new-idea",
      url: `${GH}/${PLATFORM}/pull/4`,
      prNumber: 4,
      prOpenedAt: "2026-11-08T10:00:00Z",
    });
    expect(snap.warnings.some((w) => w.includes("intent/0004-bad/intent.md skipped"))).toBe(true);
    expect(snap.warnings.some((w) => w.includes("README"))).toBe(false);

    // other platform artifacts
    expect(snap.platform.exceptions).toEqual([
      {
        id: "EX-001",
        status: "active",
        grants: ["merge"],
        repos: [PLATFORM, PRODUCT],
        expires: "2026-11-30",
        authorizedBy: "Nicholas Tucker",
        url: `${GH}/${PLATFORM}/blob/main/exceptions/EX-001-agent.md`,
        granted: "2026-10-31",
      },
    ]);
    expect(snap.platform.personas).toEqual([
      { id: "compliance", enabled: false },
      { id: "ux", enabled: true },
    ]);
    expect(snap.platform.incidents).toEqual([
      {
        path: "incidents/2026-11-04-blank-board.md",
        url: `${GH}/${PLATFORM}/blob/main/incidents/2026-11-04-blank-board.md`,
        product: PRODUCT,
        severity: "sev2",
        status: "open",
        intent: "",
        opened: "2026-11-04",
        triagedBy: "",
        reason: "",
      },
    ]);

    // platform repo (Systems) reuses the PR list
    const platformRepo = snap.repos[0];
    expect(platformRepo?.name).toBe(PLATFORM);
    expect(platformRepo?.prs.map((p) => p.number)).toEqual([8, 6, 5, 4, 3, 2, 1]);
    const byNumber = (n: number) => platformRepo?.prs.find((p) => p.number === n);
    expect(byNumber(1)).toMatchObject({ class: "intent", intent: "0001", state: "merged", mergedBy: "nictuck", mergedAt: "2026-10-31T12:00:00Z" });
    expect(byNumber(3)).toMatchObject({ class: "spec", ci: "green" });
    expect(byNumber(4)).toMatchObject({ class: "intent", ci: "running" });
    expect(byNumber(5)).toMatchObject({ class: "docs", ci: "none", sameRepo: true });
    expect(byNumber(6)).toMatchObject({ class: "intent", sameRepo: false, ci: "none" });
    expect(fake.count((k) => k === `${P}/pulls/6/files?per_page=100`)).toBe(0);
    expect(fake.count((k) => k.includes(fakeSha(`${PLATFORM}:head:6`)))).toBe(0);
    expect(platformRepo?.releaseRuns).toEqual([]);
    expect(platformRepo?.productionBehindMain).toEqual({ count: 0 });
    expect(platformRepo?.staging.version).toBe(fakeSha(`${PLATFORM}:main`));

    // product repo
    const product = snap.repos[1];
    const M = fakeSha(`${PRODUCT}:main`);
    const PROD = fakeSha(`${PRODUCT}:production`);
    expect(product).toMatchObject({
      name: PRODUCT,
      kind: "product",
      site: PRODUCT,
      url: `${GH}/${PRODUCT}`,
      mainHead: M,
      productionHead: PROD,
      mainCi: "green",
      productionBehindMain: { count: 2, since: "2026-11-08T08:00:00Z" },
      staging: { url: `https://main--${PRODUCT}.netlify.app`, version: M },
      production: { url: `https://${PRODUCT}.netlify.app`, version: PROD },
    });
    expect(product?.plans).toEqual([
      {
        path: "plan/0001-flow-dashboard.md",
        url: `${GH}/${PRODUCT}/blob/main/plan/0001-flow-dashboard.md`,
        intent: "0001",
        status: "approved",
        approvedBy: "Nicholas Tucker",
        createdAt: "2026-11-02T08:00:00Z",
        onMain: true,
      },
    ]);
    // #8 (superseded old build) and #13 (old fix) fall out of the window; #9 survives as 0003's newest build PR.
    expect(product?.prs.map((p) => p.number)).toEqual([12, 11, 10, 9]);
    expect(product?.prs[0]).toMatchObject({ class: "fix", sameRepo: false, ci: "none" });
    expect(product?.prs[1]).toMatchObject({
      class: "build",
      intent: "0001",
      state: "open",
      ci: "red",
      ciUrl: `${GH}/${PRODUCT}/runs/1001`,
      // first check start, not GitHub's comment-bumped updated_at
      updatedAt: "2026-11-09T09:30:00Z",
    });
    expect(product?.prs[2]).toMatchObject({
      class: "build",
      state: "merged",
      mergedBy: "codeowner",
      mergeCommit: fakeSha(`${PRODUCT}:merge:10`),
      inProduction: true,
      servedLive: true,
    });
    expect(product?.prs[3]).toMatchObject({
      number: 9,
      class: "build",
      intent: "0003",
      state: "merged",
      mergedAt: "2026-08-10T12:00:00Z",
      mergeCommit: fakeSha(`${PRODUCT}:merge:9`),
      inProduction: true,
      servedLive: true,
    });
    expect(product?.releaseRuns).toEqual([
      { id: 500, url: `${GH}/${PRODUCT}/actions/runs/500`, sha: M, status: "waiting", pendingApproval: true, createdAt: "2026-11-09T12:00:00Z" },
      {
        id: 400,
        url: `${GH}/${PRODUCT}/actions/runs/400`,
        sha: PROD,
        status: "completed",
        conclusion: "success",
        pendingApproval: false,
        createdAt: "2026-11-05T13:00:00Z",
        approvedBy: "nictuck",
        approvedAt: "2026-11-05T14:00:00Z",
      },
    ]);
    expect(product?.buildBranches).toEqual([{ name: "build/0002-second", intent: "0002", lastCommitAt: "2026-11-06T10:00:00Z" }]);
    expect(product?.error).toBeUndefined();

    // missing repo
    const missing = snap.repos[2];
    expect(missing).toMatchObject({ name: "fernhill-x", error: "not found or the token cannot see it", prs: [], plans: [] });
    expect(missing?.staging.error).toBe("HTTP 404");
    expect(snap.warnings).toContain("fernhill-x: not found or the token cannot see it");

    // budget and hygiene
    expect(snap.stats.calls).toBe(client.stats().calls);
    expect(snap.stats.calls).toBe(fake.count((k) => k.startsWith("/")));
    expect(snap.stats.rateLimitRemaining).toBeTypeOf("number");
    // Only the deliberate misses: the absent repo and the platform's absent release workflow.
    expect(fake.misses.filter((k) => !k.includes("fernhill-x") && !k.includes("release.yml"))).toEqual([]);
    expect(JSON.stringify(snap)).not.toContain("@");
  });

  test("a second run against the same ETag cache is served mostly from 304s and matches", async () => {
    const fake = scenario();
    const cache = {};
    const first = await run(fake, cache);
    const second = await run(fake, cache);
    expect(second.client.stats().cached).toBeGreaterThan(0);
    expect(second.client.stats().calls).toBe(first.client.stats().calls);
    const strip = (s: Snapshot) => ({ ...s, stats: { ...s.stats, durationMs: 0, rateLimitRemaining: 0 } });
    expect(strip(second.snap)).toEqual(strip(first.snap));
  });

  test("fatal: an unreadable platform tree or config ends the refresh", async () => {
    const fake = new FakeGithub();
    await expect(run(fake)).rejects.toMatchObject({ kind: "not-found" });

    const noConfig = new FakeGithub();
    addTree(noConfig, PLATFORM, { "README.md": "# x\n" });
    await expect(run(noConfig)).rejects.toThrow(/flow.config.json not found/);

    const badJson = new FakeGithub();
    addTree(badJson, PLATFORM, { "flow.config.json": "{ not json" });
    await expect(run(badJson)).rejects.toThrow(/not valid JSON/);
  });

  test("fatal: token, rate limit and cap propagate even from a repo step", async () => {
    const fake = scenario();
    fake.json(`${F}/branches?per_page=100`, { message: "Bad credentials" }, { status: 401 });
    await expect(run(fake)).rejects.toMatchObject({ kind: "token" });

    const capped = scenario();
    const client = new GithubClient({ token: "t", fetch: capped.fetch, callCap: 5 });
    await expect(collect({ client, fetch: capped.fetch, now: () => NOW })).rejects.toMatchObject({ kind: "cap" });
  });

  test("non-fatal: one repo 5xx and one site down become warnings", async () => {
    const fake = scenario();
    fake.json(F, { message: "boom" }, { status: 502 });
    fake.route(`https://${PRODUCT}.netlify.app/version.txt`, { status: 503, text: "down" });
    const { snap } = await run(fake);
    expect(snap.repos[1]?.error).toMatch(/502/);
    expect(snap.repos[1]?.production.error).toBe("HTTP 503");
    expect(snap.platform.intents.length).toBe(4);
  });
});
