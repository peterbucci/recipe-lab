import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  RecipeApiError,
  fetchRecipeDiff,
  isRecipeVersionId,
  type RecipeDiff,
} from "../../../../lib/recipe-api";
import { RecipeDiffView } from "../../../components/recipe-diff-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What changed",
  description: "See the cooking changes between this recipe and the version it started from.",
};

interface RecipeComparePageProps {
  params: Promise<{ recipeVersionId: string }>;
}

function NoParentComparison({ recipeVersionId }: { recipeVersionId: string }) {
  return (
    <main id="main-content" className="state-page">
      <div className="empty-state empty-state--large">
        <p className="eyebrow">Original recipe</p>
        <h1>This is the starting recipe.</h1>
        <p>
          Comparisons are available on variations, where Recipe Lab shows what changed from the
          version they started from.
        </p>
        <Link
          className="button button--primary"
          href={`/recipes/${encodeURIComponent(recipeVersionId)}`}
        >
          Back to recipe
        </Link>
      </div>
    </main>
  );
}

export default async function RecipeComparePage({ params }: RecipeComparePageProps) {
  const { recipeVersionId } = await params;
  if (!isRecipeVersionId(recipeVersionId)) {
    notFound();
  }

  let diff: RecipeDiff | null;
  try {
    diff = await fetchRecipeDiff(recipeVersionId);
  } catch (error) {
    if (error instanceof RecipeApiError && error.code === "recipe_has_no_parent") {
      return <NoParentComparison recipeVersionId={recipeVersionId} />;
    }
    throw error;
  }

  if (diff === null) {
    notFound();
  }

  return (
    <main id="main-content" className="page-shell page-shell--detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href={`/recipes/${encodeURIComponent(diff.target_version.id)}`}>
          ← {diff.target_version.title}
        </Link>
      </nav>
      <RecipeDiffView diff={diff} />
    </main>
  );
}
