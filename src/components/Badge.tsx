import type { ReactNode } from "react";

export type BadgeKind = "waiting" | "progress" | "live" | "done" | "stuck" | "ci-red" | "parked" | "rejected";

/** A status pill. The label is always text: status is never color alone (R9). */
export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}
