// The trust rule (R18): `main` is trusted, PR content is display-only.
// Config comes only from `flow.config.json` on the platform's `main`; every
// value in it is checked here before it decides which repos and sites the
// collector talks to (R19).

import type { FlowConfig, RepoRef, ThresholdKey } from "../engine/types.ts";
import { THRESHOLD_KEYS } from "../engine/types.ts";

const SLUG_RE = /^[a-z0-9-]{1,100}$/;
const OWNER_RE = /^[A-Za-z0-9-]{1,39}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
export const PLATFORM_REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** Defaults in THRESHOLD_KEYS order (spec: flow.config.json schema). */
export const THRESHOLD_DEFAULTS: readonly number[] = [3, 5, 3, 5, 5, 3, 1, 2, 2, 1];
export const REFRESH_DEFAULTS = { interval_minutes: 10, floor_seconds: 60 } as const;
export const BOARD_DEFAULTS = { done_days: 30 } as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export interface ValidatedConfig {
  config: FlowConfig;
  warnings: string[];
}

/**
 * Validate the parsed `flow.config.json`. Throws `ConfigError` when the
 * file cannot be used at all; returns warnings for repaired values.
 */
export function validateConfig(raw: unknown, fallback: { owner: string; platformRepo: string }): ValidatedConfig {
  const warnings: string[] = [];
  if (!isRecord(raw)) throw new ConfigError("flow.config.json is not an object");

  let github_owner = fallback.owner;
  if (typeof raw["github_owner"] === "string" && OWNER_RE.test(raw["github_owner"])) {
    github_owner = raw["github_owner"];
  } else {
    warnings.push(`flow.config.json: github_owner missing or invalid; using ${fallback.owner}`);
  }
  if (github_owner !== fallback.owner) {
    throw new ConfigError(`flow.config.json: github_owner "${github_owner}" is not the platform owner ${fallback.owner}`);
  }

  let platform_repo = fallback.platformRepo;
  if (typeof raw["platform_repo"] === "string" && SLUG_RE.test(raw["platform_repo"])) {
    platform_repo = raw["platform_repo"];
  } else {
    warnings.push(`flow.config.json: platform_repo missing or invalid; using ${fallback.platformRepo}`);
  }

  const reposRaw = raw["repos"];
  if (!Array.isArray(reposRaw)) throw new ConfigError("flow.config.json: repos must be a list");
  const repos: RepoRef[] = [];
  const seen = new Set<string>();
  reposRaw.forEach((entry: unknown, i) => {
    if (!isRecord(entry)) {
      warnings.push(`flow.config.json: repos[${i}] is not an object; skipped`);
      return;
    }
    const name = entry["name"];
    const site = entry["site"];
    const kind = entry["kind"];
    if (typeof name !== "string" || !SLUG_RE.test(name)) {
      warnings.push(`flow.config.json: repos[${i}].name must match ^[a-z0-9-]{1,100}$; skipped`);
      return;
    }
    if (typeof site !== "string" || !SLUG_RE.test(site)) {
      warnings.push(`flow.config.json: repos[${i}] (${name}) site must match ^[a-z0-9-]{1,100}$; skipped`);
      return;
    }
    if (kind !== "platform" && kind !== "product") {
      warnings.push(`flow.config.json: repos[${i}] (${name}) kind must be platform or product; skipped`);
      return;
    }
    if (seen.has(name)) {
      warnings.push(`flow.config.json: repos[${i}] (${name}) is listed twice; skipped`);
      return;
    }
    seen.add(name);
    repos.push({ name, site, kind });
  });

  const thresholdsRaw = isRecord(raw["thresholds"]) ? raw["thresholds"] : {};
  if (!isRecord(raw["thresholds"])) warnings.push("flow.config.json: thresholds missing; using defaults");
  const thresholds = {} as Record<ThresholdKey, number>;
  THRESHOLD_KEYS.forEach((key, i) => {
    const v = thresholdsRaw[key];
    if (positiveNumber(v)) {
      thresholds[key] = v;
    } else {
      const d = THRESHOLD_DEFAULTS[i] ?? 1;
      thresholds[key] = d;
      if (isRecord(raw["thresholds"])) warnings.push(`flow.config.json: thresholds.${key} missing or not a positive number; using ${d}`);
    }
  });
  for (const key of Object.keys(thresholdsRaw)) {
    if (!(THRESHOLD_KEYS as readonly string[]).includes(key)) {
      warnings.push(`flow.config.json: thresholds.${key} is not a known threshold; ignored`);
    }
  }

  const refreshRaw = isRecord(raw["refresh"]) ? raw["refresh"] : {};
  const interval_minutes = positiveNumber(refreshRaw["interval_minutes"])
    ? refreshRaw["interval_minutes"]
    : REFRESH_DEFAULTS.interval_minutes;
  const floor_seconds = positiveNumber(refreshRaw["floor_seconds"]) ? refreshRaw["floor_seconds"] : REFRESH_DEFAULTS.floor_seconds;
  if (interval_minutes !== refreshRaw["interval_minutes"] || floor_seconds !== refreshRaw["floor_seconds"]) {
    warnings.push("flow.config.json: refresh values missing or invalid; using defaults");
  }

  const boardRaw = isRecord(raw["board"]) ? raw["board"] : {};
  const done_days = positiveNumber(boardRaw["done_days"]) ? boardRaw["done_days"] : BOARD_DEFAULTS.done_days;
  if (done_days !== boardRaw["done_days"]) warnings.push("flow.config.json: board.done_days missing or invalid; using 30");

  return {
    config: {
      github_owner,
      platform_repo,
      repos,
      thresholds,
      refresh: { interval_minutes, floor_seconds },
      board: { done_days },
    },
    warnings,
  };
}

/** A `version.txt` body is a sha or nothing. */
export function parseVersion(body: string): string | undefined {
  const trimmed = body.trim();
  return SHA_RE.test(trimmed) ? trimmed : undefined;
}

export function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA_RE.test(value);
}

/** Head repo must be the base repo; forks are shown, never trusted (R18). */
export function isSameRepo(headRepoFullName: string | null | undefined, owner: string, repo: string): boolean {
  return typeof headRepoFullName === "string" && headRepoFullName.toLowerCase() === `${owner}/${repo}`.toLowerCase();
}

/** `PLATFORM_REPO` deploy-time config: `owner/name`, nothing else. */
export function parsePlatformRepo(value: string): { owner: string; repo: string } | null {
  if (!PLATFORM_REPO_RE.test(value)) return null;
  const [owner, repo] = value.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}
