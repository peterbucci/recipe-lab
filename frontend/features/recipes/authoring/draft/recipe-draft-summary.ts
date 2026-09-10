import {
  isBoundedRecipeText,
  isRecipeRecord,
  isRecipeTimestamp,
  isRecipeUuid,
} from "../../shared/recipe-summary-parser";

export type RecipeDraftStatus = "active";

export interface RecipeDraftListItem {
  id: string;
  source_version_id: string | null;
  status: RecipeDraftStatus;
  revision: number;
  title: string;
  ingredient_count: number;
  instruction_count: number;
  created_at: string;
  updated_at: string;
}

export function parseRecipeDraftListItem(
  value: unknown,
): RecipeDraftListItem | null {
  if (
    !isRecipeRecord(value) ||
    !isRecipeUuid(value.id) ||
    (value.source_version_id !== null &&
      !isRecipeUuid(value.source_version_id)) ||
    value.status !== "active" ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !isBoundedRecipeText(value.title, 200, true) ||
    !Number.isInteger(value.ingredient_count) ||
    (value.ingredient_count as number) < 0 ||
    !Number.isInteger(value.instruction_count) ||
    (value.instruction_count as number) < 0 ||
    !isRecipeTimestamp(value.created_at) ||
    !isRecipeTimestamp(value.updated_at)
  ) {
    return null;
  }
  return value as unknown as RecipeDraftListItem;
}
