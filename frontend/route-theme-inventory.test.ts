import { readdirSync } from "node:fs";
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

    expect(discoveredPages).toHaveLength(20);
    expect(inventoriedPages).toEqual(discoveredPages);
    expect(new Set(RCP46_PAGE_THEME_INVENTORY.map(({ route }) => route)).size).toBe(20);
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

    expect(discoveredStates).toHaveLength(26);
    expect(inventoriedStates).toEqual(discoveredStates);
    expect(new Set(inventoriedStates).size).toBe(26);
    for (const item of RCP46_ROUTE_STATE_THEME_INVENTORY) {
      expect(basename(item.file)).toBe(`${item.kind}.tsx`);
    }
  });
});
