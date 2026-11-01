// The card (spec → "The card"): id · title · [stage] · state line · action.

import type { ReactNode } from "react";
import type { Derived } from "../engine/types.ts";
import { stageLabel, stateParts } from "../engine/index.ts";
import { Link } from "../router.ts";
import { ActionLine } from "./ActionLine.tsx";
import { Badge } from "./Badge.tsx";
import type { BadgeKind } from "./Badge.tsx";

export function StateLine({ d, now, children }: { d: Derived; now: string; children?: ReactNode }) {
  const parts = stateParts(d, now);
  return (
    <div className="state">
      <Badge kind={d.state as BadgeKind}>{parts.badge}</Badge>
      {children}
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
        {showStage && <span className="stage">{stageLabel(d.stage)}</span>}
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
