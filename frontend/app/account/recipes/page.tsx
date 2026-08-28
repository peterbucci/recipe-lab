import type { Metadata } from "next";

import type { MyRecipeLibraryView } from "../../../lib/recipe-library-api";
import { MyRecipeLibrary } from "../../components/my-recipe-library";

export const metadata: Metadata = {
  title: "My recipes",
  description: "Find private drafts and manage which published recipes are public.",
};

interface MyRecipesPageProps {
  searchParams: Promise<{
    page?: string | string[];
    view?: string | string[];
  }>;
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function recipeView(value: string | string[] | undefined): MyRecipeLibraryView {
  const candidate = firstValue(value);
  return candidate === "published" || candidate === "withdrawn" ? candidate : "drafts";
}

function pageNumber(value: string | string[] | undefined): number {
  const candidate = firstValue(value);
  if (!/^\d+$/.test(candidate)) return 1;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000_000 ? parsed : 1;
}

export default async function MyRecipesPage({ searchParams }: MyRecipesPageProps) {
  const query = await searchParams;
  return <MyRecipeLibrary pageNumber={pageNumber(query.page)} view={recipeView(query.view)} />;
}
