"use client";

import { useAuthSession } from "./auth-session-provider";
import { RecipeReportPanel } from "./recipe-report-panel";

interface RecipeReportAccessProps {
  recipeVersionId: string;
}

export function RecipeReportAccess({
  recipeVersionId,
}: RecipeReportAccessProps) {
  const { state } = useAuthSession();

  if (
    state.phase !== "ready" ||
    state.session.status !== "authenticated"
  ) {
    return null;
  }

  return (
    <RecipeReportPanel
      key={`report:${state.session.user.id}:${recipeVersionId}`}
      recipeVersionId={recipeVersionId}
    />
  );
}
