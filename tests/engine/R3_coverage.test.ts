// R3: config ⇄ engine coverage in both directions, read from the engine's
// own source so a new condition without a key (or a key without a
// condition) fails here before it ships.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THRESHOLD_KEYS } from "../../src/engine/types.ts";
import { makeConfig } from "../helpers/build.ts";

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../src/engine/${name}`, import.meta.url)), "utf8");
}

const engine = `${source("derive.ts")}\n${source("needsYou.ts")}`;

test("every threshold key is used by the engine", () => {
  for (const key of THRESHOLD_KEYS) {
    expect(engine.includes(`"${key}"`), `${key} is never referenced in derive.ts or needsYou.ts`).toBe(true);
  }
});

test("every threshold the engine references is a listed key", () => {
  const refs = new Set<string>();
  for (const m of engine.matchAll(/thresholds\[\s*"([^"]+)"\s*\]/g)) refs.add(m[1]!);
  for (const m of engine.matchAll(/thresholds\.([A-Za-z_$][\w$]*)/g)) refs.add(m[1]!);
  for (const m of engine.matchAll(/"((?:plan|design|build|test|deploy|maintain)\.[a-z_]+)"/g)) refs.add(m[1]!);
  expect(refs.size).toBeGreaterThanOrEqual(THRESHOLD_KEYS.length);
  for (const ref of refs) {
    expect(THRESHOLD_KEYS as readonly string[], `${ref} is not a listed threshold key`).toContain(ref);
  }
});

test("the engine only reads thresholds through a typed key (no stray numeric limits)", () => {
  // Every stuck check goes through `check(key, from)`; a literal `> 3` style
  // comparison would bypass flow.config.json.
  expect(source("derive.ts")).not.toMatch(/daysBetween\([^)]*\)\s*>\s*\d/);
});

test("flow.config.json thresholds have exactly the listed keys", () => {
  expect(Object.keys(makeConfig().thresholds).sort()).toEqual([...THRESHOLD_KEYS].sort());
});
