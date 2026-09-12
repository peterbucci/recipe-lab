import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  comparisonModel,
  mixedDiff,
  sectionNamed,
  targetRecipeDetail,
} from "./recipe-diff-view-test-support";
import { RecipeDiffView } from "./recipe-diff-view";

describe("RecipeDiffView ingredient integration", () => {
  it("renders the complete comparison ingredient list in the recipe flow", () => {
    const diff = mixedDiff();
    const currentIngredients = [
      ...diff.ingredients.modified.map((change) => change.after),
      ...diff.ingredients.replaced.map((change) => change.after),
      ...diff.ingredients.added,
    ];
    const recipe = targetRecipeDetail(diff, {
      ingredients: currentIngredients,
    });

    render(<RecipeDiffView comparison={comparisonModel(diff, recipe)} />);

    const ingredients = sectionNamed("Ingredients");
    expect(within(ingredients).getByText("4 ingredient changes")).toBeVisible();
    expect(
      ingredients.querySelectorAll(".recipe-comparison-ingredient-row"),
    ).toHaveLength(4);
    expect(within(ingredients).getByText("Pecan").closest("ins")).not.toBeNull();
    expect(within(ingredients).getByText("Walnut").closest("del")).not.toBeNull();
    expect(
      within(ingredients).getByText("Orange zest").closest("ins"),
    ).not.toBeNull();
    expect(
      within(ingredients).getByText("Baking soda").closest("del"),
    ).not.toBeNull();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Ingredient changes" }),
    ).not.toBeInTheDocument();
  });
});
