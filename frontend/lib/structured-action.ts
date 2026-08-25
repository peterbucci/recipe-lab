import type {
  CatalogActionType,
  CatalogActionTypeSummary,
} from "./cooking-action-api";
import type { CatalogUnit } from "./measurement-unit-api";
import {
  compareDecimalStrings,
  createUnspecifiedMeasureDraft,
  durationPolicy,
  structuredMeasureDraftMatchesRecipe,
  temperaturePolicy,
  type RecipeIngredientMeasure,
  type StructuredMeasureDraft,
  type StructuredMeasureField,
  validateStructuredMeasureDraft,
  type VariantMeasureInput,
} from "./structured-measure";

export type RecipeNumericMeasure = Extract<
  RecipeIngredientMeasure,
  { kind: "exact" | "range" }
>;

export type NumericMeasureInput = Extract<
  VariantMeasureInput,
  { kind: "exact" | "range" }
>;

export interface RecipeInstructionAction {
  id: string;
  action_type: CatalogActionTypeSummary;
  display_order: number;
  ingredient_occurrence_ids: string[];
  duration: RecipeNumericMeasure | null;
  temperature: RecipeNumericMeasure | null;
}

export type IngredientOccurrenceRef =
  | { kind: "existing"; recipe_ingredient_id: string }
  | { kind: "added"; ingredient_edit_ref: string };

export interface StructuredActionInput {
  action_type_id: string;
  ingredient_refs: IngredientOccurrenceRef[];
  duration?: NumericMeasureInput;
  temperature?: NumericMeasureInput;
}

export interface OptionalStructuredMeasureDraft {
  enabled: boolean;
  value: StructuredMeasureDraft;
}

export interface StructuredActionDraft {
  key: string;
  sourceId: string | null;
  actionType: CatalogActionTypeSummary | null;
  ingredientKeys: string[];
  duration: OptionalStructuredMeasureDraft;
  temperature: OptionalStructuredMeasureDraft;
}

export interface IngredientOccurrenceOption {
  key: string;
  label: string;
  ref: IngredientOccurrenceRef;
  removed: boolean;
}

export interface StructuredActionValidation {
  fieldErrors: Record<string, string>;
  actions: StructuredActionInput[] | null;
}

export const MAX_STRUCTURED_ACTIONS_PER_INSTRUCTION = 50;

function createBlankNumericMeasureDraft(): StructuredMeasureDraft {
  return {
    ...createUnspecifiedMeasureDraft(),
    mode: "exact",
  };
}

function optionalMeasureDraft(
  measure: RecipeNumericMeasure | null,
): OptionalStructuredMeasureDraft {
  return measure
    ? { enabled: true, value: structuredNumericMeasureDraft(measure) }
    : { enabled: false, value: createBlankNumericMeasureDraft() };
}

function structuredNumericMeasureDraft(
  measure: RecipeNumericMeasure,
): StructuredMeasureDraft {
  if (measure.kind === "exact") {
    return {
      mode: "exact",
      exactValue: measure.value,
      rangeMinimum: "",
      rangeMaximum: "",
      unit: measure.unit,
      packageSizeId: null,
    };
  }
  return {
    mode: "range",
    exactValue: "",
    rangeMinimum: measure.minimum,
    rangeMaximum: measure.maximum,
    unit: measure.unit,
    packageSizeId: null,
  };
}

export function createStructuredActionDraft(
  key: string,
): StructuredActionDraft {
  return {
    key,
    sourceId: null,
    actionType: null,
    ingredientKeys: [],
    duration: optionalMeasureDraft(null),
    temperature: optionalMeasureDraft(null),
  };
}

export function hydrateStructuredActionDrafts(
  actions: readonly RecipeInstructionAction[],
  ingredientKeyByOccurrenceId: ReadonlyMap<string, string>,
): StructuredActionDraft[] {
  return [...actions]
    .sort((left, right) => left.display_order - right.display_order)
    .map((action) => ({
      key: `source-action-${action.id}`,
      sourceId: action.id,
      actionType: action.action_type,
      ingredientKeys: action.ingredient_occurrence_ids.map((id) => {
        const key = ingredientKeyByOccurrenceId.get(id);
        if (!key) {
          throw new Error(`Action ${action.id} references an unknown ingredient occurrence.`);
        }
        return key;
      }),
      duration: optionalMeasureDraft(action.duration),
      temperature: optionalMeasureDraft(action.temperature),
    }));
}

