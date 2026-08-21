import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchRecipe, isRecipeVersionId } from "../../../../lib/recipe-api";
import { RecipeVariantEditor } from "../../../components/recipe-variant-editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create a recipe variant",
  description: "Fork a structured recipe into a new child version.",
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

  return (
    <main id="main-content" className="page-shell page-shell--detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href={`/recipes/${encodeURIComponent(recipe.id)}`}>← Back to source recipe</Link>
      </nav>
      <header className="page-intro">
        <p className="eyebrow">New child version</p>
        <h1>Create a variant</h1>
        <p>
          Start with {recipe.title}, then record only the changes you want to make. The source
          recipe stays unchanged.
        </p>
      </header>
      <RecipeVariantEditor sourceRecipe={recipe} />
    </main>
  );
}
