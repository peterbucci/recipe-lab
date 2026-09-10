import type { MyRecipeLibraryView } from "./recipe-library-model";

export type MyRecipesHubView = MyRecipeLibraryView | "saved";

export function myRecipesHref(view: MyRecipesHubView, page = 1): string {
  const query = new URLSearchParams({ view });
  if (page > 1) query.set("page", String(page));
  return `/account/recipes?${query.toString()}`;
}
