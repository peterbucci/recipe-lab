import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchRecipe, isRecipeVersionId } from "../../../../lib/recipe-api";
import { RecipeDraftStarter } from "../../../components/recipe-draft-starter";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Make your own version",
  description: "Start with a recipe you like and change only what you want.",
};

interface RecipeVariantPageProps {
  params: Promise<{ recipeVersionId: string }>;
}

export default async function RecipeVariantPage({ params }: RecipeVariantPageProps) {
  const { recipeVersionId } = await params;
  if (!isRecipeVersionId(recipeVersionId)) {
    notFound();
  }

  const recipe = await fetchRecipe(recipeVersionId);
  if (recipe === null) {
    notFound();
  }

  return <RecipeDraftStarter recipeTitle={recipe.title} sourceVersionId={recipe.id} />;
}
