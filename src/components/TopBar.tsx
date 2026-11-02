// Flow · Board · Systems · Archive · freshness strip. aria-current marks the route.

import type { FlowState } from "../api.ts";
import type { Route } from "../router.ts";
import { Link } from "../router.ts";
import { Freshness } from "./Freshness.tsx";

const NAV: { href: string; label: string; match: Route["name"][] }[] = [
  { href: "/", label: "Board", match: ["board", "intent"] },
  { href: "/systems", label: "Systems", match: ["systems"] },
  { href: "/archive", label: "Archive", match: ["archive"] },
];

export function TopBar({ route, flow }: { route: Route; flow: FlowState }) {
  return (
    <header className="topbar">
      <span className="brand">Flow</span>
      <nav aria-label="Primary">
        {NAV.map((n) => {
          const current = n.match.includes(route.name);
          return current ? (
            <Link href={n.href} key={n.href} aria-current="page">
              {n.label}
            </Link>
          ) : (
            <Link href={n.href} key={n.href}>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <span className="spacer" />
      <Freshness flow={flow} />
    </header>
  );
}
