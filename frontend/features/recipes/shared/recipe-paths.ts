import type { RecipePublicationIdentity } from "./recipe-contracts";

export function exactRecipePath(recipeVersionId: string): string {
  return `/recipes/${encodeURIComponent(recipeVersionId)}`;
}

export function currentRecipePath(recipeId: string): string {
  return `/recipes/current/${encodeURIComponent(recipeId)}`;
}

export function ordinaryRecipePath(
  recipe: Pick<RecipePublicationIdentity, "recipe_id">,
): string {
  return currentRecipePath(recipe.recipe_id);
}
