import type { MyRecipeLibraryView } from "./recipe-library-model";
import {
  parseAllowedQueryValue,
  type QueryParamValue,
} from "../../../shared/navigation/query-params";

export const MY_RECIPE_VIEWS = [
  "drafts",
  "published",
  "saved",
  "withdrawn",
] as const satisfies readonly (MyRecipeLibraryView | "saved")[];

export type MyRecipesHubView = (typeof MY_RECIPE_VIEWS)[number];

export function parseMyRecipesView(value: QueryParamValue): MyRecipesHubView {
  return parseAllowedQueryValue(value, MY_RECIPE_VIEWS, "drafts");
}

export function myRecipesHref(view: MyRecipesHubView, page = 1): string {
  const query = new URLSearchParams({ view });
  if (page > 1) query.set("page", String(page));
  return `/account/recipes?${query.toString()}`;
}
