import { describe, expect, it } from "vitest";

import {
  isVariantForRecipeBrowseType,
  parseRecipeBrowseType,
  recipeBrowseHref,
} from "./recipe-browse-query";

describe("recipe browse query", () => {
  it("preserves search while omitting an empty query and page one", () => {
    expect(recipeBrowseHref(1, "carrot & pecan")).toBe(
      "/recipes?q=carrot+%26+pecan",
    );
    expect(recipeBrowseHref(3, "carrot")).toBe("/recipes?q=carrot&page=3");
    expect(recipeBrowseHref(1, "")).toBe("/recipes");
  });

  it("preserves exact category, recipe type, and sort filters", () => {
    expect(
      recipeBrowseHref(2, "toast", {
        category: "quick-easy",
        recipeType: "versions",
        sort: "newest",
      }),
    ).toBe(
      "/recipes?q=toast&category=quick-easy&type=versions&sort=newest&page=2",
    );
  });

  it("parses the public recipe-type filter and maps it to the API query", () => {
    expect(parseRecipeBrowseType("originals")).toBe("originals");
    expect(parseRecipeBrowseType("versions")).toBe("versions");
    expect(parseRecipeBrowseType("all")).toBeUndefined();
    expect(parseRecipeBrowseType(["versions", "originals"])).toBeUndefined();
    expect(isVariantForRecipeBrowseType("originals")).toBe(false);
    expect(isVariantForRecipeBrowseType("versions")).toBe(true);
    expect(isVariantForRecipeBrowseType(undefined)).toBeUndefined();
  });
});
