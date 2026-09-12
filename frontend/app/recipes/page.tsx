import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  fetchRecipeCategories,
  fetchRecipePage,
} from "../../features/recipes/browse/recipe-browse-server-api";
import type {
  RecipeCategory,
} from "../../features/recipes/shared/recipe-contracts";
import {
  isVariantForRecipeBrowseType,
  parseRecipeBrowseType,
} from "../../features/recipes/browse/recipe-browse-query";
import { RecipeBrowser } from "../../features/recipes/browse/recipe-browser";
import {
  firstQueryValue,
  parseAllowedQueryValue,
  parsePositivePageNumber,
} from "../../shared/navigation/query-params";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore recipes",
  description: "Browse recipes and versions made from them.",
};

interface RecipeBrowsePageProps {
  searchParams: Promise<{
    category?: string | string[];
    page?: string | string[];
    q?: string | string[];
    sort?: string | string[];
    type?: string | string[];
  }>;
}

const RECIPE_BROWSE_SORTS = ["newest", "title"] as const;

function activeCategory(
  slug: string,
  categories: readonly RecipeCategory[],
): RecipeCategory | undefined {
  if (!slug) {
    return undefined;
  }
  const category = categories.find((item) => item.slug === slug);
  if (!category) {
    notFound();
  }
  return category;
}

export default async function RecipeBrowsePage({ searchParams }: RecipeBrowsePageProps) {
  const parameters = await searchParams;
  const categorySlug = firstQueryValue(parameters.category)?.trim() ?? "";
  const query = firstQueryValue(parameters.q)?.trim() ?? "";
  const page = parsePositivePageNumber(parameters.page);
  const sort = parseAllowedQueryValue(
    parameters.sort,
    RECIPE_BROWSE_SORTS,
    "newest",
  );
  const recipeType = parseRecipeBrowseType(parameters.type);
  const [recipeResult, categoryResult] = await Promise.allSettled([
    fetchRecipePage({
      category: categorySlug || undefined,
      isVariant: isVariantForRecipeBrowseType(recipeType),
      page,
      pageSize: 12,
      query,
      sort,
    }),
    fetchRecipeCategories(),
  ]);

  if (recipeResult.status === "rejected") {
    throw recipeResult.reason;
  }

  const categories =
    categoryResult.status === "fulfilled" ? categoryResult.value.items : [];
  const categoriesUnavailable = categoryResult.status === "rejected";
  const category = categoriesUnavailable
    ? undefined
    : activeCategory(categorySlug, categories);

  return (
    <main id="main-content" className="page-shell page-shell--catalog">
      <RecipeBrowser
        categories={categories}
        categoriesUnavailable={categoriesUnavailable}
        category={category}
        categorySlug={categorySlug || undefined}
        data={recipeResult.value}
        query={query}
        recipeType={recipeType}
        sort={sort}
      />
    </main>
  );
}
