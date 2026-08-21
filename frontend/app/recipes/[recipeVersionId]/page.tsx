import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchRecipe, isRecipeVersionId } from "../../../lib/recipe-api";
import { RecipeDetailView } from "../../components/recipe-detail-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recipe details",
};

interface RecipeDetailPageProps {
  params: Promise<{ recipeVersionId: string }>;
}

export default async function RecipeDetailPage({ params }: RecipeDetailPageProps) {
  const { recipeVersionId } = await params;
  if (!isRecipeVersionId(recipeVersionId)) {
    notFound();
  }
  const recipe = await fetchRecipe(recipeVersionId);
  if (recipe === null) {
    notFound();
  }

  return (
    <main id="main-content" className="page-shell page-shell--detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/recipes">← Back to all recipes</Link>
      </nav>
      <RecipeDetailView recipe={recipe} />
    </main>
  );
}
