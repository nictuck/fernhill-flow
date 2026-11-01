// The card (spec → "The card"): id · title · [stage] · state line · action.

import type { Derived } from "../engine/types.ts";
import { stateParts } from "../engine/index.ts";
import { Link } from "../router.ts";
import { ActionLine } from "./ActionLine.tsx";
import { Badge } from "./Badge.tsx";
import type { BadgeKind } from "./Badge.tsx";
import { bareStage } from "./format.ts";

/** badge · rest · [CI red] · [stuck] — one string everywhere it appears. */
export function StateLine({ d, now }: { d: Derived; now: string }) {
  const parts = stateParts(d, now);
  return (
    <div className="state">
      <Badge kind={d.state as BadgeKind}>{parts.badge}</Badge>
      <span className="rest">{parts.rest}</span>
      {d.ci === "red" && <Badge kind="ci-red">CI red</Badge>}
      {parts.stuck && <Badge kind="stuck">{parts.stuck}</Badge>}
    </div>
  );
}

export function Card({ d, now, showStage = false }: { d: Derived; now: string; showStage?: boolean }) {
  const { intent } = d;
  return (
    <article className={d.stuck ? "card is-stuck" : "card"} aria-labelledby={`card-${intent.id}-title`}>
      <div className="head">
        <span className="id">{intent.id}</span>
        <span className="title" id={`card-${intent.id}-title`}>
          <Link href={`/intent/${intent.id}`}>{intent.title}</Link>
        </span>
        {showStage && <span className="stage">{bareStage(d.stage)}</span>}
      </div>
      <StateLine d={d} now={now} />
      {d.action && d.state !== "done" && (
        <div className="action">
          <ActionLine action={d.action} />
        </div>
      )}
    </article>
  );
}
