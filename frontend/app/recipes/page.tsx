import type { Metadata } from "next";

import {
  isVariantForRecipeBrowseType,
  parseRecipeBrowseType,
} from "../../lib/recipe-browse-query";
import { fetchRecipePage } from "../../lib/recipe-api";
import { RecipeBrowser } from "../components/recipe-browser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find something to cook",
  description: "Browse recipes and versions made from them.",
};

interface RecipeBrowsePageProps {
  searchParams: Promise<{
    page?: string | string[];
    q?: string | string[];
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

export default async function RecipeBrowsePage({ searchParams }: RecipeBrowsePageProps) {
  const parameters = await searchParams;
  const query = firstValue(parameters.q).trim();
  const page = pageNumber(parameters.page);
  const recipeType = parseRecipeBrowseType(parameters.type);
  const isVariant = isVariantForRecipeBrowseType(recipeType);
  const data = await fetchRecipePage({ isVariant, page, pageSize: 12, query });

  return (
    <main id="main-content" className="page-shell">
      <RecipeBrowser data={data} query={query} recipeType={recipeType} />
    </main>
  );
}
