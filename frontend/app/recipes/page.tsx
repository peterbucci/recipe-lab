import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  fetchRecipeCategories,
  fetchRecipePage,
  type RecipeCategory,
} from "../../lib/recipe-api";
import {
  isVariantForRecipeBrowseType,
  parseRecipeBrowseType,
} from "../../lib/recipe-browse-query";
import { RecipeBrowser } from "../components/recipe-browser";

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

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function pageNumber(value: string | string[] | undefined): number {
  const candidate = firstValue(value);
  if (!/^\d+$/.test(candidate)) {
    return 1;
  }
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000_000 ? parsed : 1;
}

function sortValue(value: string | string[] | undefined): "newest" | "title" {
  const candidate = firstValue(value);
  return candidate === "title" ? "title" : "newest";
}

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
  const categorySlug = firstValue(parameters.category).trim();
  const query = firstValue(parameters.q).trim();
  const page = pageNumber(parameters.page);
  const sort = sortValue(parameters.sort);
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
