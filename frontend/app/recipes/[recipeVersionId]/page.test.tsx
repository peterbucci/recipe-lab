import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RecipeCardSummary,
  RecipeDetail,
} from "../../../lib/recipe-api";
import {
  buildRecipeCardSummary,
  buildRecipeSummary,
} from "../../../tests/support/builders/recipe";
import RecipeDetailPage from "./page";

const mocks = vi.hoisted(() => ({
  fetchRecipe: vi.fn(),
  fetchRecipePage: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

vi.mock("../../../lib/recipe-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/recipe-api")>();
  return {
    ...actual,
    fetchRecipe: mocks.fetchRecipe,
    fetchRecipePage: mocks.fetchRecipePage,
  };
});

vi.mock("../../components/recipe-detail-experience", () => ({
  RecipeDetailExperience: ({
    familyVersions,
    recipe,
  }: {
    familyVersions: RecipeCardSummary[];
    recipe: RecipeDetail;
  }) => (
    <article aria-label="Recipe detail">
      <h1>{recipe.title}</h1>
      <ul aria-label="Recipe family">
        {familyVersions.map((version) => (
          <li key={version.id}>{version.title}</li>
        ))}
      </ul>
    </article>
  ),
}));

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const FAMILY_ID = "22222222-2222-4222-8222-222222222222";
const LINEAGE_ID = "33333333-3333-4333-8333-333333333333";

const recipe: RecipeDetail = {
  ...buildRecipeSummary({
    id: RECIPE_ID,
    lineage_id: LINEAGE_ID,
    title: "Banana oat pancakes",
  }),
  active_time_minutes: 15,
  average_rating: 4.5,
  children: [],
  difficulty: "easy",
  ingredients: [],
  instructions: [],
  notes: null,
  rating_count: 2,
  save_count: 7,
  total_time_minutes: 25,
  viewer_state: null,
};

const familyVersion = buildRecipeCardSummary({
  id: FAMILY_ID,
  lineage_id: LINEAGE_ID,
  title: "Pecan banana oat pancakes",
  version_number: 2,
});

describe("RecipeDetailPage", () => {
  beforeEach(() => {
    mocks.fetchRecipe.mockReset();
    mocks.fetchRecipePage.mockReset();
    mocks.notFound.mockClear();
  });

  it("loads the recipe family and renders the public detail", async () => {
    mocks.fetchRecipe.mockResolvedValue(recipe);
    mocks.fetchRecipePage.mockResolvedValue({
      items: [familyVersion],
      page: 1,
      page_size: 100,
      total: 1,
      total_pages: 1,
    });

    render(
      await RecipeDetailPage({
        params: Promise.resolve({ recipeVersionId: RECIPE_ID }),
      }),
    );

    expect(mocks.fetchRecipe).toHaveBeenCalledWith(RECIPE_ID);
    expect(mocks.fetchRecipePage).toHaveBeenCalledWith({
      lineageId: LINEAGE_ID,
      pageSize: 100,
      sort: "title",
    });
    expect(
      screen.getByRole("heading", {
        name: "Banana oat pancakes",
        level: 1,
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("list", { name: "Recipe family" })).getByText(
        "Pecan banana oat pancakes",
      ),
    ).toBeVisible();
  });

  it("keeps the recipe available when the optional family request fails", async () => {
    mocks.fetchRecipe.mockResolvedValue(recipe);
    mocks.fetchRecipePage.mockRejectedValue(
      new Error("family service unavailable"),
    );

    render(
      await RecipeDetailPage({
        params: Promise.resolve({ recipeVersionId: RECIPE_ID }),
      }),
    );

    expect(
      screen.getByRole("heading", {
        name: "Banana oat pancakes",
        level: 1,
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("list", { name: "Recipe family" })).queryAllByRole(
        "listitem",
      ),
    ).toEqual([]);
  });

  it("rejects an invalid recipe ID before fetching public data", async () => {
    await expect(
      RecipeDetailPage({
        params: Promise.resolve({ recipeVersionId: "not-a-recipe-id" }),
      }),
    ).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.fetchRecipe).not.toHaveBeenCalled();
    expect(mocks.fetchRecipePage).not.toHaveBeenCalled();
  });

  it("uses the not-found boundary for a missing recipe", async () => {
    mocks.fetchRecipe.mockResolvedValue(null);

    await expect(
      RecipeDetailPage({
        params: Promise.resolve({ recipeVersionId: RECIPE_ID }),
      }),
    ).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.fetchRecipePage).not.toHaveBeenCalled();
  });

  it("lets ordinary detail failures reach the route error boundary", async () => {
    mocks.fetchRecipe.mockRejectedValue(new Error("recipe service unavailable"));

    await expect(
      RecipeDetailPage({
        params: Promise.resolve({ recipeVersionId: RECIPE_ID }),
      }),
    ).rejects.toThrow("recipe service unavailable");

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.fetchRecipePage).not.toHaveBeenCalled();
  });
});
