import type { Metadata } from "next";

import type { MyRecipesHubView } from "../../../features/recipes/library/my-recipes-hub";
import { MyRecipesWorkspace } from "./_components/my-recipes-workspace";

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

function recipeView(value: string | string[] | undefined): MyRecipesHubView {
  const candidate = firstValue(value);
  return candidate === "published" || candidate === "saved" || candidate === "withdrawn"
    ? candidate
    : "drafts";
}

function pageNumber(value: string | string[] | undefined): number {
  const candidate = firstValue(value);
  if (!/^\d+$/.test(candidate)) return 1;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000_000 ? parsed : 1;
}

export default async function MyRecipesPage({ searchParams }: MyRecipesPageProps) {
  const query = await searchParams;
  const view = recipeView(query.view);
  return (
    <MyRecipesWorkspace pageNumber={pageNumber(query.page)} view={view} />
  );
}
