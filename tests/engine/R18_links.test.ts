// R18: the UI emits only links under https://github.com/<owner>/ and the
// configured sites. Everything else becomes plain text.

import { safeHref } from "../../src/engine/links.ts";
import { GH, makeConfig } from "../helpers/build.ts";

const config = makeConfig();

test("GitHub URLs under the configured owner pass through unchanged", () => {
  for (const href of [
    `${GH}/fernhill-flow/pull/5`,
    `${GH}/fernhill-platform/blob/main/intent/0001-flow-dashboard/spec.md`,
    `${GH}/fernhill-flow/actions/runs/100`,
    `${GH}/fernhill-flow/pull/5/checks`,
    `${GH}/fernhill-flow/pull/5?diff=split#issuecomment-1`,
    `${GH}/fernhill-flow`,
  ]) {
    expect(safeHref(href, config)).toBe(href);
  }
});

test("configured sites, staging and production, pass through", () => {
  for (const href of [
    "https://fernhill-flow.netlify.app",
    "https://fernhill-flow.netlify.app/version.txt",
    "https://main--fernhill-flow.netlify.app/",
    "https://fernhillplatform.netlify.app/intent/0001",
  ]) {
    expect(safeHref(href, config)).toBe(href);
  }
});

test("another owner → undefined", () => {
  expect(safeHref("https://github.com/other/fernhill-flow/pull/5", config)).toBeUndefined();
  expect(safeHref("https://github.com/nictuck-evil/x", config)).toBeUndefined();
  expect(safeHref("https://github.com/nictuck", config)).toBeUndefined();
  expect(safeHref("https://github.com/nictuck/", config)).toBeUndefined();
});

test("a `..` segment → undefined", () => {
  expect(safeHref(`${GH}/fernhill-flow/../x`, config)).toBeUndefined();
  expect(safeHref(`${GH}/../../evil`, config)).toBeUndefined();
  expect(safeHref("https://fernhill-flow.netlify.app/../x", config)).toBeUndefined();
});

test("an unlisted site → undefined", () => {
  expect(safeHref("https://evil.com/x", config)).toBeUndefined();
  expect(safeHref("https://evil.netlify.app/", config)).toBeUndefined();
  expect(safeHref("https://fernhill-flow.netlify.app.evil.com/", config)).toBeUndefined();
  expect(safeHref("https://main--evil.netlify.app/", config)).toBeUndefined();
});

test("other schemes and tricks → undefined", () => {
  expect(safeHref("javascript:alert(1)", config)).toBeUndefined();
  expect(safeHref("http://github.com/nictuck/fernhill-flow", config)).toBeUndefined();
  expect(safeHref("https://github.com/nictuck@evil.com/x", config)).toBeUndefined();
  expect(safeHref(`${GH}/fernhill flow/pull/1`, config)).toBeUndefined();
  expect(safeHref(`${GH}//fernhill-flow`, config)).toBeUndefined();
  expect(safeHref(`${GH}/fernhill-flow/<script>`, config)).toBeUndefined();
  expect(safeHref("", config)).toBeUndefined();
  expect(safeHref(undefined, config)).toBeUndefined();
});

test("the owner itself must be a plain GitHub login", () => {
  const odd = makeConfig({ github_owner: "nictuck/.." });
  expect(safeHref("https://github.com/nictuck/../x", odd)).toBeUndefined();
});
