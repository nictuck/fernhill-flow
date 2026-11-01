// R18: the UI emits only links the engine constructed under
// https://github.com/<owner>/ and the configured Netlify sites. Everything
// an action or timeline entry links to goes through `safeHref`; anything
// outside the allow-list becomes undefined and the UI renders plain text.

import type { FlowConfig } from "./types.ts";

const SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:%-]*$/;

function segmentsOk(path: string): boolean {
  if (/\s/.test(path) || path.includes("@") || path.includes("\\")) return false;
  const [pathname] = path.split(/[?#]/, 1);
  for (const seg of (pathname ?? "").split("/")) {
    if (seg === "..") return false;
    if (!SEGMENT.test(seg)) return false;
  }
  return true;
}

/**
 * Returns `href` unchanged when it is a GitHub URL under the configured owner
 * or a staging/production URL of a configured site; otherwise undefined.
 */
export function safeHref(href: string | undefined, config: FlowConfig): string | undefined {
  if (href === undefined) return undefined;
  if (/\s/.test(href) || href.includes("@") || href.includes("\\")) return undefined;

  const owner = config.github_owner;
  if (!/^[A-Za-z0-9-]+$/.test(owner)) return undefined;
  const gh = `https://github.com/${owner}/`;
  if (href.startsWith(gh)) {
    const rest = href.slice(gh.length);
    if (rest === "" || rest.startsWith("/")) return undefined;
    return segmentsOk(rest) ? href : undefined;
  }

  for (const repo of config.repos) {
    const site = repo.site;
    if (!/^[a-z0-9-]{1,100}$/.test(site)) continue;
    for (const host of [`https://${site}.netlify.app`, `https://main--${site}.netlify.app`]) {
      if (href === host) return href;
      if (href.startsWith(`${host}/`)) {
        const rest = href.slice(host.length + 1);
        return segmentsOk(rest) ? href : undefined;
      }
    }
  }
  return undefined;
}
