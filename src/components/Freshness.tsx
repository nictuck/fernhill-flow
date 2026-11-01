// The freshness strip (R8/R9): fresh, refreshing, stale, failed, loading.
// Copy is the spec's table verbatim; a Refresh button follows it.

import { useEffect, useState } from "react";
import type { FlowState } from "../api.ts";
import { isStale } from "../engine/index.ts";
import { ageText, errorTag, hhmm } from "./format.ts";

/** Re-render every 30 s in live mode so ages tick; fixed in fixture mode. */
function useNow(flow: FlowState): string {
  const live = flow.mode === "live";
  const [tick, setTick] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setTick(new Date().toISOString()), 30_000);
    return () => window.clearInterval(id);
  }, [live]);
  return live ? tick : flow.now;
}

export function Freshness({ flow }: { flow: FlowState }) {
  const now = useNow(flow);
  const snap = flow.snapshot;
  const refreshButton = (label = "Refresh") => (
    <button type="button" onClick={flow.refresh} disabled={flow.refreshing}>
      {label}
    </button>
  );

  if (!snap) {
    if (flow.status === "loading") {
      return (
        <div className="fresh loading" role="status">
          <span className="dot" aria-hidden="true" />
          Loading the board…
        </div>
      );
    }
    return (
      <div className="fresh failed" role="status">
        <span className="dot" aria-hidden="true" />
        No snapshot yet. {refreshButton()}
      </div>
    );
  }

  const age = ageText(snap.collectedAt, now);
  const interval = snap.config.refresh.interval_minutes;

  if (flow.refreshing) {
    return (
      <div className="fresh refreshing" role="status">
        <span className="dot" aria-hidden="true" />
        Showing snapshot from {age} · refreshing…
      </div>
    );
  }

  const err = flow.lastError;
  if (err && err.kind === "config") {
    return (
      <div className="fresh failed" role="status">
        <span className="dot" aria-hidden="true" />
        Refresh failed: {err.message} {refreshButton()}
      </div>
    );
  }
  if (err) {
    return (
      <div className="fresh failed" role="status">
        <span className="dot" aria-hidden="true" />
        Refresh failed at {hhmm(err.at)} ({errorTag(err)}). Showing the snapshot from {hhmm(snap.collectedAt)}. {refreshButton()}
      </div>
    );
  }

  if (isStale(snap.collectedAt, now, interval)) {
    return (
      <div className="fresh stale" role="status">
        <span className="dot" aria-hidden="true" />
        Stale — last refresh {age}. {refreshButton("Refresh now")}. If it fails, check the function log and the token expiry.
      </div>
    );
  }

  return (
    <div className="fresh" role="status">
      <span className="dot" aria-hidden="true" />
      Snapshot from {age} · {refreshButton()}
    </div>
  );
}
