// PR classification (R15): branch name first, files-changed only as a
// fallback. `permission` is decided by path so the Security pass is visible.

import type { PrClass } from "../engine/types.ts";

export interface BranchClass {
  class: PrClass;
  intent?: string;
}

const INTENT_BRANCH = /^intent\/(\d{4})-/;
const DESIGN_BRANCH = /^design\/(\d{4})-/;
const BUILD_BRANCH = /^build\/(\d{4})-/;

/** `intent/NNNN-*` → intent, `design/NNNN-*` → spec, `incident/*`, `release/*`, `build/NNNN-*`, `fix/*`; else null. */
export function classifyBranch(name: string): BranchClass | null {
  let m = INTENT_BRANCH.exec(name);
  if (m?.[1]) return { class: "intent", intent: m[1] };
  m = DESIGN_BRANCH.exec(name);
  if (m?.[1]) return { class: "spec", intent: m[1] };
  if (name.startsWith("incident/")) return { class: "incident" };
  if (name.startsWith("release/")) return { class: "release" };
  m = BUILD_BRANCH.exec(name);
  if (m?.[1]) return { class: "build", intent: m[1] };
  if (name.startsWith("fix/")) return { class: "fix" };
  return null;
}

export const PERMISSION_PATH = /^(\.claude\/|\.github\/|exceptions\/|personas\/|CODEOWNERS$|REVIEW\.md$)/;

const INTENT_PATH = /^intent\/(\d{4})-[^/]*\/(intent|spec)\.md$/;

function allUnder(paths: string[], prefix: string): boolean {
  return paths.length > 0 && paths.every((p) => p.startsWith(prefix));
}

/**
 * Fallback when the branch name says nothing. `permission` wins if any path
 * touches the guardrails; otherwise the class of the directory every path
 * is under; otherwise `docs`.
 */
export function classifyFiles(paths: string[]): BranchClass {
  if (paths.some((p) => PERMISSION_PATH.test(p))) return { class: "permission" };
  if (allUnder(paths, "intent/")) {
    let intent: string | undefined;
    let hasIntentMd = false;
    let hasSpecMd = false;
    for (const p of paths) {
      const m = INTENT_PATH.exec(p);
      if (!m) continue;
      intent ??= m[1];
      if (m[2] === "intent") hasIntentMd = true;
      if (m[2] === "spec") hasSpecMd = true;
    }
    const cls: PrClass = hasIntentMd || !hasSpecMd ? "intent" : "spec";
    return intent ? { class: cls, intent } : { class: cls };
  }
  if (allUnder(paths, "incidents/")) return { class: "incident" };
  if (allUnder(paths, "releases/")) return { class: "release" };
  return { class: "docs" };
}