function numericDraftMatchesRecipe(
  draft: OptionalStructuredMeasureDraft,
  recipe: RecipeNumericMeasure | null,
): boolean {
  if (!draft.enabled || recipe === null) {
    return !draft.enabled && recipe === null;
  }
  return structuredMeasureDraftMatchesRecipe(draft.value, recipe);
}

export function structuredActionDraftsMatchRecipe(
  drafts: readonly StructuredActionDraft[],
  originals: readonly RecipeInstructionAction[],
  ingredientKeyByOccurrenceId: ReadonlyMap<string, string>,
): boolean {
  const orderedOriginals = [...originals].sort(
    (left, right) => left.display_order - right.display_order,
  );
  if (drafts.length !== orderedOriginals.length) {
    return false;
  }

  return drafts.every((draft, index) => {
    const original = orderedOriginals[index];
    if (!original || draft.sourceId !== original.id) {
      return false;
    }
    const expectedIngredientKeys = original.ingredient_occurrence_ids.map((id) =>
      ingredientKeyByOccurrenceId.get(id),
    );
    return (
      draft.actionType?.id === original.action_type.id &&
      expectedIngredientKeys.every(Boolean) &&
      draft.ingredientKeys.length === expectedIngredientKeys.length &&
      draft.ingredientKeys.every((key, ingredientIndex) =>
        key === expectedIngredientKeys[ingredientIndex]
      ) &&
      numericDraftMatchesRecipe(draft.duration, original.duration) &&
      numericDraftMatchesRecipe(draft.temperature, original.temperature)
    );
  });
}

function numericMeasureInput(
  measure: VariantMeasureInput,
): NumericMeasureInput | null {
  if (measure.kind === "qualitative") {
    return null;
  }
  if (measure.kind === "exact") {
    return { kind: "exact", value: measure.value, unit_id: measure.unit_id };
  }
  return {
    kind: "range",
    minimum: measure.minimum,
    maximum: measure.maximum,
    unit_id: measure.unit_id,
  };
}

function validateOptionalMeasure(
  draft: OptionalStructuredMeasureDraft,
  kind: "duration" | "temperature",
  units: readonly CatalogUnit[],
): {
  errors: Partial<Record<StructuredMeasureField, string>>;
  measure: NumericMeasureInput | null;
} {
  if (!draft.enabled) {
    return { errors: {}, measure: null };
  }
  const validation = validateStructuredMeasureDraft(
    draft.value,
    kind === "duration" ? durationPolicy : temperaturePolicy,
    units,
  );
  return {
    errors: validation.fieldErrors,
    measure: validation.measure ? numericMeasureInput(validation.measure) : null,
  };
}

export function structuredActionFieldKey(
  actionKey: string,
  field: "type" | "inputs" | "duration" | "temperature",
  measureField?: StructuredMeasureField,
): string {
  return measureField
    ? `${actionKey}.${field}.${measureField}`
    : `${actionKey}.${field}`;
}

