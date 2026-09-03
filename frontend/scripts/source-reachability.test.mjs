import { describe, expect, it } from "vitest";

import {
  auditSourceReachability,
  reachableModulePaths,
} from "./source-reachability.mjs";

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

  it("fails closed when it is pointed at a directory without runtime entries", () => {
    expect(() => auditSourceReachability(import.meta.dirname)).toThrow(
      "No frontend runtime inventory was found",
    );
  });
});
