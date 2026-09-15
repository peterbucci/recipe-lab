import {
  isBoundedRecipeText,
  isRecipeRecord,
  isRecipeTimestamp,
  isRecipeUuid,
} from "../../shared/recipe-summary-parser";

export type RecipeDraftStatus = "active";
export type RecipeDraftKind = "original" | "adaptation" | "revision";

export function isRecipeDraftKind(value: unknown): value is RecipeDraftKind {
  return (
    value === "original" || value === "adaptation" || value === "revision"
  );
}

export interface RecipeDraftListItem {
  id: string;
  draft_kind: RecipeDraftKind;
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
    !isRecipeDraftKind(value.draft_kind) ||
    (value.source_version_id !== null &&
      !isRecipeUuid(value.source_version_id)) ||
    ((value.draft_kind === "original") !==
      (value.source_version_id === null)) ||
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
