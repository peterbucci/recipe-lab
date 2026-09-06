import { existsSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RCP46_PAGE_THEME_INVENTORY,
  RCP46_ROUTE_STATE_THEME_INVENTORY,
  RCP46_THEME_FAMILIES,
} from "./route-theme-inventory";

const STATE_FILENAMES = new Set(["error.tsx", "loading.tsx", "not-found.tsx"]);

function discoverAppFiles(directory = join(process.cwd(), "app")): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return discoverAppFiles(absolutePath);
    }
    return [relative(process.cwd(), absolutePath).replaceAll("\\", "/")];
  });
}

describe("RCP-46 route and theme-family source inventory", () => {
  it("assigns every page module to exactly one reviewed theme family", () => {
    const discoveredPages = discoverAppFiles()
      .filter((file) => basename(file) === "page.tsx")
      .sort();
    const inventoriedPages = RCP46_PAGE_THEME_INVENTORY.map(({ file }) => file).sort();

    expect(inventoriedPages).toEqual(discoveredPages);
    expect(new Set(RCP46_PAGE_THEME_INVENTORY.map(({ route }) => route)).size).toBe(
      RCP46_PAGE_THEME_INVENTORY.length,
    );
    expect(
      new Set(RCP46_PAGE_THEME_INVENTORY.map(({ family }) => family)),
    ).toEqual(
      new Set(RCP46_THEME_FAMILIES.filter((family) => family !== "system-state")),
    );
  });

  it("assigns every loading, error, and not-found module exactly once", () => {
    const discoveredStates = discoverAppFiles()
      .filter((file) => STATE_FILENAMES.has(basename(file)))
      .sort();
    const inventoriedStates = RCP46_ROUTE_STATE_THEME_INVENTORY.map(
      ({ file }) => file,
    ).sort();

    expect(inventoriedStates).toEqual(discoveredStates);
    expect(new Set(inventoriedStates).size).toBe(
      RCP46_ROUTE_STATE_THEME_INVENTORY.length,
    );
    for (const item of RCP46_ROUTE_STATE_THEME_INVENTORY) {
      expect(basename(item.file)).toBe(`${item.kind}.tsx`);
    }
  });

  it("classifies every executable page with checked-in reachability evidence", () => {
    for (const item of RCP46_PAGE_THEME_INVENTORY) {
      expect(item.consumerEvidence.length).toBeGreaterThan(0);
      for (const evidence of item.consumerEvidence) {
        expect(evidence.startsWith("/")).toBe(false);
        expect(existsSync(join(process.cwd(), "..", evidence))).toBe(true);
      }
      if (item.reachability === "compatibility-only") {
        expect("redirectTo" in item && item.redirectTo).toMatch(/^\/(?!\/)/);
        expect(item.redirectTo).not.toBe(item.route);
      } else {
        expect("redirectTo" in item).toBe(false);
      }
    }

    expect(
      new Set(RCP46_PAGE_THEME_INVENTORY.map(({ reachability }) => reachability)),
    ).toEqual(new Set(["active", "internal", "compatibility-only"]));
  });
});
