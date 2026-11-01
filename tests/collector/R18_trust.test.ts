// R18: `main` is trusted, PR content is display-only, every untrusted input
// is schema-checked and a bad file is skipped (warning), never fatal.

import { collect } from "../../src/collector/collect.ts";
import { GithubClient } from "../../src/collector/github.ts";
import { intentFrontmatter, parseFrontmatter, specFrontmatter } from "../../src/collector/frontmatter.ts";
import { ConfigError, parseVersion, validateConfig } from "../../src/collector/validate.ts";
import { NOW } from "../helpers/build.ts";
import {
  FakeGithub,
  PLATFORM,
  PRODUCT,
  addPrs,
  addRepo,
  addSite,
  addTree,
  configJson,
  fakeSha,
  ghPr,
  intentMd,
  repoBase,
} from "../helpers/fakeGithub.ts";

function run(fake: FakeGithub) {
  const client = new GithubClient({ token: "t", fetch: fake.fetch });
  return collect({ client, fetch: fake.fetch, now: () => NOW });
}

/** A platform with one good intent plus whatever `files` adds. */
function platform(fake: FakeGithub, files: Record<string, string> = {}, config: Record<string, unknown> = {}) {
  addTree(fake, PLATFORM, {
    "flow.config.json": configJson({ repos: [{ name: PLATFORM, site: "fernhillplatform", kind: "platform" }], ...config }),
    "intent/0001-flow-dashboard/intent.md": intentMd({ id: "0001" }),
    ...files,
  });
  addRepo(fake, PLATFORM, { noReleaseWorkflow: true });
  addSite(fake, "fernhillplatform", { staging: fakeSha(`${PLATFORM}:main`), production: fakeSha(`${PLATFORM}:main`) });
}

describe("R18 frontmatter is parsed safely and validated", () => {
  test("only the first block, core schema, mapping required", () => {
    expect(parseFrontmatter('---\nid: "0001"\ntitle: X\n---\nbody\n---\nid: "0002"\n---\n')).toEqual({ id: "0001", title: "X" });
    expect(() => parseFrontmatter("no frontmatter here")).toThrow(/no frontmatter/);
    expect(() => parseFrontmatter("---\nid: 1\n")).toThrow(/unterminated/);
    expect(() => parseFrontmatter("---\n- a\n- b\n---\n")).toThrow(/not a mapping/);
    expect(() => parseFrontmatter("---\nid: !!js/function 'function(){}'\n---\n")).toThrow();
    expect(() => parseFrontmatter("---\nid: [\n---\n")).toThrow();
  });

  test("a file over 64 KiB is refused", () => {
    const big = `---\nid: "0001"\n---\n${"x".repeat(65 * 1024)}`;
    expect(() => parseFrontmatter(big)).toThrow(/cap/);
  });

  test("aliases are capped (no billion laughs)", () => {
    const bomb = ["a: &a [x, x, x, x, x, x, x, x, x, x]", "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]", "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]", "d: [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]"].join("\n");
    expect(() => parseFrontmatter(`---\n${bomb}\n---\n`)).toThrow();
  });

  test("unknown status, unquoted id, bad flagged, missing keys → null with a reason", () => {
    expect(intentFrontmatter({ id: "0001", title: "T", status: "wip", author: "", origin: "", product: "", created: "2026-10-31" }).reason).toMatch(/status must be one of/);
    expect(intentFrontmatter({ id: 1, title: "T", status: "accepted", author: "", origin: "", product: "", created: "2026-10-31" }).reason).toMatch(/quote it/);
    expect(intentFrontmatter({ id: "0001", status: "accepted" }).reason).toMatch(/missing title/);
    expect(intentFrontmatter({ id: "0001", title: "T", status: "accepted", author: "", origin: "", product: "Bad Repo!", created: "2026-10-31" }).reason).toMatch(/product/);
    expect(specFrontmatter({ intent: "0001", status: "accepted", flagged: 1.5 }).reason).toMatch(/flagged/);
    expect(specFrontmatter({ intent: "0001", status: "accepted", flagged: -1 }).reason).toMatch(/flagged/);
    expect(specFrontmatter({ intent: "0001", status: "accepted", flagged: "2" }).reason).toMatch(/flagged/);
    expect(specFrontmatter({ intent: "0001", status: "draft", flagged: 0 }).reason).toMatch(/status/);
  });

  test("strings are stripped of control characters and capped", () => {
    const v = intentFrontmatter({
      id: "0001",
      title: `A\u0007B${"x".repeat(500)}`,
      status: "accepted",
      author: "N\u001bT",
      origin: "idea",
      product: "",
      created: "2026-10-31",
    }).value;
    expect(v?.title.startsWith("AB")).toBe(true);
    expect(v?.title.length).toBe(200);
    expect(v?.author).toBe("NT");
  });

  test("malformed frontmatter is skipped with a warning, not fatal; unknown status likewise", async () => {
    const fake = new FakeGithub();
    platform(fake, {
      "intent/0002-broken/intent.md": "---\nid: [unterminated\n---\n",
      "intent/0003-wip/intent.md": intentMd({ id: "0003", status: "wip" }),
      "intent/0004-nofm/intent.md": "# Just a heading\n",
      "intent/0005-good/intent.md": intentMd({ id: "0005", status: "parked" }),
    });
    fake.json(`${repoBase(PLATFORM)}/commits?path=${encodeURIComponent("intent/0005-good/intent.md")}&per_page=1`, []);
    const snap = await run(fake);
    expect(snap.platform.intents.map((i) => i.id)).toEqual(["0001", "0005"]);
    expect(snap.warnings.some((w) => w.includes("0002-broken/intent.md skipped"))).toBe(true);
    expect(snap.warnings.some((w) => w.includes("0003-wip/intent.md skipped") && w.includes("status must be one of"))).toBe(true);
    expect(snap.warnings.some((w) => w.includes("0004-nofm/intent.md skipped"))).toBe(true);
  });
});

