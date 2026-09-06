import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  auditSourceReachability,
  isProductionSource,
  reachableModulePaths,
} from "./source-reachability.mjs";

describe("source reachability graph", () => {
  it("excludes colocated tests and their support modules from production inventory", () => {
    expect(isProductionSource("app/components/recipe-card.tsx")).toBe(true);
    expect(isProductionSource("app/components/recipe-card.test.tsx")).toBe(false);
    expect(
      isProductionSource("app/components/recipe-card-test-support.tsx"),
    ).toBe(false);
  });

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

  it("follows moved owners and reports unreachable source outside app and lib", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "recipe-lab-reachability-"));
    const fixtureFiles = {
      "app/page.tsx": 'import "../shell/page"; import "../features/recipes/view";',
      "shell/page.tsx": 'import "@/shared/ui/panel";',
      "features/recipes/view.tsx": 'import "../../shared/ui/panel";',
      "shared/ui/panel.tsx": "export const Panel = () => null;",
      "shared/ui/unreachable.ts": "export const unused = true;",
      "shared/ui/panel.test.tsx": "export const testOnly = true;",
      "shell/page-test-support.tsx": "export const supportOnly = true;",
    };

    try {
      for (const [file, source] of Object.entries(fixtureFiles)) {
        const target = join(fixtureRoot, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, source);
      }
      vi.stubEnv("RECIPE_LAB_FRONTEND_DEPENDENCY_ROOT", process.cwd());

      const result = auditSourceReachability(fixtureRoot);
      expect(result.entries).toEqual(["app/page.tsx"]);
      expect(result.sources).toEqual([
        "app/page.tsx",
        "features/recipes/view.tsx",
        "shared/ui/panel.tsx",
        "shared/ui/unreachable.ts",
        "shell/page.tsx",
      ]);
      expect(result.unreachable).toEqual(["shared/ui/unreachable.ts"]);
    } finally {
      vi.unstubAllEnvs();
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
