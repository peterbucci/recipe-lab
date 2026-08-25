import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { fetchCookingActionTypes } from "../../../../lib/cooking-action-api";
import { fetchRecipe, isRecipeVersionId } from "../../../../lib/recipe-api";
import { fetchMeasurementUnits } from "../../../../lib/measurement-unit-api";
import { RecipeForkGate } from "../../../components/recipe-fork-gate";
import { RecipeVariantEditor } from "../../../components/recipe-variant-editor";

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

  const [
    recipe,
    ingredientUnits,
    durationUnits,
    temperatureUnits,
    actionTypes,
  ] = await Promise.all([
    fetchRecipe(recipeVersionId),
    fetchMeasurementUnits("ingredient_amount"),
    fetchMeasurementUnits("action_duration"),
    fetchMeasurementUnits("temperature"),
    fetchCookingActionTypes(),
  ]);
  if (recipe === null) {
    notFound();
  }

  const measurementUnits = Array.from(
    new Map(
      [...ingredientUnits, ...durationUnits, ...temperatureUnits].map((unit) => [
        unit.id,
        unit,
      ]),
    ).values(),
  );

  return (
    <RecipeForkGate recipeTitle={recipe.title} recipeVersionId={recipe.id}>
      <main id="main-content" className="page-shell page-shell--detail">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href={`/recipes/${encodeURIComponent(recipe.id)}`}>
            ← Back to {recipe.title}
          </Link>
        </nav>
        <header className="page-intro page-intro--editor">
          <p className="eyebrow">Start with {recipe.title}</p>
          <h1>Make this recipe your own.</h1>
          <p>
            Change only what you want. The recipe you started from stays unchanged, and your
            version stays connected to it.
          </p>
        </header>
        <RecipeVariantEditor
          sourceRecipe={recipe}
          measurementUnits={measurementUnits}
          actionTypes={actionTypes}
        />
      </main>
    </RecipeForkGate>
  );
}
