import type { ApiValidationIssue } from "./auth-api";
import type { CatalogActionType } from "./cooking-action-api";
import type {
  CatalogIngredientSelection,
  MissingIngredientRequest,
} from "./ingredient-catalog-api";
import type { CatalogUnit } from "./measurement-unit-api";
import { formatDecimal } from "./format";
import type { RecipeCategory } from "./recipe-api";
import { MAX_RECIPE_CATEGORIES } from "./recipe-category";
import {
  type RecipeDraftDetail,
  type RecipeDifficulty,
  type RecipeDraftRequestSelection,
  type RecipeDraftUpdateRequest,
} from "./recipe-draft-api";
import {
  createStructuredActionDraft,
  hydrateStructuredActionDrafts,
  structuredActionFieldKey,
  type IngredientOccurrenceOption,
  type StructuredActionDraft,
  validateStructuredActionDrafts,
} from "./structured-action";
import {
  createBlankExactMeasureDraft,
  createStructuredMeasureDraft,
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
  title: string;
  text: string;
  actions: StructuredActionDraft[];
}

export interface RecipeDraftEditorState {
  title: string;
  description: string;
  servings: string;
  totalTimeMinutes: string;
  activeTimeMinutes: string;
  difficulty: RecipeDifficulty | "";
  notes: string;
  categories: RecipeCategory[];
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
    measure: createBlankExactMeasureDraft(),
    preparationNotes: "",
  };
}

