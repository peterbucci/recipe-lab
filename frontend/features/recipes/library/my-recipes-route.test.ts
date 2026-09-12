import { describe, expect, it } from "vitest";

import {
  MY_RECIPE_VIEWS,
  myRecipesHref,
  parseMyRecipesView,
} from "./my-recipes-route";

describe("My recipes route contract", () => {
  it("owns the valid views used by parsing and navigation", () => {
    expect(MY_RECIPE_VIEWS).toEqual([
      "drafts",
      "published",
      "saved",
      "withdrawn",
    ]);
    expect(parseMyRecipesView("published")).toBe("published");
    expect(parseMyRecipesView("private")).toBe("drafts");
  });

  it("builds canonical view links and omits the first page", () => {
    expect(myRecipesHref("saved")).toBe("/account/recipes?view=saved");
    expect(myRecipesHref("saved", 3)).toBe(
      "/account/recipes?view=saved&page=3",
    );
  });
});
