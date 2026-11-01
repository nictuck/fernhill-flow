// Active exceptions (R7): one muted strip each, on the Board and on Systems.

import type { Snapshot } from "../engine/types.ts";
import { fmtDate } from "../engine/index.ts";
import { ExtLink } from "./ExtLink.tsx";
import { plural } from "./format.ts";

export function activeExceptions(snapshot: Snapshot, now: string) {
  const today = now.slice(0, 10);
  return snapshot.platform.exceptions.filter((e) => e.status === "active" && e.expires >= today);
}

export function Exceptions({ snapshot, now }: { snapshot: Snapshot; now: string }) {
  const active = activeExceptions(snapshot, now);
  if (active.length === 0) return null;
  return (
    <>
      {active.map((e) => (
        <div className="banner exception" key={e.id}>
          <span>
            <strong>Exception {e.id} active</strong> — grants {e.grants.join(", ")} in {plural(e.repos.length, "repo")} until{" "}
            {fmtDate(e.expires, now)}. <ExtLink href={e.url}>Read it</ExtLink>
          </span>
        </div>
      ))}
    </>
  );
}
