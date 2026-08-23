import { describe, expect, it } from "vitest";

import {
  isVariantForRecipeBrowseType,
  parseRecipeBrowseType,
  recipeBrowseHref,
} from "./recipe-browse-query";

describe("recipe browse query", () => {
  it("accepts the documented recipe types and defaults unknown values to all", () => {
    expect(parseRecipeBrowseType("originals")).toBe("originals");
    expect(parseRecipeBrowseType("versions")).toBe("versions");
    expect(parseRecipeBrowseType("anything-else")).toBe("all");
    expect(parseRecipeBrowseType("")).toBe("all");
    expect(parseRecipeBrowseType(undefined)).toBe("all");
    expect(parseRecipeBrowseType(["versions", "originals"])).toBe("all");
    expect(parseRecipeBrowseType(["originals", "versions"])).toBe("all");
    expect(parseRecipeBrowseType(["versions", "versions"])).toBe("all");
    expect(parseRecipeBrowseType(["bogus", "versions"])).toBe("all");
  });

  it("maps frontend recipe types to the backend variant filter", () => {
    expect(isVariantForRecipeBrowseType("all")).toBeUndefined();
    expect(isVariantForRecipeBrowseType("originals")).toBe(false);
    expect(isVariantForRecipeBrowseType("versions")).toBe(true);
  });

  it("preserves search and type while omitting page one", () => {
    expect(recipeBrowseHref(1, "carrot & pecan", "versions")).toBe(
      "/recipes?q=carrot+%26+pecan&type=versions",
    );
    expect(recipeBrowseHref(3, "carrot", "originals")).toBe(
      "/recipes?q=carrot&type=originals&page=3",
    );
    expect(recipeBrowseHref(1, "", "all")).toBe("/recipes");
  });
});
