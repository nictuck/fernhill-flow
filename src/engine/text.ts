// Card copy, exactly as the spec's "The card" paragraph. The UI composes the
// state line from `stateParts` so the badge can carry a colour and a label.

import type { Derived, Role, Stage } from "./types.ts";
import { fmtDate, fmtDays } from "./time.ts";

const STAGE_LABELS: Record<Stage, string> = {
  plan: "1 Plan",
  design: "2 Design",
  build: "3 Build",
  test: "4 Test",
  deploy: "5 Deploy",
  maintain: "6 Maintain",
  done: "Done",
};

const ROLE_LABELS: Record<Role, string> = {
  "product owner": "Product owner",
  engineer: "Engineer",
  "code owner": "Code owner",
  "release manager": "Release manager",
  "on-call": "On-call",
};

/** "1 Plan" … "6 Maintain", "Done". */
export function stageLabel(stage: Stage): string {
  return STAGE_LABELS[stage];
}

/** Capitalised role for group headings: "Product owner", "On-call". */
export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

export interface StateParts {
  /** "Waiting on product owner" | "In progress" | "Live" | "Done" */
  badge: string;
  /** the text after the badge, e.g. "for 6 days", "· 2 days", "since 12 Oct · no open incidents" */
  rest: string;
  /** "stuck, limit 3", or "stuck" when the condition has no timer */
  stuck?: string;
}

export function stateParts(d: Derived, now: string): StateParts {
  const stuck = d.stuck ? (d.limit !== undefined ? `stuck, limit ${d.limit}` : "stuck") : undefined;
  const withStuck = (parts: StateParts): StateParts => (stuck === undefined ? parts : { ...parts, stuck });
  switch (d.state) {
    case "waiting":
      // The wait is counted from what the threshold measures (waitDays), not the stage clock,
      // so "for N days" and "limit L" are the same number stuck compares.
      return withStuck({ badge: `Waiting on ${d.waitingOn ?? "someone"}`, rest: `for ${fmtDays(d.waitDays)}` });
    case "progress":
      return withStuck({ badge: "In progress", rest: `· ${fmtDays(d.days)}` });
    case "live":
      return withStuck({ badge: "Live", rest: `since ${fmtDate(d.clockStart, now)} · ${d.notes[0] ?? "no open incidents"}` });
    case "done":
      return { badge: "Done", rest: `${fmtDate(d.clockStart, now)} · ${fmtDays(d.days)} on board` };
  }
}

/**
 * "Waiting on product owner for 6 days · stuck, limit 3" · "In progress · 2 days" ·
 * "Live since 12 Oct · no open incidents" · "Done 12 Oct · 18 days on board".
 */
export function stateLine(d: Derived, now: string): string {
  const p = stateParts(d, now);
  return `${p.badge} ${p.rest}${p.stuck ? ` · ${p.stuck}` : ""}`;
}
