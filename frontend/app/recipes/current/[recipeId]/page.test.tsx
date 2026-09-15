import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeDetail } from "../../../../features/recipes/shared/recipe-contracts";
import type { RecipeHistory } from "../../../../features/recipes/shared/recipe-history";
import { buildRecipeSummary } from "../../../../features/recipes/shared/recipe-test-support";
import CurrentRecipePage from "./page";

const mocks = vi.hoisted(() => ({
  fetchCurrentRecipe: vi.fn(),
  fetchRecipeHistory: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("../../../../features/recipes/detail/recipe-detail-server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../features/recipes/detail/recipe-detail-server-api")>()),
  fetchCurrentRecipe: mocks.fetchCurrentRecipe,
  fetchRecipeHistory: mocks.fetchRecipeHistory,
}));
vi.mock("../../_components/recipe-detail-experience", () => ({
  RecipeDetailExperience: ({ history, publicPath, recipe }: {
    history: RecipeHistory | null;
    publicPath: string;
    recipe: RecipeDetail;
  }) => (
    <article aria-label="Current recipe detail">
      <h1>{recipe.title}</h1>
      <p>{publicPath}</p>
      <p>{history ? "History available" : "History unavailable"}</p>
    </article>
  ),
}));

const STABLE_ID = "11111111-1111-4111-8111-111111111111";
const EXACT_ID = "22222222-2222-4222-8222-222222222222";
const recipe: RecipeDetail = {
  ...buildRecipeSummary({ id: EXACT_ID, recipe_id: STABLE_ID, title: "Current pancakes" }),
  active_time_minutes: null,
  average_rating: null,
  children: [],
  difficulty: null,
  ingredients: [],
  instructions: [],
  notes: null,
  rating_count: 0,
  save_count: 0,
  total_time_minutes: null,
  viewer_state: null,
};

describe("CurrentRecipePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCurrentRecipe.mockResolvedValue(recipe);
    mocks.fetchRecipeHistory.mockResolvedValue({
      adaptations: [],
      adaptations_truncated: false,
      current_version_id: EXACT_ID,
      editions: [],
      editions_truncated: false,
      recipe_id: STABLE_ID,
      selected_version_id: EXACT_ID,
    });
  });

  it("resolves the stable ID server-side and preserves the stable route identity", async () => {
    render(await CurrentRecipePage({ params: Promise.resolve({ recipeId: STABLE_ID }) }));
    expect(mocks.fetchCurrentRecipe).toHaveBeenCalledWith(STABLE_ID);
    expect(mocks.fetchRecipeHistory).toHaveBeenCalledWith(EXACT_ID);
    expect(screen.getByText(`/recipes/current/${STABLE_ID}`)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Current pancakes" })).toBeVisible();
  });

  it("keeps current detail available when optional history fails", async () => {
    mocks.fetchRecipeHistory.mockRejectedValue(new Error("history unavailable"));
    render(await CurrentRecipePage({ params: Promise.resolve({ recipeId: STABLE_ID }) }));
    expect(screen.getByText("History unavailable")).toBeVisible();
  });

  it("rejects invalid stable IDs before fetching", async () => {
    await expect(CurrentRecipePage({ params: Promise.resolve({ recipeId: "invalid" }) })).rejects.toThrow("not-found");
    expect(mocks.fetchCurrentRecipe).not.toHaveBeenCalled();
  });

  it("does not render a response for a different stable recipe", async () => {
    mocks.fetchCurrentRecipe.mockResolvedValue({ ...recipe, recipe_id: "33333333-3333-4333-8333-333333333333" });
    await expect(CurrentRecipePage({ params: Promise.resolve({ recipeId: STABLE_ID }) })).rejects.toThrow("not-found");
    expect(mocks.fetchRecipeHistory).not.toHaveBeenCalled();
  });

  it("does not render a non-current response at the stable route", async () => {
    mocks.fetchCurrentRecipe.mockResolvedValue({ ...recipe, is_current: false });

    await expect(
      CurrentRecipePage({ params: Promise.resolve({ recipeId: STABLE_ID }) }),
    ).rejects.toThrow("not-found");
    expect(mocks.fetchRecipeHistory).not.toHaveBeenCalled();
  });

  it("drops history whose current identity does not match the stable response", async () => {
    mocks.fetchRecipeHistory.mockResolvedValue({
      adaptations: [],
      adaptations_truncated: false,
      current_version_id: "33333333-3333-4333-8333-333333333333",
      editions: [],
      editions_truncated: false,
      recipe_id: STABLE_ID,
      selected_version_id: EXACT_ID,
    });

    render(
      await CurrentRecipePage({
        params: Promise.resolve({ recipeId: STABLE_ID }),
      }),
    );

    expect(screen.getByText("History unavailable")).toBeVisible();
  });
});
