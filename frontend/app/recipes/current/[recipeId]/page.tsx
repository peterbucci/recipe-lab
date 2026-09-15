import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  fetchCurrentRecipe,
  fetchRecipeHistory,
} from "../../../../features/recipes/detail/recipe-detail-server-api";
import { isRecipeVersionId } from "../../../../features/recipes/shared/recipe-id";
import type { RecipeHistory } from "../../../../features/recipes/shared/recipe-history";
import { currentRecipePath } from "../../../../features/recipes/shared/recipe-paths";
import { RecipeDetailExperience } from "../../_components/recipe-detail-experience";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recipe details",
};

interface CurrentRecipePageProps {
  params: Promise<{ recipeId: string }>;
}

export default async function CurrentRecipePage({ params }: CurrentRecipePageProps) {
  const { recipeId } = await params;
  if (!isRecipeVersionId(recipeId)) notFound();

  const recipe = await fetchCurrentRecipe(recipeId);
  if (
    recipe === null ||
    recipe.recipe_id.toLowerCase() !== recipeId.toLowerCase() ||
    !recipe.is_current
  ) {
    notFound();
  }

  let history: RecipeHistory | null = null;
  try {
    history = await fetchRecipeHistory(recipe.id);
    if (
      history !== null &&
      (history.selected_version_id.toLowerCase() !== recipe.id.toLowerCase() ||
        history.recipe_id.toLowerCase() !== recipe.recipe_id.toLowerCase() ||
        history.current_version_id?.toLowerCase() !== recipe.id.toLowerCase())
    ) {
      history = null;
    }
  } catch {
    // Recipe reading remains available when optional public history fails.
  }

  return (
    <RecipeDetailExperience
      history={history}
      publicPath={currentRecipePath(recipe.recipe_id)}
      recipe={recipe}
    />
  );
}
