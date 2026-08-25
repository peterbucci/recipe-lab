import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchCookingActionTypes } from "../../../../lib/cooking-action-api";
import { fetchMeasurementUnits } from "../../../../lib/measurement-unit-api";
import { isRecipeVersionId } from "../../../../lib/recipe-api";
import { RecipeDraftEditor } from "../../../components/recipe-draft-editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit private recipe draft",
  description: "Continue an incomplete recipe in your private workspace.",
};

interface RecipeDraftEditorPageProps {
  params: Promise<{ draftId: string }>;
}

export default async function RecipeDraftEditorPage({ params }: RecipeDraftEditorPageProps) {
  const { draftId } = await params;
  if (!isRecipeVersionId(draftId)) notFound();
  const [ingredientUnits, durationUnits, temperatureUnits, actionTypes] = await Promise.all([
    fetchMeasurementUnits("ingredient_amount"),
    fetchMeasurementUnits("action_duration"),
    fetchMeasurementUnits("temperature"),
    fetchCookingActionTypes(),
  ]);
  const measurementUnits = Array.from(
    new Map(
      [...ingredientUnits, ...durationUnits, ...temperatureUnits].map((unit) => [unit.id, unit]),
    ).values(),
  );
  return (
    <RecipeDraftEditor
      actionTypes={actionTypes}
      draftId={draftId}
      measurementUnits={measurementUnits}
    />
  );
}
