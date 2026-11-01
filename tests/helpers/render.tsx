// UI test helpers: a FlowState builder and a populated snapshot that covers
// every stage, so R9/R12 tests render the real Shell with no network.

import { render } from "@testing-library/react";
import type { FlowState } from "../../src/api.ts";
import { Shell } from "../../src/App.tsx";
import { parseRoute } from "../../src/router.ts";
import type { Snapshot } from "../../src/engine/types.ts";
import {
  GH,
  NOW,
  PLATFORM,
  daysAgo,
  makeException,
  makeIncident,
  makeIntent,
  makePlan,
  makePr,
  makeRepo,
  makeRun,
  makeSnapshot,
} from "./build.ts";

export function makeFlow(over: Partial<FlowState> = {}): FlowState {
  return {
    status: "ready",
    mode: "live",
    snapshot: null,
    previousSnapshot: null,
    stale: false,
    refreshing: false,
    lastError: null,
    lastRefreshAt: null,
    now: NOW,
    refresh: vi.fn(),
    ...over,
  };
}

/** Render the pure Shell at a path with the given flow state. */
export function renderAt(path: string, flow: FlowState) {
  const q = path.indexOf("?");
  const route = q === -1 ? parseRoute(path) : parseRoute(path.slice(0, q), path.slice(q));
  return render(<Shell route={route} flow={flow} />);
}

const FLOW = "fernhill-flow";
const sha = (c: string) => c.repeat(40);
const ppr = (o: Parameters<typeof makePr>[0] & { number: number }) => makePr({ url: `${GH}/${PLATFORM}/pull/${o.number}`, ...o });

