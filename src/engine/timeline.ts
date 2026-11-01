// R5: an intent's timeline — every artifact and gate, who and when, each
// entry linked to its source. Built only from what the snapshot holds.

import type { CiStatus, Exception, Incident, Pr, Snapshot, TimelineEntry, TimelineKind } from "./types.ts";
import { safeHref } from "./links.ts";
import { incidentSlug, linkedRepo, releaseRunFor } from "./derive.ts";

/** Loose input; `add` drops undefined fields so TimelineEntry stays exact. */
interface EntryInput {
  at: string;
  kind: TimelineKind;
  text: string;
  who?: string | undefined;
  href?: string | undefined;
  ci?: CiStatus | undefined;
  exception?: string | undefined;
}

function short(sha: string | undefined): string {
  return sha === undefined ? "" : sha.slice(0, 7);
}

/** `expires` is a date; a merge any time that day is still covered. */
function endOfExpiry(expires: string): number {
  const t = Date.parse(expires.length === 10 ? `${expires}T23:59:59.999Z` : expires);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** The exception in effect for a merge in `repo` at `at`: granted ≤ at ≤ expires. */
export function exceptionAt(exceptions: readonly Exception[], at: string | undefined, repo?: string): Exception | undefined {
  if (at === undefined) return undefined;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return undefined;
  return exceptions.find((e) => {
    if (e.granted === undefined) return false;
    const from = Date.parse(e.granted);
    if (Number.isNaN(from) || t < from || t > endOfExpiry(e.expires)) return false;
    return repo === undefined || e.repos.length === 0 || e.repos.includes(repo);
  });
}

export function timeline(intentId: string, snapshot: Snapshot, _now: string): TimelineEntry[] {
  const intent = snapshot.platform.intents.find((i) => i.id === intentId);
  if (!intent) return [];
  const { config } = snapshot;
  const exceptions = snapshot.platform.exceptions;
  const entries: TimelineEntry[] = [];

  const add = (e: EntryInput): void => {
    const entry: TimelineEntry = { at: e.at, kind: e.kind, text: e.text };
    if (e.who !== undefined && e.who !== "") entry.who = e.who;
    const href = safeHref(e.href, config);
    if (href !== undefined) entry.href = href;
    if (e.ci !== undefined) entry.ci = e.ci;
    if (e.exception !== undefined) entry.exception = e.exception;
    entries.push(entry);
  };

  const platform = snapshot.repos.find((r) => r.name === config.platform_repo);
  const platformPrs = (platform?.prs ?? []).filter((p) => p.sameRepo && p.intent === intentId);

  // Stage 1: the intent PR and gate 1.
  const intentPrs = platformPrs.filter((p) => p.class === "intent");
  if (intentPrs.length === 0 && intent.prNumber !== undefined) {
    add({
      at: intent.prOpenedAt ?? intent.created,
      kind: "intent-pr",
      text: `Intent PR #${intent.prNumber} opened`,
      who: intent.author,
      href: intent.url,
    });
  }
  for (const pr of intentPrs) {
    add({ at: pr.createdAt, kind: "intent-pr", text: `Intent PR #${pr.number} opened`, who: pr.author, href: pr.url, ci: pr.ci });
    if (pr.state === "merged") {
      add({
        at: pr.mergedAt ?? pr.updatedAt,
        kind: "intent-accepted",
        text: `Intent ${intent.id} accepted (gate 1) · ${short(pr.mergeCommit)}`.replace(/ · $/, ""),
        who: pr.mergedBy,
        href: pr.url,
        exception: exceptionAt(exceptions, pr.mergedAt, config.platform_repo)?.id,
      });
    }
  }
  if (!intentPrs.some((p) => p.state === "merged") && intent.acceptedAt !== undefined) {
    add({ at: intent.acceptedAt, kind: "intent-accepted", text: `Intent ${intent.id} accepted (gate 1)`, href: intent.url });
  }

  // Stage 2: the spec PR and gate 2.
  const spec = intent.spec;
  const specPrs = platformPrs.filter((p) => p.class === "spec");
  const flaggedText = spec !== undefined ? ` (${spec.flagged} ${spec.flagged === 1 ? "concern" : "concerns"} open)` : "";
  if (specPrs.length === 0 && spec?.prNumber !== undefined) {
    add({ at: spec.prOpenedAt ?? intent.acceptedAt ?? intent.created, kind: "spec-pr", text: `Spec PR #${spec.prNumber} opened${flaggedText}`, href: spec.url });
  }
  for (const pr of specPrs) {
    add({ at: pr.createdAt, kind: "spec-pr", text: `Spec PR #${pr.number} opened${flaggedText}`, who: pr.author, href: pr.url, ci: pr.ci });
    if (pr.state === "merged") {
      add({
        at: pr.mergedAt ?? pr.updatedAt,
        kind: "spec-accepted",
        text: `Spec accepted (gate 2) · ${short(pr.mergeCommit)}`.replace(/ · $/, ""),
        who: pr.mergedBy,
        href: pr.url,
        exception: exceptionAt(exceptions, pr.mergedAt, config.platform_repo)?.id,
      });
    }
  }
  if (!specPrs.some((p) => p.state === "merged") && spec?.acceptedAt !== undefined) {
    add({ at: spec.acceptedAt, kind: "spec-accepted", text: "Spec accepted (gate 2)", href: spec.url });
  }

  // Stages 3–6 live in the product repo.
  const repo = linkedRepo(snapshot, intent);
  if (repo) {
    for (const plan of repo.plans) {
      if (plan.intent !== intentId) continue;
      const where = plan.onMain ? "" : " (on branch)";
      add({
        at: plan.createdAt,
        kind: "plan",
        text: `Plan ${plan.path} ${plan.status}${where}${plan.status === "approved" ? " (gate 3)" : ""}`,
        who: plan.status === "approved" ? plan.approvedBy : undefined,
        href: plan.url,
      });
    }

    const prs: Pr[] = repo.prs.filter((p) => p.sameRepo && p.class === "build" && p.intent === intentId);
    for (const pr of prs) {
      add({ at: pr.createdAt, kind: "build-pr", text: `Build PR #${pr.number} opened`, who: pr.author, href: pr.url, ci: pr.ci });
      if (pr.state === "merged") {
        const mergedAt = pr.mergedAt ?? pr.updatedAt;
        add({
          at: mergedAt,
          kind: "merged",
          text: `PR #${pr.number} merged (gate 4) · ${short(pr.mergeCommit)}`.replace(/ · $/, ""),
          who: pr.mergedBy,
          href: pr.url,
          ci: pr.ci,
          exception: exceptionAt(exceptions, mergedAt, repo.name)?.id,
        });
        const run = releaseRunFor(repo, pr);
        if (run) {
          const status = run.status === "completed" ? (run.conclusion ?? "completed") : run.status.replace("_", " ");
          add({ at: run.createdAt, kind: "release", text: `Release run #${run.id} ${status}`, href: run.url });
          if (run.approvedAt !== undefined || run.approvedBy !== undefined) {
            add({
              at: run.approvedAt ?? run.createdAt,
              kind: "release",
              text: `Production approved for run #${run.id} (gate 5)`,
              who: run.approvedBy,
              href: run.url,
            });
          }
          if (pr.servedLive === true) {
            add({
              at: run.approvedAt ?? run.createdAt,
              kind: "deployed",
              text: `Production serves ${short(pr.mergeCommit ?? run.sha)}`,
              href: repo.production.url,
            });
          }
        } else if (pr.servedLive === true) {
          add({ at: mergedAt, kind: "deployed", text: `Production serves ${short(pr.mergeCommit)}`, href: repo.production.url });
        }
      } else if (pr.state === "closed") {
        add({ at: pr.updatedAt, kind: "build-pr", text: `Build PR #${pr.number} closed without merging`, who: pr.author, href: pr.url });
      }
    }
  }

  // Incidents on the product, and any incident that spawned this intent.
  const incidents: Incident[] = snapshot.platform.incidents.filter(
    (i) => (intent.product !== "" && i.product === intent.product) || i.intent === intentId,
  );
  for (const i of incidents) {
    const reason = i.status === "dismissed" ? ` — ${i.reason !== "" ? i.reason : "no reason recorded"}` : "";
    add({ at: i.opened, kind: "incident", text: `Incident ${incidentSlug(i)} ${i.status}${reason}`, who: i.triagedBy, href: i.url });
  }

  // Final status flips.
  if (intent.status === "done" || intent.status === "parked" || intent.status === "rejected") {
    add({
      at: intent.statusSetAt ?? intent.created,
      kind: "status",
      text: `Intent marked ${intent.status}`,
      who: intent.statusSetBy,
      href: intent.url,
    });
  }

  const time = (e: TimelineEntry): number => {
    const t = Date.parse(e.at);
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };
  return entries.sort((a, b) => time(a) - time(b));
}
