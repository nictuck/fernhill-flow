// R4: grouped by role, stuck first, empty groups hidden, quiet copy when
// nothing waits. Each row: who · action · meta.

import type { NeedsYou as NeedsYouData, NeedsYouItem } from "../engine/types.ts";
import { roleLabel, stateParts } from "../engine/index.ts";
import { Link } from "../router.ts";
import { ActionLine } from "./ActionLine.tsx";
import { Badge } from "./Badge.tsx";
import { plural } from "./format.ts";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function incidentSlug(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.md$/, "");
}

function Row({ item, now }: { item: NeedsYouItem; now: string }) {
  const stuckText = item.stuck ? (item.limit !== undefined ? `stuck, limit ${item.limit}` : "stuck") : null;
  if (item.kind === "incident") {
    return (
      <div className="row">
        <span className="who">Incident {incidentSlug(item.incident.path)}</span>
        <span className="what">
          <ActionLine action={item.action} />
        </span>
        <span className="meta">
          {plural(item.days, "day")}
          {stuckText && <Badge kind="stuck">{stuckText}</Badge>}
        </span>
      </div>
    );
  }
  const { intent } = item.derived;
  const parts = stateParts(item.derived, now);
  return (
    <div className="row">
      <span className="who">
        <Link href={`/intent/${intent.id}`}>
          {intent.id} {intent.title}
        </Link>
      </span>
      <span className="what">{item.action ? <ActionLine action={item.action} /> : <span>{parts.badge}</span>}</span>
      <span className="meta">
        {plural(item.days, "day")}
        {(parts.stuck ?? stuckText) && <Badge kind="stuck">{parts.stuck ?? stuckText}</Badge>}
      </span>
    </div>
  );
}

export function NeedsYou({ data, now }: { data: NeedsYouData; now: string }) {
  return (
    <section className="needs" aria-labelledby="needs-h">
      <h2 id="needs-h">Needs you ({data.count})</h2>
      {data.count === 0 ? (
        <div className="quiet">
          Nothing is waiting on you. {data.inProgress} in progress, {data.stuck} stuck.
        </div>
      ) : (
        data.groups.map((g) => (
          <div className="role" key={g.role}>
            <h3>{capitalize(roleLabel(g.role))}</h3>
            {g.rows.map((item) => (
              <Row key={item.kind === "incident" ? `inc-${item.incident.path}` : `int-${item.derived.intent.id}`} item={item} now={now} />
            ))}
          </div>
        ))
      )}
    </section>
  );
}