describe("R18 fork PRs are shown, never trusted", () => {
  test("sameRepo: false, no files or check-runs call, no intent or spec from it", async () => {
    const fake = new FakeGithub();
    platform(fake);
    addPrs(fake, PLATFORM, [
      ghPr(PLATFORM, { number: 7, branch: "intent/0009-evil", fork: true, title: "Evil intent" }),
      ghPr(PLATFORM, { number: 8, branch: "design/0001-flow-dashboard", fork: true }),
      ghPr(PLATFORM, { number: 9, branch: "something-else", fork: true }),
    ]);
    const snap = await run(fake);
    const prs = snap.repos[0]?.prs ?? [];
    expect(prs.map((p) => p.number)).toEqual([9, 8, 7]);
    expect(prs.every((p) => p.sameRepo === false && p.ci === "none")).toBe(true);
    expect(prs.find((p) => p.number === 9)?.class).toBe("docs");
    expect(fake.count((k) => k.includes("/files"))).toBe(0);
    const mainSha = fakeSha(`${PLATFORM}:main`);
    expect(fake.count((k) => k.includes("/check-runs") && !k.includes(mainSha))).toBe(0);
    expect(snap.platform.intents.map((i) => i.id)).toEqual(["0001"]);
    expect(snap.platform.intents[0]?.spec).toBeUndefined();
  });
});

