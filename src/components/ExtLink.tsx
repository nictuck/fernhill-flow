// Every outbound link passes through safeHref (R18): only URLs the function
// built under the configured owner or sites become links; anything else is
// rendered as plain text.

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { FlowConfig } from "../engine/types.ts";
import { safeHref } from "../engine/index.ts";

export const ConfigContext = createContext<FlowConfig | null>(null);

export function useSafeHref(href: string | undefined): string | undefined {
  const config = useContext(ConfigContext);
  if (!href) return undefined;
  if (!config) return undefined;
  return safeHref(href, config);
}

export function ExtLink({ href, children, className }: { href: string | undefined; children: ReactNode; className?: string }) {
  const safe = useSafeHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a href={safe} className={className} rel="noreferrer">
      {children}
    </a>
  );
}
