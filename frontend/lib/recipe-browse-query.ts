export function recipeBrowseHref(page: number, query: string): string {
  const parameters = new URLSearchParams();
  if (query) {
    parameters.set("q", query);
  }
  if (page > 1) {
    parameters.set("page", String(page));
  }
  const search = parameters.toString();
  return search ? `/recipes?${search}` : "/recipes";
}
