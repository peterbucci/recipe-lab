export type RecipeBrowseType = "all" | "originals" | "versions";

export function parseRecipeBrowseType(
  value: string | string[] | undefined,
): RecipeBrowseType {
  if (Array.isArray(value)) {
    return "all";
  }
  return value === "originals" || value === "versions" ? value : "all";
}

export function isVariantForRecipeBrowseType(
  recipeType: RecipeBrowseType,
): boolean | undefined {
  if (recipeType === "originals") {
    return false;
  }
  if (recipeType === "versions") {
    return true;
  }
  return undefined;
}

export function recipeBrowseHref(
  page: number,
  query: string,
  recipeType: RecipeBrowseType,
): string {
  const parameters = new URLSearchParams();
  if (query) {
    parameters.set("q", query);
  }
  if (recipeType !== "all") {
    parameters.set("type", recipeType);
  }
  if (page > 1) {
    parameters.set("page", String(page));
  }
  const search = parameters.toString();
  return search ? `/recipes?${search}` : "/recipes";
}
