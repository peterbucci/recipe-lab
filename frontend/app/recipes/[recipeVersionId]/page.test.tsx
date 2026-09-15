import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeDetail } from "../../../features/recipes/shared/recipe-contracts";
import type { RecipeHistory } from "../../../features/recipes/shared/recipe-history";
import { buildRecipeSummary } from "../../../features/recipes/shared/recipe-test-support";
import RecipeDetailPage from "./page";

const mocks = vi.hoisted(() => ({
  fetchRecipe: vi.fn(),
  fetchRecipeHistory: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("../../../features/recipes/detail/recipe-detail-server-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/recipes/detail/recipe-detail-server-api")>()),
  fetchRecipe: mocks.fetchRecipe,
  fetchRecipeHistory: mocks.fetchRecipeHistory,
}));
vi.mock("../_components/recipe-detail-experience", () => ({
  RecipeDetailExperience: ({ history, publicPath, recipe }: {
    history: RecipeHistory | null;
    publicPath: string;
    recipe: RecipeDetail;
  }) => (
    <article aria-label="Recipe detail">
      <h1>{recipe.title}</h1>
      <p>{publicPath}</p>
      <p>{history ? "History available" : "History unavailable"}</p>
    </article>
  ),
}));

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const STABLE_ID = "22222222-2222-4222-8222-222222222222";
const recipe: RecipeDetail = {
  ...buildRecipeSummary({ id: RECIPE_ID, recipe_id: STABLE_ID, title: "Banana oat pancakes" }),
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
const history = {
  adaptations: [],
  adaptations_truncated: false,
  current_version_id: RECIPE_ID,
  editions: [],
  editions_truncated: false,
  recipe_id: STABLE_ID,
  selected_version_id: RECIPE_ID,
} satisfies RecipeHistory;

describe("RecipeDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRecipe.mockResolvedValue(recipe);
    mocks.fetchRecipeHistory.mockResolvedValue(history);
  });

  it("loads dedicated history and preserves the exact route identity", async () => {
    render(await RecipeDetailPage({ params: Promise.resolve({ recipeVersionId: RECIPE_ID }) }));
    expect(mocks.fetchRecipe).toHaveBeenCalledWith(RECIPE_ID);
    expect(mocks.fetchRecipeHistory).toHaveBeenCalledWith(RECIPE_ID);
    expect(screen.getByRole("heading", { name: recipe.title })).toBeVisible();
    expect(screen.getByText(`/recipes/${RECIPE_ID}`)).toBeVisible();
    expect(screen.getByText("History available")).toBeVisible();
  });

  it("keeps the exact recipe available when optional history fails", async () => {
    mocks.fetchRecipeHistory.mockRejectedValue(new Error("history unavailable"));
    render(await RecipeDetailPage({ params: Promise.resolve({ recipeVersionId: RECIPE_ID }) }));
    expect(screen.getByText("History unavailable")).toBeVisible();
  });

  it("rejects an invalid ID before fetching", async () => {
    await expect(RecipeDetailPage({ params: Promise.resolve({ recipeVersionId: "invalid" }) })).rejects.toThrow("not-found");
    expect(mocks.fetchRecipe).not.toHaveBeenCalled();
  });

  it("uses not found for a missing exact recipe", async () => {
    mocks.fetchRecipe.mockResolvedValue(null);
    await expect(RecipeDetailPage({ params: Promise.resolve({ recipeVersionId: RECIPE_ID }) })).rejects.toThrow("not-found");
    expect(mocks.fetchRecipeHistory).not.toHaveBeenCalled();
  });

  it("lets ordinary detail failures reach the route error boundary", async () => {
    mocks.fetchRecipe.mockRejectedValue(new Error("recipe service unavailable"));
    await expect(RecipeDetailPage({ params: Promise.resolve({ recipeVersionId: RECIPE_ID }) })).rejects.toThrow("recipe service unavailable");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
