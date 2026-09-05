import type {
  PublicUserReference,
  RecipeCardSummary,
  RecipeSummary,
  RecipeVersionReference,
} from "./recipe-contracts";
import {
  MAX_RECIPE_CATEGORIES,
  parseRecipeCategories,
} from "./recipe-category";

const DEMO_COOK_ID = "1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9";
const DEMO_COOK_DISPLAY_NAME = "Demo Cook";

export function isRecipeRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRecipeUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function isRecipeTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isBoundedRecipeText(
  value: unknown,
  maximum: number,
  allowBlank = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (allowBlank || value.trim().length > 0)
  );
}

export function parsePublicUserReference(
  value: unknown,
): PublicUserReference | null {
  if (
    !isRecipeRecord(value) ||
    !isRecipeUuid(value.id) ||
    !isBoundedRecipeText(value.display_name, 120)
  ) {
    return null;
  }
  if (
    value.handle !== null &&
    (!isBoundedRecipeText(value.handle, 30) ||
      !/^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/.test(value.handle))
  ) {
    return null;
  }
  if (value.handle === null) {
    const isDeletedCook = value.display_name === "Deleted cook";
    const isDemoCook =
      value.id === DEMO_COOK_ID &&
      value.display_name === DEMO_COOK_DISPLAY_NAME;
    if (!isDeletedCook && !isDemoCook) return null;
  }
  return {
    id: value.id,
    handle: value.handle as string | null,
    display_name: value.display_name,
  };
}

function parseVersionReference(
  value: unknown,
): RecipeVersionReference | null {
  if (
    !isRecipeRecord(value) ||
    !isRecipeUuid(value.id) ||
    !Number.isInteger(value.version_number) ||
    (value.version_number as number) < 1 ||
    !isBoundedRecipeText(value.title, 200)
  ) {
    return null;
  }
  const author = parsePublicUserReference(value.author);
  if (!author) return null;
  return {
    id: value.id,
    version_number: value.version_number as number,
    title: value.title,
    author,
  };
}

export function parseRecipeSummary(value: unknown): RecipeSummary | null {
  if (
    !isRecipeRecord(value) ||
    !isRecipeUuid(value.id) ||
    !isRecipeUuid(value.lineage_id) ||
    (value.parent_version_id !== null && !isRecipeUuid(value.parent_version_id)) ||
    !Number.isInteger(value.version_number) ||
    (value.version_number as number) < 1 ||
    !isBoundedRecipeText(value.title, 200) ||
    (value.description !== null && !isBoundedRecipeText(value.description, 2_000)) ||
    !isBoundedRecipeText(value.servings, 64) ||
    !isRecipeTimestamp(value.created_at) ||
    !isRecipeTimestamp(value.published_at)
  ) {
    return null;
  }
  const author = parsePublicUserReference(value.author);
  const parent = value.parent === null ? null : parseVersionReference(value.parent);
  const categories = parseRecipeCategories(value.categories, MAX_RECIPE_CATEGORIES);
  if (
    !author ||
    !categories ||
    (value.parent !== null && !parent) ||
    (value.parent_version_id === null && parent !== null) ||
    (parent && parent.id !== value.parent_version_id)
  ) {
    return null;
  }
  return {
    id: value.id,
    lineage_id: value.lineage_id,
    parent_version_id: value.parent_version_id as string | null,
    version_number: value.version_number as number,
    title: value.title,
    description: value.description as string | null,
    servings: value.servings,
    created_at: value.created_at,
    published_at: value.published_at,
    author,
    parent,
    categories,
  };
}

export function parseRecipeCardSummary(
  value: unknown,
): RecipeCardSummary | null {
  const recipe = parseRecipeSummary(value);
  if (
    recipe === null ||
    !isRecipeRecord(value) ||
    (value.average_rating !== null &&
      (typeof value.average_rating !== "number" ||
        !Number.isFinite(value.average_rating) ||
        value.average_rating < 1 ||
        value.average_rating > 5)) ||
    !Number.isInteger(value.rating_count) ||
    (value.rating_count as number) < 0 ||
    !Number.isInteger(value.save_count) ||
    (value.save_count as number) < 0
  ) {
    return null;
  }
  return {
    ...recipe,
    average_rating: value.average_rating as number | null,
    rating_count: value.rating_count as number,
    save_count: value.save_count as number,
  };
}
