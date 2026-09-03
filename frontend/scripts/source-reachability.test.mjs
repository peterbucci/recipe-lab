import { describe, expect, it } from "vitest";

import { reachableModulePaths } from "./source-reachability.mjs";

describe("source reachability graph", () => {
  it("walks transitive imports and cycles without treating an isolated export as reachable", () => {
    const graph = new Map([
      ["page.tsx", ["view.tsx"]],
      ["view.tsx", ["format.ts"]],
      ["format.ts", ["view.tsx"]],
      ["unused-wrapper.ts", ["format.ts"]],
    ]);

    expect([...reachableModulePaths(graph, ["page.tsx"])].sort()).toEqual([
      "format.ts",
      "page.tsx",
      "view.tsx",
    ]);
  });
});
