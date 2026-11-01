// Error states by FlowError.kind (R9), copy from the spec table verbatim.
// Shown alone when there is no snapshot, above the content when there is.

import type { FlowError } from "../api.ts";
import type { Snapshot } from "../engine/types.ts";
import { errorTag, hhmm } from "./format.ts";

function repoNameFrom(error: FlowError, snapshot: Snapshot | null): string {
  const flagged = snapshot?.repos.find((r) => r.error)?.name;
  if (flagged) return flagged;
  const m = /([a-z0-9-]+\/)?([a-z0-9][a-z0-9-]{0,99})/i.exec(error.message);
  return m?.[2] ?? "The repo";
}

export function ErrorScreen({ error, snapshot, onRefresh }: { error: FlowError; snapshot: Snapshot | null; onRefresh: () => void }) {
  const showing = snapshot ? ` Showing the snapshot from ${hhmm(snapshot.collectedAt)}.` : " No snapshot yet.";
  const refresh = (
    <p>
      <button type="button" onClick={onRefresh}>
        Refresh
      </button>
    </p>
  );
  switch (error.kind) {
    case "token":
      return (
        <div className="error-screen" role="alert">
          <h2>GitHub rejected the token.</h2>
          <p>
            Rotate <code>GITHUB_TOKEN</code> in Netlify → Site configuration → Environment variables, then Refresh.
          </p>
          {refresh}
        </div>
      );
    case "rate-limit":
      return (
        <div className="error-screen" role="alert">
          <h2>
            GitHub rate limit reached; resets at {error.resetAt ? hhmm(error.resetAt) : "an unknown time"}.{showing}
          </h2>
          {refresh}
        </div>
      );
    case "not-found": {
      const name = repoNameFrom(error, snapshot);
      return (
        <div className="error-screen" role="alert">
          <h2>
            <code>{name}</code> is in flow.config.json but the token cannot see it. Add it to the token's selected repositories.
          </h2>
          {refresh}
        </div>
      );
    }
    case "config":
      return (
        <div className="error-screen" role="alert">
          <h2>Refresh failed: {error.message}</h2>
          {refresh}
        </div>
      );
    default:
      return (
        <div className="error-screen" role="alert">
          <h2>
            Refresh failed at {hhmm(error.at)} ({errorTag(error)}).{showing}
          </h2>
          {error.message && <p className="label">{error.message}</p>}
          {refresh}
        </div>
      );
  }
}
