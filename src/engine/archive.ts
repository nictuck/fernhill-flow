// R1 board grouping and R13 archive.

import type { Derived, Stage } from "./types.ts";
import { STAGES } from "./types.ts";
import { byUrgency } from "./needsYou.ts";

export interface BoardGroup {
  stage: Stage;
  rows: Derived[];
  stuckCount: number;
}

function statusTime(d: Derived): number {
  const t = Date.parse(d.intent.statusSetAt ?? d.clockStart);
  return Number.isNaN(t) ? 0 : t;
}

/** Every done, parked and rejected intent, newest status change first. */
export function archive(rows: Derived[]): Derived[] {
  return rows
    .filter((d) => d.intent.status === "done" || d.intent.status === "parked" || d.intent.status === "rejected")
    .sort((a, b) => statusTime(b) - statusTime(a));
}

/**
 * Rows on the board grouped by stage in STAGES order (every stage present,
 * possibly empty). Stages list stuck rows first, then the oldest; Done lists
 * the newest first.
 */
export function board(rows: Derived[]): BoardGroup[] {
  return STAGES.map((stage) => {
    const inStage = rows.filter((d) => d.onBoard && d.stage === stage);
    const sorted =
      stage === "done"
        ? [...inStage].sort((a, b) => Date.parse(b.clockStart) - Date.parse(a.clockStart))
        : [...inStage].sort(byUrgency);
    return { stage, rows: sorted, stuckCount: sorted.filter((d) => d.stuck).length };
  });
}

/** Done rows that have left the board ("Done: N older → Archive"). */
export function olderDoneCount(rows: Derived[]): number {
  return rows.filter((d) => d.intent.status === "done" && !d.onBoard).length;
}
