import type { CatalogActionType } from "./cooking-action-api";
import type {
  CatalogIngredientSelection,
  MissingIngredientRequest,
} from "./ingredient-catalog-api";
import type { CatalogUnit } from "./measurement-unit-api";
import {
  type RecipeDraftDetail,
  type RecipeDraftRequestSelection,
  type RecipeDraftUpdateRequest,
} from "./recipe-draft-api";
import {
  createStructuredActionDraft,
  hydrateStructuredActionDrafts,
  type IngredientOccurrenceOption,
  type StructuredActionDraft,
  validateStructuredActionDrafts,
} from "./structured-action";
import {
  createStructuredMeasureDraft,
  createUnspecifiedMeasureDraft,
  ingredientAmountPolicy,
  type StructuredMeasureDraft,
  type StructuredMeasureField,
  validateStructuredMeasureDraft,
} from "./structured-measure";

export type DraftIngredientSelection =
  | { kind: "catalog"; ingredient: CatalogIngredientSelection }
  | { kind: "request"; request: RecipeDraftRequestSelection["request"] };

export interface RecipeDraftIngredientState {
  key: string;
  selection: DraftIngredientSelection | null;
  measure: StructuredMeasureDraft;
  preparationNotes: string;
}

export interface RecipeDraftInstructionState {
  key: string;
  text: string;
  actions: StructuredActionDraft[];
}

export interface RecipeDraftEditorState {
  title: string;
  description: string;
  servings: string;
  ingredients: RecipeDraftIngredientState[];
  instructions: RecipeDraftInstructionState[];
}

export interface RecipeDraftValidation {
  fieldErrors: Record<string, string>;
  formErrors: string[];
  payload: RecipeDraftUpdateRequest | null;
}

export function createDraftIngredientState(key = `ingredient-${crypto.randomUUID()}`): RecipeDraftIngredientState {
  return {
    key,
    selection: null,
    measure: createUnspecifiedMeasureDraft(),
    preparationNotes: "",
  };
}

export function createDraftInstructionState(key = `instruction-${crypto.randomUUID()}`): RecipeDraftInstructionState {
  return { key, text: "", actions: [] };
}

export function requestSelectionFromSubmission(
  request: MissingIngredientRequest,
): DraftIngredientSelection {
  return {
    kind: "request",
    request: {
      id: request.id,
      proposed_name: request.proposed_name,
      status: request.status,
      resolved_ingredient: null,
    },
  };
}

export function hydrateRecipeDraft(detail: RecipeDraftDetail): RecipeDraftEditorState {
  const ingredients: RecipeDraftIngredientState[] = detail.ingredients.map((row) => ({
    key: row.id,
    selection:
      row.selection.kind === "catalog"
        ? {
            kind: "catalog",
            ingredient: {
              ingredientId: row.selection.ingredient.id,
              canonicalName: row.selection.ingredient.canonical_name,
              displayName: row.selection.display_name,
            },
          }
        : { kind: "request", request: row.selection.request },
    measure: createStructuredMeasureDraft(row.measure),
    preparationNotes: row.preparation_notes ?? "",
  }));
  const ingredientKeyByOccurrenceId = new Map(
    ingredients.map((ingredient) => [ingredient.key, ingredient.key]),
  );
  return {
    title: detail.title,
    description: detail.description ?? "",
    servings: detail.servings ?? "",
    ingredients,
    instructions: detail.instructions.map((instruction) => ({
      key: instruction.id,
      text: instruction.text,
      actions: hydrateStructuredActionDrafts(
        instruction.actions,
        ingredientKeyByOccurrenceId,
      ),
    })),
  };
}

export function draftIngredientFieldKey(
  key: string,
  field: "selection" | "preparationNotes",
): string {
  return `ingredient.${key}.${field}`;
}

export function draftIngredientMeasureFieldKey(
  key: string,
  field: StructuredMeasureField,
): string {
  return `ingredient.${key}.measure.${field}`;
}

export function draftInstructionFieldKey(key: string): string {
  return `instruction.${key}.text`;
}

export function draftInstructionActionFieldKey(key: string, field: string): string {
  return `instruction.${key}.action.${field}`;
}

export function draftIngredientOptions(
  ingredients: readonly RecipeDraftIngredientState[],
): IngredientOccurrenceOption[] {
  return ingredients.flatMap((ingredient, index) => {
    if (ingredient.selection?.kind !== "catalog") {
      return [];
    }
    return [{
      key: ingredient.key,
      label: `Ingredient ${index + 1}: ${ingredient.selection.ingredient.displayName}`,
      ref: { kind: "added" as const, ingredient_edit_ref: ingredient.key },
      removed: false,
    }];
  });
}

