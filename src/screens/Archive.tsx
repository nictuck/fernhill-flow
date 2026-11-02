// `/archive` — What did we decide not to do, or finish? (R13) Every done,
// parked and rejected intent with its final status, when, and by whom.

import type { Derived } from "../engine/types.ts";
import { archive, fmtDate } from "../engine/index.ts";
import { Badge } from "../components/Badge.tsx";
import type { BadgeKind } from "../components/Badge.tsx";
import { Link } from "../router.ts";

const KIND: Record<string, BadgeKind> = { done: "done", parked: "parked", rejected: "rejected" };

export function Archive({ derived, now }: { derived: Derived[]; now: string }) {
  const rows = archive(derived);
  return (
    <div className="archive">
      <Link className="back" href="/">
        ← Board
      </Link>
      {rows.length === 0 ? (
        <div className="empty-screen">
          <p>Nothing archived yet. Done, parked and rejected intents land here.</p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Intent</th>
              <th>Final status</th>
              <th>Set</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const i = d.intent;
              return (
                <tr key={i.id}>
                  <td>
                    <span className="id">{i.id}</span> <Link href={`/intent/${i.id}`}>{i.title}</Link>
                  </td>
                  <td>
                    <Badge kind={KIND[i.status] ?? "done"}>{i.status}</Badge>
                  </td>
                  <td>{i.statusSetAt ? fmtDate(i.statusSetAt, now) : <span className="label">date unknown</span>}</td>
                  <td>{i.statusSetBy || <span className="label">unknown</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
