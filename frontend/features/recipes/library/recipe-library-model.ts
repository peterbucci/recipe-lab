import type { operations } from "../../../shared/api/generated/generated";
import type { RecipeDraftListItem } from "../../../lib/recipe-draft-api";
import type { RecipeSummary } from "../shared/recipe-contracts";
import { invalidRecipeLibraryResponse } from "../shared/recipe-library-error";
import { parseRecipeLibraryPageEnvelope } from "../shared/recipe-library-page-parser";
import {
  isBoundedRecipeText,
  isRecipeRecord,
  isRecipeTimestamp,
  isRecipeUuid,
  parseRecipeSummary,
} from "../shared/recipe-summary-parser";

type MyRecipeLibraryOperation =
  operations["my_recipe_library_api_my_recipes_get"];

type MyRecipeLibraryContractPage =
  MyRecipeLibraryOperation["responses"][200]["content"]["application/json"];

type MyPublishedRecipeItem = Extract<
  MyRecipeLibraryContractPage["items"][number],
  { readonly kind: "published" }
>;

export type SavedRecipeLibraryWire =
  operations["my_saved_recipe_library_api_my_saved_recipes_get"]["responses"][200]["content"]["application/json"];

export type RecipeVisibilityState = MyPublishedRecipeItem["visibility_state"];

export type MyRecipeLibraryView =
  MyRecipeLibraryOperation["parameters"]["query"]["view"];

export type MyRecipeLibraryItem = MyRecipeLibraryContractPage["items"][number];

export type MyRecipeLibraryPage = MyRecipeLibraryContractPage;

export interface SavedRecipeLibraryItem {
  recipe: RecipeSummary;
  saved_at: string;
}

export interface SavedRecipeLibraryPage {
  items: SavedRecipeLibraryItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

function parseDraft(value: unknown): RecipeDraftListItem | null {
  if (
    !isRecipeRecord(value) ||
    !isRecipeUuid(value.id) ||
    (value.source_version_id !== null && !isRecipeUuid(value.source_version_id)) ||
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
  return {
    id: value.id,
    source_version_id: value.source_version_id as string | null,
    status: "active",
    revision: value.revision as number,
    title: value.title,
    ingredient_count: value.ingredient_count as number,
    instruction_count: value.instruction_count as number,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

export function parseMyRecipeLibraryPage(value: unknown): MyRecipeLibraryPage {
  const envelope = parseRecipeLibraryPageEnvelope(value);
  const items = envelope.items.map((item): MyRecipeLibraryItem | null => {
    if (!isRecipeRecord(item)) return null;
    if (item.kind === "draft") {
      const draft = parseDraft(item.draft);
      const sourceRecipeTitle = item.source_recipe_title;
      const description = item.description;
      if (
        sourceRecipeTitle !== undefined &&
        sourceRecipeTitle !== null &&
        !isBoundedRecipeText(sourceRecipeTitle, 200)
      ) {
        return null;
      }
      if (
        description !== undefined &&
        description !== null &&
        !isBoundedRecipeText(description, 2_000)
      ) {
        return null;
      }
      return draft
        ? {
            kind: "draft",
            draft,
            source_recipe_title: sourceRecipeTitle ?? null,
            description: description ?? null,
          }
        : null;
    }
    if (item.kind === "published") {
      const recipe = parseRecipeSummary(item.recipe);
      const visibilityState = item.visibility_state;
      return recipe &&
        (visibilityState === "published" ||
          visibilityState === "author_withdrawn" ||
          visibilityState === "moderation_hidden")
        ? { kind: "published", recipe, visibility_state: visibilityState }
        : null;
    }
    return null;
  });
  if (items.some((item) => item === null)) {
    throw invalidRecipeLibraryResponse();
  }
  return { ...envelope, items: items as MyRecipeLibraryItem[] };
}

export function parseSavedRecipeLibraryPage(
  value: unknown,
): SavedRecipeLibraryPage {
  const envelope = parseRecipeLibraryPageEnvelope(value);
  const items = envelope.items.map((item): SavedRecipeLibraryItem | null => {
    if (!isRecipeRecord(item) || !isRecipeTimestamp(item.saved_at)) return null;
    const recipe = parseRecipeSummary(item.recipe);
    return recipe ? { recipe, saved_at: item.saved_at } : null;
  });
  if (items.some((item) => item === null)) {
    throw invalidRecipeLibraryResponse();
  }
  return { ...envelope, items: items as SavedRecipeLibraryItem[] };
}
