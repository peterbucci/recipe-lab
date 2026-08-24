export type RatingValue = 1 | 2 | 3 | 4 | 5;

export interface RecipeViewerState {
  recipe_version_id: string;
  saved: boolean;
  rating: RatingValue | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRating(value: unknown): value is RatingValue {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function parseRecipeViewerState(value: unknown): RecipeViewerState | null {
  if (value === null) {
    return null;
  }
  const expectedKeys = new Set(["recipe_version_id", "saved", "rating"]);
  if (
    !isRecord(value) ||
    Object.keys(value).length !== expectedKeys.size ||
    Object.keys(value).some((key) => !expectedKeys.has(key)) ||
    typeof value.recipe_version_id !== "string" ||
    typeof value.saved !== "boolean" ||
    (value.rating !== null && !isRating(value.rating))
  ) {
    throw new TypeError("Recipe Lab received an invalid private recipe state.");
  }

  return {
    recipe_version_id: value.recipe_version_id,
    saved: value.saved,
    rating: value.rating,
  };
}