/** Every stage once: Plan, Design (stuck), Build, Test (red + green), Deploy, Maintain (incident), Done, plus parked/rejected. */
export function populatedSnapshot(): Snapshot {
  const M5 = sha("d");
  const M6 = sha("e");
  const proposed = makeIntent({
    id: "0008",
    dir: "0008-weekly-digest",
    title: "Weekly digest",
    status: "proposed",
    created: "2026-11-09",
    url: `${GH}/${PLATFORM}/pull/12`,
    prNumber: 12,
    prOpenedAt: daysAgo(1),
  });
  delete proposed.acceptedAt;
  const rejected = makeIntent({ id: "0011", dir: "0011-mobile-app", title: "Mobile app", status: "rejected", statusSetAt: daysAgo(3), statusSetBy: "nictuck" });
  delete rejected.acceptedAt;

  return makeSnapshot({
    platform: {
      intents: [
        makeIntent({
          id: "0001",
          dir: "0001-flow-dashboard",
          title: "Flow dashboard",
          product: FLOW,
          acceptedAt: daysAgo(8),
          spec: { status: "proposed", flagged: 2, url: `${GH}/${PLATFORM}/blob/main/intent/0001-flow-dashboard/spec.md`, prNumber: 5, prOpenedAt: daysAgo(6) },
        }),
        makeIntent({
          id: "0002",
          dir: "0002-incident-digest",
          title: "Incident digest",
          product: FLOW,
          spec: { status: "accepted", flagged: 0, url: `${GH}/${PLATFORM}/blob/main/intent/0002-incident-digest/spec.md`, acceptedAt: daysAgo(1) },
        }),
        makeIntent({
          id: "0003",
          dir: "0003-release-notes-bot",
          title: "Release notes bot",
          product: FLOW,
          spec: { status: "accepted", flagged: 0, url: `${GH}/${PLATFORM}/blob/main/intent/0003-release-notes-bot/spec.md`, acceptedAt: daysAgo(9) },
        }),
        makeIntent({
          id: "0004",
          dir: "0004-persona-editor",
          title: "Persona editor",
          product: FLOW,
          spec: { status: "accepted", flagged: 0, url: `${GH}/${PLATFORM}/blob/main/intent/0004-persona-editor/spec.md`, acceptedAt: daysAgo(8) },
        }),
        makeIntent({
          id: "0005",
          dir: "0005-status-page",
          title: "Status page",
          product: FLOW,
          spec: { status: "accepted", flagged: 0, url: `${GH}/${PLATFORM}/blob/main/intent/0005-status-page/spec.md`, acceptedAt: daysAgo(12) },
        }),
        makeIntent({
          id: "0006",
          dir: "0006-onboarding-checklist",
          title: "Onboarding checklist",
          product: FLOW,
          spec: { status: "accepted", flagged: 0, url: `${GH}/${PLATFORM}/blob/main/intent/0006-onboarding-checklist/spec.md`, acceptedAt: daysAgo(28) },
        }),
        proposed,
        makeIntent({ id: "0009", dir: "0009-logo-refresh", title: "Logo refresh", status: "done", product: FLOW, statusSetAt: daysAgo(12), statusSetBy: "nictuck" }),
        makeIntent({ id: "0010", dir: "0010-slack-bot", title: "Slack bot", status: "parked", statusSetAt: daysAgo(40), statusSetBy: "nictuck" }),
        rejected,
        makeIntent({ id: "0012", dir: "0012-brand-colours", title: "Brand colours", status: "done", statusSetAt: daysAgo(45), statusSetBy: "nictuck" }),
      ],
      exceptions: [makeException({ granted: daysAgo(12) })],
      incidents: [
        makeIncident(),
        makeIncident({ path: "incidents/2026-10-20-slow-board.md", status: "dismissed", opened: daysAgo(21), triagedBy: "nictuck", reason: "duplicate" }),
      ],
      personas: [],
    },
    repos: [
      makeRepo({
        name: PLATFORM,
        site: "fernhillplatform",
        mainHead: sha("7"),
        productionHead: sha("3"),
        productionBehindMain: { count: 3, since: daysAgo(10) },
        staging: { url: "https://main--fernhillplatform.netlify.app", version: sha("7") },
        production: { url: "https://fernhillplatform.netlify.app", version: sha("3") },
        prs: [
          ppr({ number: 1, branch: "intent/0001-flow-dashboard", class: "intent", intent: "0001", state: "merged", createdAt: daysAgo(9), mergedAt: daysAgo(8), mergedBy: "nictuck", mergeCommit: sha("a") }),
          ppr({ number: 5, branch: "design/0001-flow-dashboard", class: "spec", intent: "0001", createdAt: daysAgo(6), updatedAt: daysAgo(5) }),
          ppr({ number: 12, branch: "intent/0008-weekly-digest", class: "intent", intent: "0008", createdAt: daysAgo(1) }),
        ],
      }),
      makeRepo({
        name: FLOW,
        prs: [
          makePr({ number: 14, branch: "build/0003-release-notes-bot", intent: "0003", createdAt: daysAgo(1), updatedAt: daysAgo(1), ci: "green" }),
          makePr({ number: 9, branch: "build/0004-persona-editor", intent: "0004", createdAt: daysAgo(2.5), updatedAt: daysAgo(2), ci: "red", ciUrl: `${GH}/${FLOW}/actions/runs/1/job/1` }),
          makePr({ number: 11, branch: "build/0005-status-page", intent: "0005", state: "merged", createdAt: daysAgo(3), mergedAt: daysAgo(0.5), mergedBy: "nictuck", mergeCommit: M5, inProduction: false }),
          makePr({ number: 7, branch: "build/0006-onboarding-checklist", intent: "0006", state: "merged", createdAt: daysAgo(22), mergedAt: daysAgo(20), mergedBy: "nictuck", mergeCommit: M6, inProduction: true, servedLive: true }),
        ],
        plans: ["0003", "0004", "0005", "0006"].map((id) => makePlan({ path: `plan/${id}-x.md`, url: `${GH}/${FLOW}/blob/main/plan/${id}-x.md`, intent: id })),
        releaseRuns: [
          makeRun({ id: 41301, url: `${GH}/${FLOW}/actions/runs/41301`, sha: M6, status: "completed", conclusion: "success", pendingApproval: false, createdAt: daysAgo(19.9), approvedBy: "nictuck", approvedAt: daysAgo(19.8) }),
          makeRun({ id: 41355, url: `${GH}/${FLOW}/actions/runs/41355`, sha: M5, status: "waiting", pendingApproval: true, createdAt: daysAgo(0.4) }),
        ],
      }),
    ],
  });
}
