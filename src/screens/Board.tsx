// `/` — What is waiting on me, and is anything stuck? Needs you first, then
// the exceptions strip, then the seven stage sections.

import type { Derived, NeedsYou as NeedsYouData, Snapshot, Stage } from "../engine/types.ts";
import { board, olderDoneCount } from "../engine/index.ts";
import { Exceptions } from "../components/Exceptions.tsx";
import { NeedsYou } from "../components/NeedsYou.tsx";
import { StageSection } from "../components/Stage.tsx";

export interface BoardProps {
  snapshot: Snapshot;
  derived: Derived[];
  needs: NeedsYouData;
  now: string;
  openStage: Stage | null;
}

export function Board({ snapshot, derived, needs, now, openStage }: BoardProps) {
  if (snapshot.platform.intents.length === 0) {
    return (
      <div className="empty-screen">
        <p>
          No intents yet. Run <code>/intent</code> in fernhill-platform to write the first one.
        </p>
      </div>
    );
  }
  const columns = board(derived);
  const olderDone = olderDoneCount(derived);

  return (
    <>
      <NeedsYou data={needs} now={now} />
      <Exceptions snapshot={snapshot} now={now} />
      <div className="stages" role="region" aria-label="Stages">
        {columns.map((c) => (
          <StageSection
            key={c.stage}
            stage={c.stage}
            rows={c.rows}
            stuckCount={c.stuckCount}
            allRows={derived}
            snapshot={snapshot}
            now={now}
            open={openStage === c.stage}
            {...(c.stage === "done" ? { olderDone } : {})}
          />
        ))}
      </div>
    </>
  );
}
