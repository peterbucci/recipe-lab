import { notFound, redirect } from "next/navigation";

import { isRecipeVersionId } from "../../../../features/recipes/shared/recipe-id";

interface RecipeDraftEditorPageProps {
  params: Promise<{ draftId: string }>;
}

export default async function RecipeDraftEditorPage({ params }: RecipeDraftEditorPageProps) {
  const { draftId } = await params;
  if (!isRecipeVersionId(draftId)) notFound();
  redirect(`/recipes/drafts/${encodeURIComponent(draftId.toLowerCase())}`);
}
