// One stage section (R1, R6): header with count and stuck count, a Details
// toggle that opens the in-place detail block (URL `?stage=`), the cards,
// and for Done the "N older → Archive" footer. Done has no detail block:
// its toggle (Show/Hide, phones only) reveals the cards.

import type { Derived, Snapshot, Stage as StageId } from "../engine/types.ts";
import { plural, stageDetail, stageLabel, stateParts } from "../engine/index.ts";
import { Link, navigate } from "../router.ts";
import { Card } from "./Card.tsx";
import { bareStage } from "./format.ts";

export interface StageProps {
  stage: StageId;
  rows: Derived[];
  stuckCount: number;
  allRows: Derived[];
  snapshot: Snapshot;
  now: string;
  open: boolean;
  /** Done only: archived done intents not on the board */
  olderDone?: number;
}

export function StageSection({ stage, rows, stuckCount, allRows, snapshot, now, open, olderDone }: StageProps) {
  const isDone = stage === "done";
  const empty = rows.length === 0;
  const detailId = `stage-${stage}-detail`;
  const headingId = `stage-${stage}-h`;
  const detail = open && !isDone ? stageDetail(stage, allRows, snapshot, now) : null;
  // Done's detail is one line (R6 says every header expands in place); on a
  // phone the same toggle also reveals the Done cards (CSS `.is-open`).
  const doneDetail = open && isDone;

  const cls = ["stage-col", empty ? "is-empty" : "", isDone ? "done" : "", open ? "is-open" : ""].filter(Boolean).join(" ");

  function toggle() {
    navigate(open ? "/" : `/?stage=${stage}`, { replace: true });
  }

  const label = open ? "Hide" : "Details";

  return (
    <section className={cls} aria-labelledby={headingId}>
      <header>
        <h2 id={headingId}>{stageLabel(stage)}</h2>
        <span className="count">{rows.length}</span>
        {stuckCount > 0 && <span className="stuck-count">{stuckCount} stuck</span>}
        {!empty && (
          <button type="button" aria-expanded={open} onClick={toggle} {...(detail || doneDetail ? { "aria-controls": detailId } : {})}>
            {label}
          </button>
        )}
      </header>
      {doneDetail && (
        <div className="stage-detail" id={detailId}>
          <div>
            {plural(rows.length, "intent")} on board · {plural(olderDone ?? 0, "intent")} older in Archive
          </div>
        </div>
      )}
      {detail && (
        <div className="stage-detail" id={detailId}>
          <div>
            {plural(detail.count, "intent")}
            {detail.stats && (
              <>
                {" · "}median {detail.stats.medianDays} d · max {detail.stats.maxDays} d · n={detail.stats.n}
              </>
            )}
            {" · "}
            {detail.stuckCount} stuck
          </div>
          <ul>
            {rows.map((d) => {
              const stuck = stateParts(d, now).stuck;
              return (
                <li key={d.intent.id}>
                  {d.intent.id} {d.intent.title} · {plural(d.days, "day")} in stage
                  {stuck ? ` · ${stuck}` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {rows.map((d) => (
        <Card key={d.intent.id} d={d} now={now} />
      ))}
      {empty && <div className="empty">No intents in {bareStage(stage)}</div>}
      {isDone && (
        <div className="footer">
          Done: {olderDone ?? 0} older → <Link href="/archive">Archive</Link>
        </div>
      )}
    </section>
  );
}
