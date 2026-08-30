export interface RecipeBrowseFilters {
  category?: string;
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
  if (filters.sort) {
    parameters.set("sort", filters.sort);
  }
  if (page > 1) {
    parameters.set("page", String(page));
  }
  const search = parameters.toString();
  return search ? `/recipes?${search}` : "/recipes";
}
