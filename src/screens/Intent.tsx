// `/intent/:id` — Where is this idea and what happened to it? Header with the
// current state and action, the stuck analysis, then the timeline (R5).

import type { Derived, Snapshot } from "../engine/types.ts";
import { timeline } from "../engine/index.ts";
import type { TimelineEntry } from "../engine/index.ts";
import { ActionLine } from "../components/ActionLine.tsx";
import { Badge } from "../components/Badge.tsx";
import { StateLine } from "../components/Card.tsx";
import { ExtLink } from "../components/ExtLink.tsx";
import { fmtDate } from "../engine/index.ts";
import { bareStage, hhmm, plural } from "../components/format.ts";
import { Link } from "../router.ts";

function when(at: string, now: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at) || at.endsWith("T00:00:00.000Z")) return fmtDate(at, now);
  return `${fmtDate(at, now)} ${hhmm(at)}`;
}

function Entry({ e, now }: { e: TimelineEntry; now: string }) {
  const pending = /\b(opened|waiting|open\b|proposed)/.test(e.text) && !/merged|accepted|resolved|dismissed/.test(e.text);
  return (
    <li>
      <span className="when">{when(e.at, now)}</span>
      <span className={pending ? "tick pending" : "tick"} aria-hidden="true" />
      <span className="what">
        <span>
          {e.href ? <ExtLink href={e.href}>{e.text}</ExtLink> : e.text}
          {e.ci === "red" && (
            <>
              {" "}
              <Badge kind="ci-red">CI red</Badge>
            </>
          )}
        </span>
        {e.who && <span className="who">{e.who}</span>}
        {e.exception && <span className="exc">under {e.exception}</span>}
      </span>
    </li>
  );
}

function StuckAnalysis({ d }: { d: Derived }) {
  if (d.state === "done") return null;
  const limit = d.limit !== undefined ? plural(d.limit, "day") : null;
  const key = d.thresholdKey ? ` (${d.thresholdKey})` : "";
  return (
    <p className="analysis">
      {d.stuck
        ? `Stuck: ${plural(d.days, "day")} in ${bareStage(d.stage)}${limit ? `, limit ${limit}` : ""}${key}.`
        : limit
          ? `Not stuck: ${plural(d.days, "day")} in ${bareStage(d.stage)}, limit ${limit}${key}.`
          : `${plural(d.days, "day")} in ${bareStage(d.stage)}; no threshold applies.`}
    </p>
  );
}

export function IntentScreen({ id, snapshot, derived, now }: { id: string; snapshot: Snapshot; derived: Derived[]; now: string }) {
  const d = derived.find((r) => r.intent.id === id);
  const intent = d?.intent ?? snapshot.platform.intents.find((i) => i.id === id);
  if (!intent) {
    return (
      <>
        <Link className="back" href="/">
          ← Board
        </Link>
        <div className="empty-screen">
          <p>Intent {id} is not in this snapshot.</p>
        </div>
      </>
    );
  }
  const entries = timeline(id, snapshot, now);
  return (
    <>
      <Link className="back" href="/">
        ← Board
      </Link>
      <div className="intent-head">
        <span className="id">{intent.id}</span>
        <h1>{intent.title}</h1>
        {d && (
          <StateLine d={d} now={now}>
            <span className="stage">{bareStage(d.stage)}</span>
          </StateLine>
        )}
        {d?.action && d.state !== "done" && (
          <div className="action">
            <ActionLine action={d.action} />
          </div>
        )}
        {d && <StuckAnalysis d={d} />}
        <p className="label">
          {intent.status} · by {intent.author} · origin {intent.origin}
          {intent.product ? ` · product ${intent.product}` : " · no product repo"} · <ExtLink href={intent.url}>View intent</ExtLink>
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="label">No events recorded yet.</p>
      ) : (
        <ol className="timeline" aria-label="Timeline">
          {entries.map((e, i) => (
            <Entry key={`${e.at}-${i}`} e={e} now={now} />
          ))}
        </ol>
      )}
    </>
  );
}
