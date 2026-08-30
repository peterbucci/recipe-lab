import type { RecipeCategory } from "./recipe-api";

export const MAX_RECIPE_CATEGORIES = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    value.trim().length > 0
  );
}

export function parseRecipeCategory(value: unknown): RecipeCategory | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isBoundedText(value.name, 80) ||
    !isBoundedText(value.slug, 64) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
  };
}

export function parseRecipeCategories(
  value: unknown,
  maximum = Number.POSITIVE_INFINITY,
): RecipeCategory[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;

  const categories = value.map(parseRecipeCategory);
  if (categories.some((category) => category === null)) return null;

  const parsed = categories as RecipeCategory[];
  const ids = new Set(parsed.map((category) => category.id));
  const slugs = new Set(parsed.map((category) => category.slug));
  return ids.size === parsed.length && slugs.size === parsed.length
    ? parsed
    : null;
}
