import type { components } from "../../../shared/api/generated/generated";
import type {
  RecipeDeclaredChangeReason,
  RecipeRelationKind,
} from "./recipe-contracts";
import {
  isBoundedRecipeText,
  isRecipeRecord,
  isRecipeTimestamp,
  isRecipeUuid,
  parsePublicUserReference,
} from "./recipe-summary-parser";

const MAX_HISTORY_ENTRIES = 100;

export type RecipeHistoryEntry = components["schemas"]["RecipeHistoryEntry"];
export type RecipeHistory = components["schemas"]["RecipeHistoryResponse"];

function isRelationKind(value: unknown): value is RecipeRelationKind {
  return (
    value === "original" || value === "adaptation" || value === "revision"
  );
}

function isDeclaredChangeReason(
  value: unknown,
): value is RecipeDeclaredChangeReason {
  return value === null || value === "correction" || value === "update";
}

function parseHistoryEntry(value: unknown): RecipeHistoryEntry | null {
  if (
    !isRecipeRecord(value) ||
    !isRecipeUuid(value.id) ||
    !isRecipeUuid(value.recipe_id) ||
    !Number.isInteger(value.edition_number) ||
    (value.edition_number as number) < 1 ||
    !isRelationKind(value.relation_kind) ||
    (value.previous_version_id !== null &&
      !isRecipeUuid(value.previous_version_id)) ||
    (value.adaptation_source_version_id !== null &&
      !isRecipeUuid(value.adaptation_source_version_id)) ||
    !isDeclaredChangeReason(value.declared_change_reason) ||
    typeof value.is_current !== "boolean" ||
    !isBoundedRecipeText(value.title, 200) ||
    !isRecipeTimestamp(value.published_at)
  ) {
    return null;
  }

  const editionNumber = value.edition_number as number;
  const relationKind = value.relation_kind;
  const previousVersionId = value.previous_version_id as string | null;
  const adaptationSourceVersionId =
    value.adaptation_source_version_id as string | null;
  const declaredChangeReason =
    value.declared_change_reason as RecipeDeclaredChangeReason;
  const author = parsePublicUserReference(value.author);
  if (
    author === null ||
    (relationKind === "revision") !== (editionNumber > 1) ||
    (relationKind === "revision") !== (previousVersionId !== null) ||
    (relationKind !== "revision" && declaredChangeReason !== null) ||
    (relationKind === "adaptation") !==
      (editionNumber === 1 && adaptationSourceVersionId !== null)
  ) {
    return null;
  }

  return {
    id: value.id,
    recipe_id: value.recipe_id,
    edition_number: editionNumber,
    relation_kind: relationKind,
    previous_version_id: previousVersionId,
    adaptation_source_version_id: adaptationSourceVersionId,
    declared_change_reason: declaredChangeReason,
    is_current: value.is_current,
    title: value.title,
    published_at: value.published_at,
    author,
  };
}

function parseHistoryEntries(value: unknown): RecipeHistoryEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_HISTORY_ENTRIES) return null;
  const entries = value.map(parseHistoryEntry);
  return entries.every((entry) => entry !== null)
    ? (entries as RecipeHistoryEntry[])
    : null;
}

export function parseRecipeHistory(value: unknown): RecipeHistory {
  if (
    !isRecipeRecord(value) ||
    !isRecipeUuid(value.recipe_id) ||
    !isRecipeUuid(value.selected_version_id) ||
    (value.current_version_id !== null &&
      !isRecipeUuid(value.current_version_id)) ||
    typeof value.editions_truncated !== "boolean" ||
    typeof value.adaptations_truncated !== "boolean"
  ) {
    throw new TypeError("Recipe Lab received an invalid recipe history response.");
  }

  const editions = parseHistoryEntries(value.editions);
  const adaptations = parseHistoryEntries(value.adaptations);
  if (editions === null || adaptations === null) {
    throw new TypeError("Recipe Lab received an invalid recipe history response.");
  }

  const editionIds = new Set<string>();
  let previousEditionNumber = 0;
  let currentEditionCount = 0;
  for (const edition of editions) {
    if (
      edition.recipe_id !== value.recipe_id ||
      editionIds.has(edition.id) ||
      edition.edition_number <= previousEditionNumber
    ) {
      throw new TypeError("Recipe Lab received an invalid recipe history response.");
    }
    editionIds.add(edition.id);
    previousEditionNumber = edition.edition_number;
    if (edition.is_current) currentEditionCount += 1;
  }

  const currentVersionId = value.current_version_id as string | null;
  const currentEdition =
    currentVersionId === null
      ? null
      : editions.find((edition) => edition.id === currentVersionId) ?? null;
  const adaptationRecipeIds = new Set<string>();
  if (
    currentEditionCount > 1 ||
    (currentVersionId === null && currentEditionCount !== 0) ||
    (currentVersionId !== null &&
      currentEdition !== null &&
      !currentEdition.is_current) ||
    editions.some(
      (edition) =>
        edition.is_current && edition.id !== currentVersionId,
    ) ||
    adaptations.some((adaptation) => {
      if (
        adaptation.recipe_id === value.recipe_id ||
        editionIds.has(adaptation.id) ||
        adaptationRecipeIds.has(adaptation.recipe_id) ||
        !adaptation.is_current ||
        adaptation.relation_kind === "original" ||
        adaptation.adaptation_source_version_id === null
      ) {
        return true;
      }
      adaptationRecipeIds.add(adaptation.recipe_id);
      return false;
    })
  ) {
    throw new TypeError("Recipe Lab received an invalid recipe history response.");
  }

  return {
    recipe_id: value.recipe_id,
    selected_version_id: value.selected_version_id,
    current_version_id: currentVersionId,
    editions,
    adaptations,
    editions_truncated: value.editions_truncated,
    adaptations_truncated: value.adaptations_truncated,
  };
}
