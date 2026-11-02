// Small display formatters shared by the screens. Dates and ages the engine
// does not own: local clock times and relative ages for the freshness strip.

import type { FlowError } from "../api.ts";
import type { Stage } from "../engine/types.ts";
import { stageLabel } from "../engine/index.ts";

/** "3 min ago" / "2 h ago" / "1 d ago"; "just now" under a minute. */
export function ageText(fromIso: string, nowIso: string): string {
  const ms = Math.max(0, Date.parse(nowIso) - Date.parse(fromIso));
  if (!Number.isFinite(ms)) return "unknown";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** Local HH:MM, 24-hour. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "??:??";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : "";
}

/** "(GitHub 502)" / "(network)" / "(rate-limit)" for the failed strip. */
export function errorTag(e: FlowError): string {
  if (e.status !== undefined) return `GitHub ${e.status}`;
  if (e.kind === "upstream") return "network";
  return e.kind;
}

/** Hostname minus `.netlify.app`, for site link text; falls back to the URL. */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/\.netlify\.app$/, "");
  } catch {
    return url;
  }
}

/** "Design" from the engine's "2 Design" heading label. */
export function bareStage(stage: Stage): string {
  return stageLabel(stage).replace(/^\d+ /, "");
}