export function validateStructuredActionDrafts(
  drafts: readonly StructuredActionDraft[],
  actionTypes: readonly CatalogActionType[],
  occurrences: readonly IngredientOccurrenceOption[],
  units: readonly CatalogUnit[],
  allowedHistoricalTypeIds: ReadonlySet<string> = new Set(),
): StructuredActionValidation {
  const fieldErrors: Record<string, string> = {};
  const actions: StructuredActionInput[] = [];
  const activeTypes = new Map(
    actionTypes.filter((item) => item.active).map((item) => [item.id, item]),
  );
  const occurrenceByKey = new Map(occurrences.map((item) => [item.key, item]));

  if (drafts.length === 0) {
    fieldErrors.actions = "Add at least one cooking action.";
    return { fieldErrors, actions: null };
  }
  if (drafts.length > MAX_STRUCTURED_ACTIONS_PER_INSTRUCTION) {
    fieldErrors.actions = `Use no more than ${MAX_STRUCTURED_ACTIONS_PER_INSTRUCTION} cooking actions in one step.`;
  }

  for (const draft of drafts) {
    const selectedTypeId = draft.actionType?.id ?? null;
    const typeAllowed = Boolean(
      selectedTypeId &&
        (activeTypes.has(selectedTypeId) || allowedHistoricalTypeIds.has(selectedTypeId)),
    );
    if (!typeAllowed) {
      fieldErrors[structuredActionFieldKey(draft.key, "type")] = draft.actionType
        ? "Choose an available cooking action."
        : "Choose a cooking action.";
    }

    const uniqueIngredientKeys = new Set(draft.ingredientKeys);
    const selectedOccurrences = draft.ingredientKeys.map((key) => occurrenceByKey.get(key));
    if (
      uniqueIngredientKeys.size !== draft.ingredientKeys.length ||
      selectedOccurrences.some((item) => !item || item.removed)
    ) {
      fieldErrors[structuredActionFieldKey(draft.key, "inputs")] =
        "Choose each available ingredient occurrence at most once, or restore the removed ingredient.";
    }

    const duration = validateOptionalMeasure(draft.duration, "duration", units);
    for (const [field, message] of Object.entries(duration.errors)) {
      if (message) {
        fieldErrors[
          structuredActionFieldKey(
            draft.key,
            "duration",
            field as StructuredMeasureField,
          )
        ] = message;
      }
    }

    const temperature = validateOptionalMeasure(
      draft.temperature,
      "temperature",
      units,
    );
    for (const [field, message] of Object.entries(temperature.errors)) {
      if (message) {
        fieldErrors[
          structuredActionFieldKey(
            draft.key,
            "temperature",
            field as StructuredMeasureField,
          )
        ] = message;
      }
    }

    if (
      selectedTypeId &&
      typeAllowed &&
      selectedOccurrences.every((item) => item && !item.removed) &&
      uniqueIngredientKeys.size === draft.ingredientKeys.length &&
      (!draft.duration.enabled || duration.measure) &&
      (!draft.temperature.enabled || temperature.measure)
    ) {
      actions.push({
        action_type_id: selectedTypeId,
        ingredient_refs: selectedOccurrences.map((item) => item!.ref),
        ...(duration.measure ? { duration: duration.measure } : {}),
        ...(temperature.measure ? { temperature: temperature.measure } : {}),
      });
    }
  }

  return {
    fieldErrors,
    actions: Object.keys(fieldErrors).length === 0 ? actions : null,
  };
}

function effectiveNumericState(draft: OptionalStructuredMeasureDraft) {
  if (!draft.enabled) {
    return null;
  }
  const measure = draft.value;
  if (measure.mode === "exact") {
    return {
      mode: measure.mode,
      value: measure.exactValue.trim(),
      unitId: measure.unit?.id ?? null,
    };
  }
  if (measure.mode === "range") {
    return {
      mode: measure.mode,
      minimum: measure.rangeMinimum.trim(),
      maximum: measure.rangeMaximum.trim(),
      unitId: measure.unit?.id ?? null,
    };
  }
  return { mode: measure.mode };
}

export function effectiveStructuredActionState(
  drafts: readonly StructuredActionDraft[],
  originals: readonly RecipeInstructionAction[],
  ingredientKeyByOccurrenceId: ReadonlyMap<string, string>,
) {
  if (structuredActionDraftsMatchRecipe(drafts, originals, ingredientKeyByOccurrenceId)) {
    return { matchesOriginal: true };
  }
  return drafts.map((draft) => ({
    sourceId: draft.sourceId,
    actionTypeId: draft.actionType?.id ?? null,
    ingredientKeys: draft.ingredientKeys,
    duration: effectiveNumericState(draft.duration),
    temperature: effectiveNumericState(draft.temperature),
  }));
}

export function numericallyEquivalentOptionalMeasure(
  left: OptionalStructuredMeasureDraft,
  right: OptionalStructuredMeasureDraft,
): boolean {
  if (left.enabled !== right.enabled) {
    return false;
  }
  if (!left.enabled) {
    return true;
  }
  if (left.value.mode !== right.value.mode || left.value.unit?.id !== right.value.unit?.id) {
    return false;
  }
  if (left.value.mode === "exact" && right.value.mode === "exact") {
    return compareDecimalStrings(left.value.exactValue, right.value.exactValue) === 0;
  }
  if (left.value.mode === "range" && right.value.mode === "range") {
    return (
      compareDecimalStrings(left.value.rangeMinimum, right.value.rangeMinimum) === 0 &&
      compareDecimalStrings(left.value.rangeMaximum, right.value.rangeMaximum) === 0
    );
  }
  return false;
}
