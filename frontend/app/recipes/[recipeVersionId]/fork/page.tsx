import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isRecipeVersionId } from "../../../../lib/recipe-api";
import { RecipeDraftStarter } from "../../../components/recipe-draft-starter";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Make your own version",
  description: "Start with a recipe you like and change only what you want.",
};

interface RecipeForkPageProps {
  params: Promise<{ recipeVersionId: string }>;
}

export default async function RecipeForkPage({ params }: RecipeForkPageProps) {
  const { recipeVersionId } = await params;
  if (!isRecipeVersionId(recipeVersionId)) {
    notFound();
  }

  return <RecipeDraftStarter sourceVersionId={recipeVersionId.toLowerCase()} />;
}
