export type RecipeBrowseType = "originals" | "versions";

export function parseRecipeBrowseType(
  value: string | string[] | undefined,
): RecipeBrowseType | undefined {
  if (Array.isArray(value)) {
    return undefined;
  }
  return value === "originals" || value === "versions" ? value : undefined;
}

export function isVariantForRecipeBrowseType(
  recipeType: RecipeBrowseType | undefined,
): boolean | undefined {
  if (recipeType === "originals") {
    return false;
  }
  if (recipeType === "versions") {
    return true;
  }
  return undefined;
}

export interface RecipeBrowseFilters {
  category?: string;
  recipeType?: RecipeBrowseType;
  sort?: "newest" | "title";
}

export function recipeBrowseHref(
  page: number,
  query: string,
  filters: RecipeBrowseFilters = {},
): string {
  const parameters = new URLSearchParams();
  if (query) {
    parameters.set("q", query);
  }
  if (filters.category) {
    parameters.set("category", filters.category);
  }
  if (filters.recipeType) {
    parameters.set("type", filters.recipeType);
  }
  if (filters.sort) {
    parameters.set("sort", filters.sort);
  }
  if (page > 1) {
    parameters.set("page", String(page));
  }
  const search = parameters.toString();
  return search ? `/recipes?${search}` : "/recipes";
}
