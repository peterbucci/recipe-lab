import { describe, expect, it } from "vitest";

import { selectionForCatalogIngredient } from "./ingredient-catalog-selection";

const PECAN_ID = "33333333-3333-4333-8333-333333333333";

describe("ingredient catalog selection", () => {
  it("preserves an exact curated alias as the selected display label", () => {
    expect(
      selectionForCatalogIngredient(
        {
          id: PECAN_ID,
          canonical_name: "Granulated sugar",
          aliases: ["Caster sugar", "White sugar"],
        },
        " white sugar ",
      ),
    ).toEqual({
      ingredientId: PECAN_ID,
      canonicalName: "Granulated sugar",
      displayName: "White sugar",
    });
  });

});
