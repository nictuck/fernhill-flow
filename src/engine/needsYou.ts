// R4: "Needs you (N)" — intents waiting on a role plus one row per open
// incident under on-call. Groups in ROLES order, empty groups omitted, rows
// stuck first then oldest.

import type { Derived, NeedsYou, NeedsYouItem, Role, Snapshot } from "./types.ts";
import { ROLES } from "./types.ts";
import { daysBetween } from "./time.ts";
import { triageAction } from "./derive.ts";

/** Stuck rows first, then the most days; ties keep input order. */
export function byUrgency(a: { stuck: boolean; days: number }, b: { stuck: boolean; days: number }): number {
  if (a.stuck !== b.stuck) return a.stuck ? -1 : 1;
  return b.days - a.days;
}

export function needsYou(rows: Derived[], snapshot: Snapshot, now: string): NeedsYou {
  const thresholds = snapshot.config.thresholds;
  const items: { role: Role; item: NeedsYouItem }[] = [];

  for (const d of rows) {
    if (d.state !== "waiting" || d.waitingOn === undefined) continue;
    // Incidents attach to the product: the incident rows carry a Maintain
    // intent's wait on on-call, so the intent is not listed twice.
    if (d.stage === "maintain" && d.waitingOn === "on-call") continue;
    // Days here are the wait (what the threshold measures), the same number the card's
    // "Waiting on ‹role› for N days" shows — not time in stage.
    const item: NeedsYouItem = { kind: "intent", derived: d, days: d.waitDays, stuck: d.stuck };
    if (d.limit !== undefined) item.limit = d.limit;
    if (d.action !== undefined) item.action = d.action;
    items.push({ role: d.waitingOn, item });
  }

  const limit = thresholds["maintain.untriaged_days"];
  for (const incident of snapshot.platform.incidents) {
    if (incident.status !== "open") continue;
    const days = daysBetween(incident.opened, now);
    items.push({
      role: "on-call",
      item: { kind: "incident", incident, days, stuck: days > limit, limit, action: triageAction(incident, snapshot.config) },
    });
  }

  const groups = ROLES.map((role) => ({
    role,
    rows: items
      .filter((i) => i.role === role)
      .map((i) => i.item)
      .sort(byUrgency),
  })).filter((g) => g.rows.length > 0);

  return {
    count: groups.reduce((n, g) => n + g.rows.length, 0),
    groups,
    inProgress: rows.filter((d) => d.onBoard && d.state === "progress").length,
    stuck: rows.filter((d) => d.onBoard && d.stuck).length,
  };
}
