// A pushState router small enough to read in one sitting. Four routes:
// `/` (Board, `?stage=` opens one stage's detail), `/intent/:id`,
// `/systems`, `/archive`. No runtime dependency (plan: React Router rejected).

import { createElement, useMemo, useSyncExternalStore } from "react";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { STAGES } from "./engine/types.ts";
import type { Stage } from "./engine/types.ts";

export type Route =
  | { name: "board"; stage: Stage | null }
  | { name: "intent"; id: string }
  | { name: "systems" }
  | { name: "archive" }
  | { name: "not-found"; path: string };

export function parseRoute(pathname: string, search = ""): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    const raw = new URLSearchParams(search).get("stage");
    const stage = (STAGES as readonly string[]).includes(raw ?? "") ? (raw as Stage) : null;
    return { name: "board", stage };
  }
  if (path === "/systems") return { name: "systems" };
  if (path === "/archive") return { name: "archive" };
  const m = /^\/intent\/([^/]+)$/.exec(path);
  if (m?.[1]) return { name: "intent", id: decodeURIComponent(m[1]) };
  return { name: "not-found", path };
}

/** The href for a route, the inverse of parseRoute. */
export function hrefFor(route: Route): string {
  switch (route.name) {
    case "board":
      return route.stage ? `/?stage=${route.stage}` : "/";
    case "intent":
      return `/intent/${encodeURIComponent(route.id)}`;
    case "systems":
      return "/systems";
    case "archive":
      return "/archive";
    case "not-found":
      return route.path;
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function currentKey(): string {
  return window.location.pathname + window.location.search;
}

export function navigate(href: string, opts: { replace?: boolean } = {}): void {
  const url = new URL(href, window.location.href);
  const target = url.pathname + url.search + url.hash;
  if (target === currentKey() + window.location.hash) return;
  if (opts.replace) window.history.replaceState(null, "", target);
  else window.history.pushState(null, "", target);
  for (const l of listeners) l();
}

export function useRoute(): Route {
  const key = useSyncExternalStore(subscribe, currentKey, currentKey);
  return useMemo(() => {
    const q = key.indexOf("?");
    return q === -1 ? parseRoute(key) : parseRoute(key.slice(0, q), key.slice(q));
  }, [key]);
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode };

/** Same-origin links go through pushState; modified clicks and other origins fall through. */
export function Link(props: LinkProps) {
  const { href, onClick, ...rest } = props;
  return createElement("a", {
    ...rest,
    href,
    onClick(e: MouseEvent<HTMLAnchorElement>) {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (rest.target && rest.target !== "_self") return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      navigate(href);
    },
  });
}
