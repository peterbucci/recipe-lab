import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  fetchRecipe,
  fetchRecipeHistory,
} from "../../../features/recipes/detail/recipe-detail-server-api";
import { isRecipeVersionId } from "../../../features/recipes/shared/recipe-id";
import type { RecipeHistory } from "../../../features/recipes/shared/recipe-history";
import { exactRecipePath } from "../../../features/recipes/shared/recipe-paths";
import { RecipeDetailExperience } from "../_components/recipe-detail-experience";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recipe details",
};

interface RecipeDetailPageProps {
  params: Promise<{ recipeVersionId: string }>;
}

export default async function RecipeDetailPage({
  params,
}: RecipeDetailPageProps) {
  const { recipeVersionId } = await params;
  if (!isRecipeVersionId(recipeVersionId)) {
    notFound();
  }
  const recipe = await fetchRecipe(recipeVersionId);
  if (
    recipe === null ||
    recipe.id.toLowerCase() !== recipeVersionId.toLowerCase()
  ) {
    notFound();
  }

  let history: RecipeHistory | null = null;
  try {
    history = await fetchRecipeHistory(recipe.id);
    if (
      history !== null &&
      (history.selected_version_id.toLowerCase() !== recipe.id.toLowerCase() ||
        history.recipe_id.toLowerCase() !== recipe.recipe_id.toLowerCase())
    ) {
      history = null;
    }
  } catch {
    // Recipe reading remains available when optional public history fails.
  }

  return (
    <RecipeDetailExperience
      history={history}
      publicPath={exactRecipePath(recipe.id)}
      recipe={recipe}
    />
  );
}
