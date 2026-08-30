import { describe, expect, it } from "vitest";

import { recipeBrowseHref } from "./recipe-browse-query";

describe("recipe browse query", () => {
  it("preserves search while omitting an empty query and page one", () => {
    expect(recipeBrowseHref(1, "carrot & pecan")).toBe(
      "/recipes?q=carrot+%26+pecan",
    );
    expect(recipeBrowseHref(3, "carrot")).toBe("/recipes?q=carrot&page=3");
    expect(recipeBrowseHref(1, "")).toBe("/recipes");
  });

  it("preserves exact category and sort filters", () => {
    expect(
      recipeBrowseHref(2, "toast", {
        category: "quick-easy",
        sort: "newest",
      }),
    ).toBe("/recipes?q=toast&category=quick-easy&sort=newest&page=2");
  });
});