function textError(value: string, label: string, max: number, required: boolean): string | null {
  const normalized = value.trim();
  if (!normalized) return required ? `${label} is required.` : null;
  if (value.includes("\0")) return `${label} contains an unsupported character.`;
  if (value.length > max) return `${label} must be ${max.toLocaleString()} characters or fewer.`;
  return null;
}

function servingsError(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return "Servings must be a positive decimal number.";
  const [whole = "", fraction = ""] = normalized.split(".");
  if ((whole.replace(/^0+/, "") || "0").length > 6) return "Servings can have at most 6 digits before the decimal point.";
  if (fraction.length > 2) return "Servings can have at most 2 decimal places.";
  if (![...whole, ...fraction].some((digit) => digit !== "0")) return "Servings must be greater than zero.";
  return null;
}

export function validateRecipeDraft(
  state: RecipeDraftEditorState,
  revision: number,
  units: readonly CatalogUnit[],
  actionTypes: readonly CatalogActionType[],
): RecipeDraftValidation {
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  const titleError = textError(state.title, "Title", 200, false);
  const descriptionError = textError(state.description, "Description", 2_000, false);
  const portionError = servingsError(state.servings);
  if (titleError) fieldErrors.title = titleError;
  if (descriptionError) fieldErrors.description = descriptionError;
  if (portionError) fieldErrors.servings = portionError;
  if (state.ingredients.length > 200) formErrors.push("Use no more than 200 ingredient rows.");
  if (state.instructions.length > 100) formErrors.push("Use no more than 100 instruction steps.");

  const ingredients: RecipeDraftUpdateRequest["ingredients"] = [];
  for (const ingredient of state.ingredients) {
    const selectionKey = draftIngredientFieldKey(ingredient.key, "selection");
    if (!ingredient.selection) {
      fieldErrors[selectionKey] = "Choose a catalog ingredient or attach a submitted request.";
    }
    const notesError = textError(
      ingredient.preparationNotes,
      "Preparation notes",
      1_000,
      false,
    );
    if (notesError) {
      fieldErrors[draftIngredientFieldKey(ingredient.key, "preparationNotes")] = notesError;
    }
    const measure = validateStructuredMeasureDraft(
      ingredient.measure,
      ingredientAmountPolicy,
      units,
    );
    for (const [field, message] of Object.entries(measure.fieldErrors)) {
      if (message) {
        fieldErrors[draftIngredientMeasureFieldKey(ingredient.key, field as StructuredMeasureField)] = message;
      }
    }
    if (ingredient.selection && measure.measure && !notesError) {
      const common = {
        ref: ingredient.key,
        measure: measure.measure,
        preparation_notes: ingredient.preparationNotes.trim() || null,
      };
      ingredients.push(
        ingredient.selection.kind === "catalog"
          ? {
              ...common,
              selection: {
                kind: "catalog",
                ingredient_id: ingredient.selection.ingredient.ingredientId,
                display_name: ingredient.selection.ingredient.displayName,
              },
            }
          : {
              ...common,
              selection: {
                kind: "request",
                ingredient_request_id: ingredient.selection.request.id,
              },
            },
      );
    }
  }

  const occurrences = draftIngredientOptions(state.ingredients);
  const instructions: RecipeDraftUpdateRequest["instructions"] = [];
  for (const instruction of state.instructions) {
    const instructionError = textError(instruction.text, "Instruction", 5_000, true);
    if (instructionError) fieldErrors[draftInstructionFieldKey(instruction.key)] = instructionError;
    const actionValidation =
      instruction.actions.length === 0
        ? { fieldErrors: {}, actions: [] }
        : validateStructuredActionDrafts(instruction.actions, actionTypes, occurrences, units);
    for (const [field, message] of Object.entries(actionValidation.fieldErrors)) {
      fieldErrors[draftInstructionActionFieldKey(instruction.key, field)] = message;
    }
    if (!instructionError && actionValidation.actions) {
      instructions.push({
        ref: instruction.key,
        text: instruction.text.trim(),
        actions: actionValidation.actions.map((action) => ({
          action_type_id: action.action_type_id,
          ingredient_refs: action.ingredient_refs.map((reference) =>
            reference.kind === "added"
              ? reference.ingredient_edit_ref
              : reference.recipe_ingredient_id,
          ),
          duration: action.duration ?? null,
          temperature: action.temperature ?? null,
        })),
      });
    }
  }

  if (Object.keys(fieldErrors).length || formErrors.length) {
    return { fieldErrors, formErrors, payload: null };
  }
  return {
    fieldErrors,
    formErrors,
    payload: {
      revision,
      title: state.title.trim(),
      description: state.description.trim() || null,
      servings: state.servings.trim() || null,
      ingredients,
      instructions,
    },
  };
}

export function recipeDraftFingerprint(state: RecipeDraftEditorState): string {
  return JSON.stringify(state);
}

export { createStructuredActionDraft };
