import type { Metadata } from "next";

import { fetchRecipePage } from "../../lib/recipe-api";
import { RecipeBrowser } from "../components/recipe-browser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Browse recipes",
  description: "Browse and search structured recipe originals and variants.",
};

interface RecipeBrowsePageProps {
  searchParams: Promise<{
    page?: string | string[];
    q?: string | string[];
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
  const data = await fetchRecipePage({ page, pageSize: 12, query });

  return (
    <main id="main-content" className="page-shell">
      <RecipeBrowser data={data} query={query} />
    </main>
  );
}
