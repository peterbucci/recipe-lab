import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  RecipeApiError,
} from "../../../../features/recipes/shared/recipe-api-error";
import {
  fetchRecipe,
  fetchRecipeDiff,
} from "../../../../features/recipes/detail/recipe-detail-server-api";
import { fetchRecipePage } from "../../../../features/recipes/browse/recipe-browse-server-api";
import type {
  RecipeCardSummary,
  RecipeDetail,
  RecipeDiff,
} from "../../../../features/recipes/shared/recipe-contracts";
import { isRecipeVersionId } from "../../../../features/recipes/shared/recipe-id";
import { buildRecipeComparisonModel } from "../../../../features/recipes/detail/recipe-comparison-model";
import { RecipeDiffView } from "../../../../features/recipes/detail/recipe-diff-view";
import { StatePage, StatePanel } from "../../../../shared/ui/state-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What changed",
  description:
    "See the cooking changes between this recipe and the version it started from.",
};

interface RecipeComparePageProps {
  params: Promise<{ recipeVersionId: string }>;
  searchParams?: Promise<{ base_version_id?: string | string[] }>;
}

function NoParentComparison({ recipeVersionId }: { recipeVersionId: string }) {
  return (
    <StatePage>
      <StatePanel
        actions={
          <Link
            className="button button--primary"
            href={`/recipes/${encodeURIComponent(recipeVersionId)}`}
          >
            Back to recipe
          </Link>
        }
        className="state-panel--wide state-panel--large"
        description="This recipe wasn’t based on another recipe, so there are no earlier changes to show."
        eyebrow="Starting recipe"
        headingId="recipe-comparison-no-parent-title"
        title="There isn’t an earlier recipe to compare."
      />
    </StatePage>
  );
}

export default async function RecipeComparePage({
  params,
  searchParams = Promise.resolve({}),
}: RecipeComparePageProps) {
  const { recipeVersionId } = await params;
  const requestedBaseVersionId = (await searchParams).base_version_id;
  const baseVersionId =
    typeof requestedBaseVersionId === "string"
      ? requestedBaseVersionId
      : undefined;
  if (!isRecipeVersionId(recipeVersionId)) {
    notFound();
  }
  if (
    requestedBaseVersionId !== undefined &&
    (baseVersionId === undefined || !isRecipeVersionId(baseVersionId))
  ) {
    notFound();
  }

  let recipe: RecipeDetail | null;
  let diff: RecipeDiff | null;
  try {
    [recipe, diff] = await Promise.all([
      fetchRecipe(recipeVersionId),
      fetchRecipeDiff(recipeVersionId, baseVersionId),
    ]);
  } catch (error) {
    if (
      error instanceof RecipeApiError &&
      error.code === "recipe_has_no_parent"
    ) {
      return <NoParentComparison recipeVersionId={recipeVersionId} />;
    }
    throw error;
  }

  if (recipe === null || diff === null) {
    notFound();
  }

  const comparison = buildRecipeComparisonModel(recipe, diff);
  let familyVersions: RecipeCardSummary[] = [];
  try {
    const familyPage = await fetchRecipePage({
      lineageId: recipe.lineage_id,
      pageSize: 100,
      sort: "title",
    });
    familyVersions = [...familyPage.items];
  } catch {
    // The detail response still carries bounded parent/current/children
    // context when the full lineage browse is unavailable.
  }

  return (
    <main
      id="main-content"
      className="page-shell page-shell--detail recipe-comparison-page"
    >
      <nav
        className="breadcrumb recipe-detail-breadcrumb"
        aria-label="Breadcrumb"
      >
        <Link href="/recipes">Explore</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/recipes/${encodeURIComponent(diff.base_version.id)}`}>
          {diff.base_version.title}
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/recipes/${encodeURIComponent(recipe.id)}`}>
          {recipe.title}
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Compare</span>
      </nav>
      <RecipeDiffView
        comparison={comparison}
        familyVersions={familyVersions}
      />
    </main>
  );
}
