// Plan step 1 (R15): measure the live collector against the real repos.
//
//   make spike      → GITHUB_TOKEN="$(gh auth token)" npm run spike
//
// The token lives in the process env only; nothing here prints or persists
// it. Two runs: cold ETag cache, then warm. Writes docs/baseline.md and
// tests/fixtures/000-live.json (the first snapshot — logins only).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GithubClient } from "../src/collector/github.ts";
import type { CallLogEntry, EtagCache, GithubStats } from "../src/collector/github.ts";
import { collect, DEFAULT_PLATFORM_REPO } from "../src/collector/collect.ts";
import type { Snapshot } from "../src/engine/types.ts";
import { BUDGET_MS } from "../netlify/lib/refresh-core.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set. Run `make spike` (it reads `gh auth token`).");
  process.exit(1);
}
const platformRepo = process.env.PLATFORM_REPO ?? DEFAULT_PLATFORM_REPO;

const SOURCES = ["tree/blobs", "PRs", "check-runs", "commits", "repos/branches", "compares", "runs/approvals", "other"] as const;
type Source = (typeof SOURCES)[number];

function sourceOf(path: string): Source {
  const p = path.split("?")[0] ?? path;
  if (p.includes("/git/trees/") || p.includes("/git/blobs/")) return "tree/blobs";
  if (p.includes("/pulls")) return "PRs";
  if (p.endsWith("/check-runs") || p.endsWith("/status")) return "check-runs";
  if (p.includes("/compare/")) return "compares";
  if (p.includes("/actions/")) return "runs/approvals";
  if (p.includes("/commits")) return "commits";
  if (/^\/repos\/[^/]+\/[^/]+$/.test(p) || p.includes("/branches")) return "repos/branches";
  return "other";
}

function perSource(log: CallLogEntry[]): Record<Source, number> {
  const out = Object.fromEntries(SOURCES.map((s) => [s, 0])) as Record<Source, number>;
  for (const entry of log) out[sourceOf(entry.path)] += 1;
  return out;
}

interface Run {
  snapshot: Snapshot;
  stats: GithubStats;
  siteCalls: number;
  wallMs: number;
  remainingBefore: number | undefined;
  remainingAfter: number | undefined;
}

async function rateLimitRemaining(): Promise<number | undefined> {
  const probe = new GithubClient({ token: token as string, fetch: globalThis.fetch });
  const body = (await probe.get("/rate_limit")) as { resources?: { core?: { remaining?: number } } };
  return body.resources?.core?.remaining;
}

async function runOnce(etagCache: EtagCache): Promise<Run> {
  const remainingBefore = await rateLimitRemaining();
  let siteCalls = 0;
  const siteFetch: typeof fetch = (input, init) => {
    siteCalls += 1;
    return globalThis.fetch(input, init);
  };
  const client = new GithubClient({ token: token as string, fetch: globalThis.fetch, etagCache });
  const started = performance.now();
  const snapshot = await collect({ client, fetch: siteFetch, now: () => new Date().toISOString(), platformRepo });
  const wallMs = Math.round(performance.now() - started);
  const stats = client.stats();
  // Probe again: the header on the last response is whichever call finished
  // last under parallelism, not a monotonic counter. /rate_limit is free.
  const remainingAfter = await rateLimitRemaining();
  return { snapshot, stats, siteCalls, wallMs, remainingBefore, remainingAfter };
}

/** Logins only: drop anything that looks like an email from every string. */
function stripEmails(value: unknown): { value: unknown; stripped: number } {
  let stripped = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v.includes("@")) {
        stripped += 1;
        return v.replace(/\S*@\S*/g, "").trim();
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), stripped };
}

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "n/a";
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

const cache: EtagCache = {};
console.info(`spike: collecting ${platformRepo} (cold cache)…`);
const first = await runOnce(cache);
console.info(`spike: ${first.stats.calls} GitHub calls, ${first.siteCalls} site calls, ${first.wallMs} ms`);
console.info("spike: collecting again (warm cache)…");
const second = await runOnce(cache);
console.info(`spike: ${second.stats.calls} GitHub calls, ${second.stats.cached} cached (304), ${second.wallMs} ms`);

const sources = perSource(first.stats.log);
const sourcesSecond = perSource(second.stats.log);
const { value: fixture, stripped } = stripEmails(first.snapshot);
const fixtureText = JSON.stringify(fixture, null, 2);
if (fixtureText.includes("@")) throw new Error("fixture still contains an @ after stripping");

