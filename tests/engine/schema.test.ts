import { SCHEMA_VERSION, THRESHOLD_KEYS } from "../../src/engine/types.ts";

test("schema version is a positive integer and threshold keys are unique", () => {
  expect(Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION > 0).toBe(true);
  expect(new Set(THRESHOLD_KEYS).size).toBe(THRESHOLD_KEYS.length);
});
