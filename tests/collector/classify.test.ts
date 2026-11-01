import { classifyBranch, classifyFiles, PERMISSION_PATH } from "../../src/collector/classify.ts";

describe("classifyBranch: every branch pattern", () => {
  test.each([
    ["intent/0001-flow-dashboard", { class: "intent", intent: "0001" }],
    ["design/0001-flow-dashboard", { class: "spec", intent: "0001" }],
    ["incident/2026-11-04-blank-board", { class: "incident" }],
    ["release/0001-v0.1.0", { class: "release" }],
    ["build/0001-flow-dashboard", { class: "build", intent: "0001" }],
    ["fix/blank-board", { class: "fix" }],
  ] as const)("%s", (branch, expected) => {
    expect(classifyBranch(branch)).toEqual(expected);
  });

  test.each(["main", "docs/tweak", "intent/1-short", "intent/00010-long", "build/flow", "Build/0001-x", "design-0001-x", ""])(
    "%s → null",
    (branch) => {
      expect(classifyBranch(branch)).toBeNull();
    },
  );
});

describe("classifyFiles: permission by path, then directory, then docs", () => {
  test.each([
    [".claude/hooks/no-merge.sh"],
    [".github/workflows/ci.yml"],
    ["exceptions/EX-002-x.md"],
    ["personas/ux.md"],
    ["CODEOWNERS"],
    ["REVIEW.md"],
  ])("%s is a permission path", (path) => {
    expect(PERMISSION_PATH.test(path)).toBe(true);
    expect(classifyFiles(["docs/flow.md", path])).toEqual({ class: "permission" });
  });

  test("not fooled by look-alike paths", () => {
    expect(PERMISSION_PATH.test("docs/CODEOWNERS")).toBe(false);
    expect(PERMISSION_PATH.test("src/REVIEW.md.txt")).toBe(false);
    expect(PERMISSION_PATH.test("my.github/x")).toBe(false);
  });

  test("intent directory files", () => {
    expect(classifyFiles(["intent/0002-second/intent.md"])).toEqual({ class: "intent", intent: "0002" });
    expect(classifyFiles(["intent/0002-second/spec.md"])).toEqual({ class: "spec", intent: "0002" });
    expect(classifyFiles(["intent/0002-second/intent.md", "intent/0002-second/spec.md"])).toEqual({ class: "intent", intent: "0002" });
    expect(classifyFiles(["intent/README.md"])).toEqual({ class: "intent" });
  });

  test("incidents and releases", () => {
    expect(classifyFiles(["incidents/2026-11-04-blank-board.md"])).toEqual({ class: "incident" });
    expect(classifyFiles(["releases/0001-v0.1.0.md"])).toEqual({ class: "release" });
  });

  test("anything mixed or elsewhere is docs", () => {
    expect(classifyFiles(["docs/flow.md"])).toEqual({ class: "docs" });
    expect(classifyFiles(["intent/0002-second/intent.md", "docs/flow.md"])).toEqual({ class: "docs" });
    expect(classifyFiles([])).toEqual({ class: "docs" });
    expect(classifyFiles(["flow.config.json"])).toEqual({ class: "docs" });
  });
});
