"use client";

import { isAbortError } from "./abort-error";
import type { components, operations } from "./api-contracts/generated";
import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "./api-transport/core";
import type {
  PublicUserReference,
  RecipeCardSummary,
  RecipeDetail,
  RecipeIngredient,
  RecipeInstruction,
  RecipeVersionReference,
} from "./recipe-api";
import { parseRecipeViewerState } from "./recipe-viewer-state";
import type {
  RecipeInstructionAction,
  RecipeNumericMeasure,
} from "./structured-action";
import type { RecipeIngredientMeasure } from "./structured-measure";

type RecipeDetailWire =
  operations["recipe_detail_api_recipes__recipe_version_id__get"]["responses"][200]["content"]["application/json"];
type RecipePageWire =
  operations["browse_recipes_api_recipes_get"]["responses"][200]["content"]["application/json"];
type PublicUserReferenceWire = components["schemas"]["PublicUserReference"];
type RecipeVersionReferenceWire = components["schemas"]["RecipeVersionReference"];
type RecipeIngredientWire = components["schemas"]["RecipeIngredientResponse"];
type RecipeInstructionWire = components["schemas"]["RecipeInstructionResponse"];
type RecipeInstructionActionWire =
  components["schemas"]["RecipeInstructionActionResponse"];
type NumericMeasureWire =
  | components["schemas"]["ExactMeasureResponse"]
  | components["schemas"]["RangeMeasureResponse"];

export interface LoadedRecipeFamily {
  recipe: RecipeDetail;
  sourceVersionId: string;
  versions: readonly RecipeCardSummary[];
}

const RECIPE_FAMILY_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_api_error",
  knownCodes: new Set([
    "invalid_identifier",
    "recipe_not_found",
    "validation_error",
  ]),
};

function publicUserReferenceFromWire(
  value: PublicUserReferenceWire,
): PublicUserReference {
  return {
    display_name: value.display_name,
    handle: value.handle ?? null,
    id: value.id,
  };
}

function recipeVersionReferenceFromWire(
  value: RecipeVersionReferenceWire,
): RecipeVersionReference {
  return {
    author: publicUserReferenceFromWire(value.author),
    id: value.id,
    title: value.title,
    version_number: value.version_number,
  };
}

function numericMeasureFromWire(value: NumericMeasureWire): RecipeNumericMeasure {
  const unit = {
    active: value.unit.active,
    canonical_label: value.unit.canonical_label,
    dimension: value.unit.dimension,
    display_style: value.unit.display_style,
    id: value.unit.id,
    key: value.unit.key,
    plural_label: value.unit.plural_label,
    symbol: value.unit.symbol ?? null,
  };
  if (value.kind === "exact") {
    return {
      display: value.display,
      display_unit: value.display_unit,
      kind: "exact",
      package_size_id: value.package_size_id,
      unit,
      value: value.value,
    };
  }
  return {
    display: value.display,
    display_unit: value.display_unit,
    kind: "range",
    maximum: value.maximum,
    minimum: value.minimum,
    package_size_id: value.package_size_id,
    unit,
  };
}

function ingredientMeasureFromWire(
  value: RecipeIngredientWire["measure"],
): RecipeIngredientMeasure {
  if (value.kind !== "qualitative") return numericMeasureFromWire(value);
  return {
    display: value.display,
    display_unit: null,
    kind: "qualitative",
    unit: null,
    value: value.value,
  };
}

function recipeIngredientFromWire(value: RecipeIngredientWire): RecipeIngredient {
  return {
    canonical_name: value.canonical_name,
    display_name: value.display_name,
    display_order: value.display_order,
    id: value.id,
    ingredient_id: value.ingredient_id,
    measure: ingredientMeasureFromWire(value.measure),
    preparation_notes: value.preparation_notes,
  };
}

function recipeInstructionActionFromWire(
  value: RecipeInstructionActionWire,
): RecipeInstructionAction {
  return {
    action_type: {
      active: value.action_type.active,
      canonical_verb: value.action_type.canonical_verb,
      id: value.action_type.id,
      key: value.action_type.key,
    },
    display_order: value.display_order,
    duration: value.duration ? numericMeasureFromWire(value.duration) : null,
    id: value.id,
    ingredient_occurrence_ids: [...(value.ingredient_occurrence_ids ?? [])],
    temperature: value.temperature
      ? numericMeasureFromWire(value.temperature)
      : null,
  };
}

function recipeInstructionFromWire(
  value: RecipeInstructionWire,
): RecipeInstruction {
  return {
    actions: value.actions.map(recipeInstructionActionFromWire),
    display_order: value.display_order,
    id: value.id,
    text: value.text,
    title: value.title,
  };
}

function recipeDetailFromWire(value: RecipeDetailWire): RecipeDetail {
  return {
    active_time_minutes: value.active_time_minutes ?? null,
    author: publicUserReferenceFromWire(value.author),
    average_rating: value.average_rating,
    categories: value.categories.map((category) => ({ ...category })),
    children: value.children.map(recipeVersionReferenceFromWire),
    created_at: value.created_at,
    description: value.description,
    difficulty: value.difficulty ?? null,
    id: value.id,
    ingredients: value.ingredients.map(recipeIngredientFromWire),
    instructions: value.instructions.map(recipeInstructionFromWire),
    lineage_id: value.lineage_id,
    notes: value.notes ?? null,
    parent: value.parent
      ? recipeVersionReferenceFromWire(value.parent)
      : null,
    parent_version_id: value.parent_version_id,
    published_at: value.published_at,
    rating_count: value.rating_count,
    save_count: value.save_count,
    servings: value.servings,
    title: value.title,
    total_time_minutes: value.total_time_minutes ?? null,
    version_number: value.version_number,
    viewer_state: parseRecipeViewerState(value.viewer_state),
  };
}

function rethrowRecipeFamilyAbort(
  error: unknown,
  signal: AbortSignal,
): void {
  if (
    signal.aborted &&
    (error instanceof ApiTransportError || isAbortError(error))
  ) {
    throw new DOMException("The request was aborted.", "AbortError");
  }
}

export async function fetchRecipeFamily(
  sourceVersionId: string,
  signal: AbortSignal,
): Promise<LoadedRecipeFamily> {
  let recipe: RecipeDetail;
  try {
    const response = await browserApiRequest(
      `/api/recipes/${encodeURIComponent(sourceVersionId)}`,
      {
        errorContract: RECIPE_FAMILY_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        signal,
      },
    );
    recipe = recipeDetailFromWire(response.data as RecipeDetailWire);
  } catch (error) {
    rethrowRecipeFamilyAbort(error, signal);
    throw new Error("Recipe family unavailable");
  }

  const query = new URLSearchParams({
    lineage_id: recipe.lineage_id,
    page: "1",
    page_size: "100",
    sort: "title",
  });
  let versions: readonly RecipeCardSummary[] = [];
  try {
    const response = await browserApiRequest(
      `/api/recipes?${query.toString()}`,
      {
        errorContract: RECIPE_FAMILY_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        signal,
      },
    );
    const family = response.data as RecipePageWire;
    versions = family.items;
  } catch (error) {
    rethrowRecipeFamilyAbort(error, signal);
  }

  return { recipe, sourceVersionId, versions };
}
