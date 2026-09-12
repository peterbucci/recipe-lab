import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RecipeApiError,
} from "../../../../features/recipes/shared/recipe-api-error";
import type {
  RecipeDetail,
  RecipeDiff,
} from "../../../../features/recipes/shared/recipe-contracts";
import RecipeComparePage from "./page";

const mocks = vi.hoisted(() => ({
  fetchRecipe: vi.fn(),
  fetchRecipeDiff: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

vi.mock("../../../../features/recipes/detail/recipe-detail-server-api", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../../features/recipes/detail/recipe-detail-server-api")
    >();
  return {
    ...actual,
    fetchRecipe: mocks.fetchRecipe,
    fetchRecipeDiff: mocks.fetchRecipeDiff,
  };
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

const explicitRecipe: RecipeDetail = {
  author: explicitDiff.target_version.author,
  categories: [],
  created_at: "2026-08-20T00:00:00Z",
  description: "A nutty version of the original pancakes.",
  id: SELECTED_ID,
  lineage_id: explicitDiff.lineage_id,
  parent: explicitDiff.base_version,
  parent_version_id: RECIPE_ID,
  published_at: "2026-08-21T00:00:00Z",
  servings: "4.00",
  title: explicitDiff.target_version.title,
  version_number: 2,
  average_rating: null,
  rating_count: 0,
  save_count: 0,
  total_time_minutes: 20,
  active_time_minutes: 10,
  difficulty: "easy",
  notes: null,
  viewer_state: null,
  children: [],
  ingredients: [],
  instructions: [],
};

describe("RecipeComparePage", () => {
  beforeEach(() => {
    mocks.fetchRecipe.mockReset();
    mocks.fetchRecipe.mockResolvedValue(explicitRecipe);
    mocks.fetchRecipeDiff.mockReset();
    mocks.notFound.mockClear();
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
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.fetchRecipeDiff).toHaveBeenCalledWith(RECIPE_ID, undefined);
    expect(mocks.fetchRecipe).toHaveBeenCalledWith(RECIPE_ID);
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
    expect(mocks.fetchRecipe).toHaveBeenCalledWith(SELECTED_ID);
    expect(
      screen.getByRole("heading", {
        name: "Pecan Banana Oat Pancakes",
      }),
    ).toBeVisible();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(
      within(breadcrumb).getByRole("link", { name: "Explore" }),
    ).toHaveAttribute("href", "/recipes");
    expect(
      within(breadcrumb).getByRole("link", { name: "Banana Oat Pancakes" }),
    ).toHaveAttribute("href", `/recipes/${RECIPE_ID}`);
    expect(
      within(breadcrumb).getByRole("link", {
        name: "Pecan Banana Oat Pancakes",
      }),
    ).toHaveAttribute("href", `/recipes/${SELECTED_ID}`);
    expect(within(breadcrumb).getByText("Compare")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
  it.each([
    {
      label: "invalid target ID",
      recipeVersionId: "not-a-recipe-id",
      baseVersionId: undefined,
    },
    {
      label: "invalid base ID",
      recipeVersionId: SELECTED_ID,
      baseVersionId: "not-a-recipe-id",
    },
    {
      label: "repeated base query",
      recipeVersionId: SELECTED_ID,
      baseVersionId: [RECIPE_ID],
    },
  ])(
    "uses the not-found boundary for an $label",
    async ({ recipeVersionId, baseVersionId }) => {
      await expect(
        RecipeComparePage({
          params: Promise.resolve({ recipeVersionId }),
          searchParams: Promise.resolve({
            base_version_id: baseVersionId,
          }),
        }),
      ).rejects.toThrow("not-found");

      expect(mocks.notFound).toHaveBeenCalledOnce();
      expect(mocks.fetchRecipe).not.toHaveBeenCalled();
      expect(mocks.fetchRecipeDiff).not.toHaveBeenCalled();
    },
  );

  it("uses the not-found boundary when no comparison exists", async () => {
    mocks.fetchRecipeDiff.mockResolvedValue(null);

    await expect(
      RecipeComparePage({
        params: Promise.resolve({ recipeVersionId: RECIPE_ID }),
      }),
    ).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("uses the not-found boundary when the target recipe is unavailable", async () => {
    mocks.fetchRecipe.mockResolvedValue(null);
    mocks.fetchRecipeDiff.mockResolvedValue(explicitDiff);

    await expect(
      RecipeComparePage({
        params: Promise.resolve({ recipeVersionId: SELECTED_ID }),
      }),
    ).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.fetchRecipe).toHaveBeenCalledWith(SELECTED_ID);
    expect(mocks.fetchRecipeDiff).toHaveBeenCalledWith(SELECTED_ID, undefined);
  });

  it("lets ordinary comparison failures reach the route error boundary", async () => {
    mocks.fetchRecipeDiff.mockRejectedValue(
      new Error("comparison service unavailable"),
    );

    await expect(
      RecipeComparePage({
        params: Promise.resolve({ recipeVersionId: RECIPE_ID }),
      }),
    ).rejects.toThrow("comparison service unavailable");

    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
