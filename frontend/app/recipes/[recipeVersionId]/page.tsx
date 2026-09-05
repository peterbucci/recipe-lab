import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  fetchRecipe,
  fetchRecipePage,
  isRecipeVersionId,
  type RecipeCardSummary,
} from "../../../lib/recipe-api";
import { RecipeDetailExperience } from "../../components/recipe-detail-experience";

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
  if (recipe === null) {
    notFound();
  }

  let familyVersions: RecipeCardSummary[] = [];
  try {
    const familyPage = await fetchRecipePage({
      lineageId: recipe.lineage_id,
      pageSize: 100,
      sort: "title",
    });
    familyVersions = [...familyPage.items];
  } catch {
    // The detail response still carries enough bounded context for a useful
    // parent/current/children fallback when the lineage browse is unavailable.
  }

  return (
    <RecipeDetailExperience
      familyVersions={familyVersions}
      recipe={recipe}
    />
  );
}