const slowest = Math.max(first.wallMs, second.wallMs);
const recommendation =
  slowest <= BUDGET_MS * 0.5
    ? `Both runs finished well inside the ${BUDGET_MS} ms budget (slowest ${slowest} ms), so \`refresh\` stays a synchronous function. Revisit when a second product repo lands: each repo adds roughly ${Math.round(first.stats.calls / Math.max(1, first.snapshot.config.repos.length))} calls.`
    : slowest <= BUDGET_MS
      ? `The slowest run used ${pct(slowest, BUDGET_MS)} of the ${BUDGET_MS} ms budget. Keep \`refresh\` synchronous for now, but a second product repo will likely push it over; plan the move to a background function before adding one.`
      : `The slowest run (${slowest} ms) exceeded the ${BUDGET_MS} ms budget. \`refresh\` should become a background function (or the per-repo work must be split) before release.`;

const date = new Date().toISOString();
const md = `# R15 baseline — live collector

Captured ${date} by \`make spike\` (plan step 1) against \`${platformRepo}\`.
Repos in \`flow.config.json\` on main: ${first.snapshot.config.repos.map((r) => `\`${r.name}\``).join(", ")}
(${first.snapshot.config.repos.length}). Two runs back to back: cold ETag cache, then warm.

## Calls per source

| Source | First run (cold) | Second run (warm) |
|--------|-----------------:|------------------:|
${SOURCES.map((s) => `| ${s} | ${sources[s]} | ${sourcesSecond[s]} |`).join("\n")}
| **GitHub total** | **${first.stats.calls}** | **${second.stats.calls}** |
| Sites (\`version.txt\`, no auth, not rate-limited) | ${first.siteCalls} | ${second.siteCalls} |

## First vs second run

| | First run (cold) | Second run (warm) |
|---|---:|---:|
| GitHub calls | ${first.stats.calls} | ${second.stats.calls} |
| 304 responses (cached) | ${first.stats.cached} | ${second.stats.cached} |
| 304 rate (cached/calls) | ${pct(first.stats.cached, first.stats.calls)} | ${pct(second.stats.cached, second.stats.calls)} |
| \`x-ratelimit-remaining\` before → after (\`/rate_limit\` probe) | ${first.remainingBefore ?? "?"} → ${first.remainingAfter ?? "?"} | ${second.remainingBefore ?? "?"} → ${second.remainingAfter ?? "?"} |
| Consumed (probe difference) | ${first.remainingBefore !== undefined && first.remainingAfter !== undefined ? first.remainingBefore - first.remainingAfter : "?"} | ${second.remainingBefore !== undefined && second.remainingAfter !== undefined ? second.remainingBefore - second.remainingAfter : "?"} |
| \`x-ratelimit-remaining\` header on the last response (what the refresh log carries) | ${first.stats.remaining ?? "?"} | ${second.stats.remaining ?? "?"} |
| Wall time | ${first.wallMs} ms | ${second.wallMs} ms |
| Wall time vs ${BUDGET_MS} ms budget | ${pct(first.wallMs, BUDGET_MS)} | ${pct(second.wallMs, BUDGET_MS)} |
| Snapshot size | ${bytes(first.snapshot)} bytes | ${bytes(second.snapshot)} bytes |

## Budget rule (R15)

The baseline is **${first.stats.calls} GitHub calls** per cold refresh. A refresh that
doubles it (> ${first.stats.calls * 2} calls) logs a warning. The hard cap stays at 200.

## Recommendation: sync or background function

${recommendation}

## Warnings (first run)

${first.snapshot.warnings.length ? first.snapshot.warnings.map((w) => `- ${w}`).join("\n") : "- none"}

## Fixture

\`tests/fixtures/000-live.json\` is the first snapshot (${bytes(fixture)} bytes).
${stripped ? `${stripped} string(s) containing \`@\` were stripped.` : "No string contained `@`; nothing was stripped."}
`;

await mkdir(resolve(ROOT, "docs"), { recursive: true });
await mkdir(resolve(ROOT, "tests/fixtures"), { recursive: true });
await writeFile(resolve(ROOT, "docs/baseline.md"), md);
await writeFile(resolve(ROOT, "tests/fixtures/000-live.json"), `${fixtureText}\n`);
console.info("spike: wrote docs/baseline.md and tests/fixtures/000-live.json");
