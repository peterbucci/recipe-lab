import type {
  RecipeCardSummary,
  RecipeSummary,
} from "../../lib/recipe-api";

export function buildRecipeSummary(
  overrides: Partial<RecipeSummary> = {},
): RecipeSummary {
  return {
    author: {
      display_name: "Alice Cook",
      handle: "alice",
      id: "cook-one",
    },
    categories: [],
    created_at: "2026-08-20T00:00:00Z",
    description: null,
    id: "recipe-one",
    lineage_id: "lineage-one",
    parent: null,
    parent_version_id: null,
    published_at: "2026-08-21T00:00:00Z",
    servings: "4.00",
    title: "Test recipe",
    version_number: 1,
    ...overrides,
  };
}

export function buildRecipeCardSummary(
  overrides: Partial<RecipeCardSummary> = {},
): RecipeCardSummary {
  return {
    ...buildRecipeSummary(),
    average_rating: null,
    rating_count: 0,
    save_count: 0,
    ...overrides,
  };
}
