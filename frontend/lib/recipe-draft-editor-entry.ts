"use client";

import {
  parseCookingActionTypeResponse,
  type CatalogActionType,
} from "./cooking-action-api";
import {
  parseMeasurementUnitResponse,
  type CatalogUnit,
  type MeasurementSemantic,
} from "./measurement-unit-api";
import type { RecipeDraftDetail } from "./recipe-draft-api";
import { startOrResumeRecipeDraftDetail } from "./recipe-draft-entry";
import type { RecipeCategory } from "./recipe-api";
import { parseRecipeCategories } from "./recipe-category";

export interface RecipeDraftEditorEntry {
  actionTypes: CatalogActionType[];
  categories: RecipeCategory[];
  detail: RecipeDraftDetail;
  measurementUnits: CatalogUnit[];
}

export class RecipeDraftEditorEntryError extends Error {
  constructor() {
    super(
      "Recipe Lab could not prepare the editable version. This recipe is unchanged; try again.",
    );
    this.name = "RecipeDraftEditorEntryError";
  }
}

async function catalogJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new RecipeDraftEditorEntryError();
  return response.json();
}

async function measurementUnits(
  semantic: MeasurementSemantic,
): Promise<CatalogUnit[]> {
  const query = new URLSearchParams({ semantic });
  return parseMeasurementUnitResponse(
    await catalogJson(`/api/measurement-units?${query.toString()}`),
  ).items;
}

async function actionTypes(): Promise<CatalogActionType[]> {
  return parseCookingActionTypeResponse(
    await catalogJson("/api/cooking-action-types?limit=100"),
  ).items;
}

async function recipeCategories(): Promise<RecipeCategory[]> {
  const payload = await catalogJson("/api/recipe-categories");
  const items =
    typeof payload === "object" && payload !== null && "items" in payload
      ? parseRecipeCategories(payload.items)
      : null;
  if (items === null) throw new RecipeDraftEditorEntryError();
  return items;
}

export async function prepareRecipeDraftEditorEntry(
  actorId: string,
  sourceVersionId: string,
): Promise<RecipeDraftEditorEntry> {
  try {
    const [
      detail,
      ingredientUnits,
      durationUnits,
      temperatureUnits,
      actions,
      categories,
    ] =
      await Promise.all([
        startOrResumeRecipeDraftDetail(actorId, sourceVersionId),
        measurementUnits("ingredient_amount"),
        measurementUnits("action_duration"),
        measurementUnits("temperature"),
        actionTypes(),
        recipeCategories(),
      ]);
    const units = Array.from(
      new Map(
        [...ingredientUnits, ...durationUnits, ...temperatureUnits].map((unit) => [
          unit.id,
          unit,
        ]),
      ).values(),
    );
    return {
      actionTypes: actions,
      categories,
      detail,
      measurementUnits: units,
    };
  } catch (reason) {
    if (reason instanceof RecipeDraftEditorEntryError) throw reason;
    throw new RecipeDraftEditorEntryError();
  }
}
