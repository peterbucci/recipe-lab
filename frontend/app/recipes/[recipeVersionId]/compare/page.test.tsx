import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RecipeApiError,
  type RecipeDiff,
} from "../../../../lib/recipe-api";
import RecipeComparePage from "./page";

const mocks = vi.hoisted(() => ({
  fetchRecipeDiff: vi.fn(),
}));

vi.mock("../../../../lib/recipe-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../lib/recipe-api")>();
  return { ...actual, fetchRecipeDiff: mocks.fetchRecipeDiff };
});

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const SELECTED_ID = "22222222-2222-4222-8222-222222222222";

const explicitDiff: RecipeDiff = {
  lineage_id: "33333333-3333-4333-8333-333333333333",
  base_version: {
    id: RECIPE_ID,
    version_number: 1,
    title: "Banana Oat Pancakes",
    author: { id: "base-cook", display_name: "Base Cook", handle: null },
  },
  target_version: {
    id: SELECTED_ID,
    version_number: 2,
    title: "Pecan Banana Oat Pancakes",
    author: { id: "selected-cook", display_name: "Selected Cook", handle: null },
  },
  metadata_changes: [],
  ingredients: { added: [], removed: [], replaced: [], modified: [] },
  ingredient_context: { base: [], target: [] },
  instructions: { added: [], removed: [], modified: [] },
  has_changes: false,
};

describe("RecipeComparePage", () => {
  beforeEach(() => {
    mocks.fetchRecipeDiff.mockReset();
  });

  it("explains when a starting recipe has nothing earlier to compare", async () => {
    mocks.fetchRecipeDiff.mockRejectedValueOnce(
      new RecipeApiError(
        "private implementation detail",
        422,
        "recipe_has_no_parent",
      ),
    );

    render(
      await RecipeComparePage({
        params: Promise.resolve({ recipeVersionId: RECIPE_ID }),
      }),
    );

    expect(
      screen.getByRole("heading", {
        name: "There isn’t an earlier recipe to compare.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This recipe wasn’t based on another recipe, so there are no earlier changes to show.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to recipe" }),
    ).toHaveAttribute("href", `/recipes/${RECIPE_ID}`);
    expect(
      screen.queryByText(/private implementation detail/i),
    ).not.toBeInTheDocument();
  });

  it("compares a selected family recipe with the recipe page it came from", async () => {
    mocks.fetchRecipeDiff.mockResolvedValueOnce(explicitDiff);

    render(
      await RecipeComparePage({
        params: Promise.resolve({ recipeVersionId: SELECTED_ID }),
        searchParams: Promise.resolve({ base_version_id: RECIPE_ID }),
      }),
    );

    expect(mocks.fetchRecipeDiff).toHaveBeenCalledWith(SELECTED_ID, RECIPE_ID);
    expect(
      screen.getByRole("heading", {
        name: "How Pecan Banana Oat Pancakes changed",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "← Banana Oat Pancakes" }),
    ).toHaveAttribute("href", `/recipes/${RECIPE_ID}`);
  });
});
