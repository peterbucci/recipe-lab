import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  fetchRecipeCategories,
  fetchRecipePage,
  type RecipeCategory,
} from "../../lib/recipe-api";
import { RecipeBrowser } from "../components/recipe-browser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find something to cook",
  description: "Browse recipes and versions made from them.",
};

interface RecipeBrowsePageProps {
  searchParams: Promise<{
    category?: string | string[];
    page?: string | string[];
    q?: string | string[];
    sort?: string | string[];
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

function sortValue(value: string | string[] | undefined): "newest" | "title" | undefined {
  const candidate = firstValue(value);
  return candidate === "newest" || candidate === "title" ? candidate : undefined;
}

async function activeCategory(slug: string): Promise<RecipeCategory | undefined> {
  if (!slug) {
    return undefined;
  }
  const categories = await fetchRecipeCategories();
  const category = categories.items.find((item) => item.slug === slug);
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
  const category = await activeCategory(categorySlug);
  const data = await fetchRecipePage({
    category: category?.slug,
    page,
    pageSize: 12,
    query,
    sort,
  });

  return (
    <main id="main-content" className="page-shell page-shell--catalog">
      <RecipeBrowser category={category} data={data} query={query} sort={sort} />
    </main>
  );
}