export function createDraftInstructionState(key = `instruction-${crypto.randomUUID()}`): RecipeDraftInstructionState {
  return { key, title: "", text: "", actions: [] };
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
    servings: detail.servings ? formatDecimal(detail.servings) : "",
    totalTimeMinutes: detail.total_time_minutes?.toString() ?? "",
    activeTimeMinutes: detail.active_time_minutes?.toString() ?? "",
    difficulty: detail.difficulty ?? "",
    notes: detail.notes ?? "",
    categories: detail.categories.map((category) => ({ ...category })),
    ingredients,
    instructions: detail.instructions.map((instruction) => ({
      key: instruction.id,
      title: instruction.title ?? "",
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

export function draftInstructionTitleFieldKey(key: string): string {
  return `instruction.${key}.title`;
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

function recipeTimeError(value: string, label: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) {
    return `${label} must be a positive whole number of minutes.`;
  }
  const minutes = Number(normalized);
  if (!Number.isSafeInteger(minutes) || minutes <= 0) {
    return `${label} must be greater than zero.`;
  }
  if (minutes > 525_600) {
    return `${label} must be 525,600 minutes or fewer.`;
  }
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
  const totalTimeError = recipeTimeError(state.totalTimeMinutes, "Total time");
  const activeTimeError = recipeTimeError(state.activeTimeMinutes, "Active time");
  const notesError = textError(state.notes, "Notes", 5_000, false);
  if (titleError) fieldErrors.title = titleError;
  if (descriptionError) fieldErrors.description = descriptionError;
  if (portionError) fieldErrors.servings = portionError;
  if (totalTimeError) fieldErrors.totalTimeMinutes = totalTimeError;
  if (activeTimeError) fieldErrors.activeTimeMinutes = activeTimeError;
  if (notesError) fieldErrors.notes = notesError;
  const totalTimeMinutes = totalTimeError
    ? null
    : state.totalTimeMinutes.trim()
      ? Number(state.totalTimeMinutes.trim())
      : null;
  const activeTimeMinutes = activeTimeError
    ? null
    : state.activeTimeMinutes.trim()
      ? Number(state.activeTimeMinutes.trim())
      : null;
  if (
    totalTimeMinutes !== null &&
    activeTimeMinutes !== null &&
    activeTimeMinutes > totalTimeMinutes
  ) {
    fieldErrors.activeTimeMinutes = "Active time cannot be longer than total time.";
  }
  const categoryIds = state.categories.map((category) => category.id);
  if (state.categories.length > MAX_RECIPE_CATEGORIES) {
    fieldErrors.categories = `Choose no more than ${MAX_RECIPE_CATEGORIES} recipe categories.`;
  } else if (
    new Set(categoryIds).size !== categoryIds.length ||
    categoryIds.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  ) {
    fieldErrors.categories = "Choose recipe categories from the curated list.";
  }
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
      "Note",
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
    const titleError = textError(instruction.title, "Step title", 200, false);
    if (titleError) {
      fieldErrors[draftInstructionTitleFieldKey(instruction.key)] = titleError;
    }
    const instructionError = textError(instruction.text, "Instruction", 5_000, true);
    if (instructionError) fieldErrors[draftInstructionFieldKey(instruction.key)] = instructionError;
    const actionValidation =
      instruction.actions.length === 0
        ? { fieldErrors: {}, actions: [] }
        : validateStructuredActionDrafts(instruction.actions, actionTypes, occurrences, units);
    for (const [field, message] of Object.entries(actionValidation.fieldErrors)) {
      fieldErrors[draftInstructionActionFieldKey(instruction.key, field)] = message;
    }
    if (!titleError && !instructionError && actionValidation.actions) {
      instructions.push({
        ref: instruction.key,
        title: instruction.title.trim() || null,
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
      total_time_minutes: totalTimeMinutes,
      active_time_minutes: activeTimeMinutes,
      difficulty: state.difficulty || null,
      notes: state.notes.trim() || null,
      category_ids: categoryIds,
      ingredients,
      instructions,
    },
  };
}

export function validateRecipeDraftForPublication(
  state: RecipeDraftEditorState,
  revision: number,
  units: readonly CatalogUnit[],
  actionTypes: readonly CatalogActionType[],
): RecipeDraftValidation {
  const savedDraft = validateRecipeDraft(state, revision, units, actionTypes);
  const fieldErrors = { ...savedDraft.fieldErrors };
  const formErrors = [...savedDraft.formErrors];

  if (!state.title.trim()) {
    fieldErrors.title = "Title is required before publication.";
  }
  if (!state.servings.trim()) {
    fieldErrors.servings = "Servings are required before publication.";
  }
  if (state.ingredients.length === 0) {
    formErrors.push("Add at least one catalog ingredient before publication.");
  }
  if (state.instructions.length === 0) {
    formErrors.push("Add at least one instruction before publication.");
  }

  for (const ingredient of state.ingredients) {
    if (ingredient.selection?.kind === "request") {
      fieldErrors[draftIngredientFieldKey(ingredient.key, "selection")] =
        "Choose the request’s approved catalog ingredient before publication.";
    }
  }
  for (const instruction of state.instructions) {
    if (instruction.actions.length === 0) {
      fieldErrors[draftInstructionActionFieldKey(instruction.key, "actions")] =
        "Add at least one cooking detail to this step so Recipe Lab can compare similar recipes before publishing.";
    }
  }

  if (Object.keys(fieldErrors).length > 0 || formErrors.length > 0) {
    return { fieldErrors, formErrors, payload: null };
  }
  return { fieldErrors, formErrors, payload: savedDraft.payload };
}

export function recipeDraftFieldErrorsFromIssues(
  state: RecipeDraftEditorState,
  issues: readonly ApiValidationIssue[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  const measureField = (value: string): StructuredMeasureField | null => {
    if (value === "mode" || value === "kind") return "mode";
    if (value === "value") return "amount";
    if (value === "minimum") return "minimum";
    if (value === "maximum") return "maximum";
    if (value === "unit" || value === "unit_id" || value === "package_size_id") return "unit";
    return null;
  };

  for (const issue of issues) {
    const path = issue.location[0] === "body" ? issue.location.slice(1) : issue.location;
    const [section, index, field, nestedIndex, nestedField, measurePart] = path;
    if (section === "title" || section === "description" || section === "servings" || section === "notes" || section === "difficulty") {
      errors[section] = issue.message;
      continue;
    }
    if (section === "total_time_minutes" || section === "active_time_minutes") {
      errors[section === "total_time_minutes" ? "totalTimeMinutes" : "activeTimeMinutes"] =
        issue.message;
      continue;
    }
    if (section === "category_ids" || section === "categories") {
      errors.categories = issue.message;
      continue;
    }
    if (section === "ingredients" && typeof index === "number") {
      const ingredient = state.ingredients[index];
      if (!ingredient) continue;
      if (field === "selection" || field === "ingredient_id" || field === "ingredient_request_id") {
        errors[draftIngredientFieldKey(ingredient.key, "selection")] = issue.message;
      } else if (field === "preparation_notes") {
        errors[draftIngredientFieldKey(ingredient.key, "preparationNotes")] = issue.message;
      } else if (field === "measure" && typeof nestedIndex === "string") {
        const mapped = measureField(nestedIndex);
        if (mapped) errors[draftIngredientMeasureFieldKey(ingredient.key, mapped)] = issue.message;
      }
      continue;
    }
    if (section !== "instructions" || typeof index !== "number") continue;
    const instruction = state.instructions[index];
    if (!instruction) continue;
    if (field === "text") {
      errors[draftInstructionFieldKey(instruction.key)] = issue.message;
      continue;
    }
    if (field === "title") {
      errors[draftInstructionTitleFieldKey(instruction.key)] = issue.message;
      continue;
    }
    if (field !== "actions") continue;
    if (typeof nestedIndex !== "number") {
      errors[draftInstructionActionFieldKey(instruction.key, "actions")] = issue.message;
      continue;
    }
    const action = instruction.actions[nestedIndex];
    if (!action || typeof nestedField !== "string") continue;
    let actionField: string | null = null;
    if (nestedField === "action_type_id" || nestedField === "action_type") {
      actionField = structuredActionFieldKey(action.key, "type");
    } else if (nestedField === "ingredient_refs" || nestedField === "inputs") {
      actionField = structuredActionFieldKey(action.key, "inputs");
    } else if (nestedField === "duration" || nestedField === "temperature") {
      const mapped = typeof measurePart === "string" ? measureField(measurePart) : "mode";
      if (mapped) actionField = structuredActionFieldKey(action.key, nestedField, mapped);
    }
    if (actionField) {
      errors[draftInstructionActionFieldKey(instruction.key, actionField)] = issue.message;
    }
  }
  return errors;
}

export function recipeDraftFingerprint(state: RecipeDraftEditorState): string {
  return JSON.stringify(state);
}

export { createStructuredActionDraft };