describe("R18 config comes from main only", () => {
  test("a crafted PR adding a repo and a site changes nothing", async () => {
    const fake = new FakeGithub();
    platform(fake);
    const evilPr = ghPr(PLATFORM, { number: 42, branch: "add-evil-repo", title: "Add fernhill-evil" });
    addPrs(fake, PLATFORM, [evilPr]);
    fake.json(`${repoBase(PLATFORM)}/pulls/42/files?per_page=100`, [{ filename: "flow.config.json", status: "modified" }]);
    fake.json(`${repoBase(PLATFORM)}/commits/${String((evilPr["head"] as { sha: string }).sha)}/check-runs?per_page=50`, { total_count: 0, check_runs: [] });
    fake.json(`${repoBase(PLATFORM)}/commits/${String((evilPr["head"] as { sha: string }).sha)}/status`, { state: "pending", statuses: [] });
    // The crafted content, were it ever read, would point here:
    fake.json(repoBase("fernhill-evil"), { name: "fernhill-evil" });
    fake.text("https://evil.netlify.app/version.txt", fakeSha("evil"));

    const snap = await run(fake);
    expect(snap.config.repos.map((r) => r.name)).toEqual([PLATFORM]);
    expect(snap.repos.map((r) => r.name)).toEqual([PLATFORM]);
    expect(fake.count((k) => k.includes("fernhill-evil") || k.includes("evil.netlify.app"))).toBe(0);
    expect(snap.repos[0]?.prs[0]).toMatchObject({ number: 42, class: "docs", sameRepo: true });
  });

  test("invalid repo or site slugs on main are skipped with a warning; a non-list is fatal", () => {
    const { config, warnings } = validateConfig(
      {
        github_owner: "nictuck",
        platform_repo: PLATFORM,
        repos: [
          { name: PLATFORM, site: "fernhillplatform", kind: "platform" },
          { name: "Evil Repo", site: "x", kind: "product" },
          { name: "ok", site: "evil.example.com/..", kind: "product" },
          { name: "ok2", site: "ok2", kind: "thing" },
          "junk",
        ],
        thresholds: { "plan.pr_open_days": 7, bogus: 1 },
        refresh: { interval_minutes: 10, floor_seconds: 60 },
        board: { done_days: 30 },
      },
      { owner: "nictuck", platformRepo: PLATFORM },
    );
    expect(config.repos.map((r) => r.name)).toEqual([PLATFORM]);
    expect(config.thresholds["plan.pr_open_days"]).toBe(7);
    expect(config.thresholds["maintain.untriaged_days"]).toBe(1);
    expect(warnings.filter((w) => w.includes("skipped")).length).toBe(4);
    expect(warnings.some((w) => w.includes("bogus"))).toBe(true);
    expect(() => validateConfig({ repos: "nope" }, { owner: "nictuck", platformRepo: PLATFORM })).toThrow(ConfigError);
    expect(() => validateConfig({ github_owner: "someone-else", repos: [] }, { owner: "nictuck", platformRepo: PLATFORM })).toThrow(ConfigError);
  });
});

describe("R18 version.txt must be a 40-hex sha", () => {
  test.each([
    ["<!doctype html><html><body>Not found</body></html>"],
    ["abc123"],
    ["g".repeat(40)],
    [`${fakeSha("x")}\n${fakeSha("y")}`],
    [""],
  ])("rejects %j", (body) => {
    expect(parseVersion(body)).toBeUndefined();
  });

  test("accepts a sha with surrounding whitespace", () => {
    const sha = fakeSha("ok");
    expect(parseVersion(`${sha}\n`)).toBe(sha);
  });

  test("a bad body sets error and leaves version unset, with a warning", async () => {
    const fake = new FakeGithub();
    addTree(fake, PLATFORM, {
      "flow.config.json": configJson({
        repos: [
          { name: PLATFORM, site: "fernhillplatform", kind: "platform" },
          { name: PRODUCT, site: PRODUCT, kind: "product" },
        ],
      }),
    });
    addRepo(fake, PLATFORM, { noReleaseWorkflow: true });
    addRepo(fake, PRODUCT);
    addPrs(fake, PLATFORM, []);
    addPrs(fake, PRODUCT, []);
    addTree(fake, PRODUCT, {});
    addSite(fake, "fernhillplatform", { staging: "<html>oops</html>", production: "deadbeef" });
    addSite(fake, PRODUCT, { staging: fakeSha(`${PRODUCT}:main`), production: { status: 404, text: "Not found" } });
    const snap = await run(fake);
    const platformRepo = snap.repos.find((r) => r.name === PLATFORM);
    const product = snap.repos.find((r) => r.name === PRODUCT);
    expect(platformRepo?.staging).toEqual({ url: "https://main--fernhillplatform.netlify.app", error: "version.txt is not a commit sha" });
    expect(platformRepo?.production.version).toBeUndefined();
    expect(product?.staging.version).toBe(fakeSha(`${PRODUCT}:main`));
    expect(product?.production).toEqual({ url: `https://${PRODUCT}.netlify.app`, error: "HTTP 404" });
    expect(snap.warnings.some((w) => w.includes("site https://fernhill-flow.netlify.app: HTTP 404"))).toBe(true);
  });
});
