import type {
  RecipeDetail,
  RecipeDiff,
  RecipeFieldChange,
  RecipeFieldName,
  RecipeIngredient,
  RecipeIngredientChangedField,
  RecipeInstruction,
  RecipeInstructionActionMatch,
  RecipeInstructionChangedField,
} from "../shared/recipe-contracts";

export type RecipeComparisonRowStatus =
  | "unchanged"
  | "added"
  | "removed"
  | "changed";

export type RecipeIngredientChangeKind = "modified" | "substitution";

export interface RecipeIngredientComparisonRow {
  key: string;
  status: RecipeComparisonRowStatus;
  changeKind: RecipeIngredientChangeKind | null;
  current: RecipeIngredient | null;
  previous: RecipeIngredient | null;
  changedFields: readonly RecipeIngredientChangedField[];
  displayOrder: number;
}

export interface RecipeInstructionComparisonRow {
  key: string;
  status: RecipeComparisonRowStatus;
  current: RecipeInstruction | null;
  previous: RecipeInstruction | null;
  changedFields: readonly RecipeInstructionChangedField[];
  unchangedActionPairs: readonly RecipeInstructionActionMatch[];
  displayOrder: number;
}

export interface RecipeComparisonModel {
  recipe: RecipeDetail;
  diff: RecipeDiff;
  ingredientRows: readonly RecipeIngredientComparisonRow[];
  instructionRows: readonly RecipeInstructionComparisonRow[];
  metadataChanges: Readonly<
    Partial<Record<RecipeFieldName, RecipeFieldChange>>
  >;
  ingredientChangeCount: number;
  instructionChangeCount: number;
  metadataChangeCount: number;
  totalChanges: number;
  hasChanges: boolean;
}

function compareRows(
  left: { displayOrder: number; status: RecipeComparisonRowStatus; key: string },
  right: { displayOrder: number; status: RecipeComparisonRowStatus; key: string },
): number {
  if (left.displayOrder !== right.displayOrder) {
    return left.displayOrder - right.displayOrder;
  }

  if (left.status === "removed" && right.status !== "removed") return -1;
  if (left.status !== "removed" && right.status === "removed") return 1;
  if (left.status === "removed" && right.status === "removed") {
    return left.key.localeCompare(right.key);
  }
  return 0;
}

function ingredientRows(
  recipe: RecipeDetail,
  diff: RecipeDiff,
): RecipeIngredientComparisonRow[] {
  const addedIds = new Set(diff.ingredients.added.map((item) => item.id));
  const pairedByCurrentId = new Map<
    string,
    {
      before: RecipeIngredient;
      changedFields: readonly RecipeIngredientChangedField[];
      changeKind: RecipeIngredientChangeKind;
    }
  >();

  for (const change of diff.ingredients.modified) {
    pairedByCurrentId.set(change.after.id, {
      before: change.before,
      changedFields: change.changed_fields,
      changeKind: "modified",
    });
  }
  for (const change of diff.ingredients.replaced) {
    pairedByCurrentId.set(change.after.id, {
      before: change.before,
      changedFields: change.changed_fields,
      changeKind: "substitution",
    });
  }

  const rows = recipe.ingredients.map<RecipeIngredientComparisonRow>(
    (current) => {
      const pair = pairedByCurrentId.get(current.id);
      if (pair) {
        return {
          key: `current:${current.id}`,
          status: "changed",
          changeKind: pair.changeKind,
          current,
          previous: pair.before,
          changedFields: pair.changedFields,
          displayOrder: current.display_order,
        };
      }
      if (addedIds.has(current.id)) {
        return {
          key: `current:${current.id}`,
          status: "added",
          changeKind: null,
          current,
          previous: null,
          changedFields: [],
          displayOrder: current.display_order,
        };
      }
      return {
        key: `current:${current.id}`,
        status: "unchanged",
        changeKind: null,
        current,
        previous: null,
        changedFields: [],
        displayOrder: current.display_order,
      };
    },
  );

  for (const previous of diff.ingredients.removed) {
    rows.push({
      key: `removed:${previous.id}`,
      status: "removed",
      changeKind: null,
      current: null,
      previous,
      changedFields: [],
      displayOrder: previous.display_order,
    });
  }

  return rows.sort(compareRows);
}

function instructionRows(
  recipe: RecipeDetail,
  diff: RecipeDiff,
): RecipeInstructionComparisonRow[] {
  const addedIds = new Set(diff.instructions.added.map((item) => item.id));
  const modifiedByCurrentId = new Map(
    diff.instructions.modified.map((change) => [change.after.id, change]),
  );

  const rows = recipe.instructions.map<RecipeInstructionComparisonRow>(
    (current) => {
      const change = modifiedByCurrentId.get(current.id);
      if (change) {
        return {
          key: `current:${current.id}`,
          status: "changed",
          current,
          previous: change.before,
          changedFields: change.changed_fields,
          unchangedActionPairs: change.unchanged_action_pairs ?? [],
          displayOrder: current.display_order,
        };
      }
      if (addedIds.has(current.id)) {
        return {
          key: `current:${current.id}`,
          status: "added",
          current,
          previous: null,
          changedFields: [],
          unchangedActionPairs: [],
          displayOrder: current.display_order,
        };
      }
      return {
        key: `current:${current.id}`,
        status: "unchanged",
        current,
        previous: null,
        changedFields: [],
        unchangedActionPairs: [],
        displayOrder: current.display_order,
      };
    },
  );

  for (const previous of diff.instructions.removed) {
    rows.push({
      key: `removed:${previous.id}`,
      status: "removed",
      current: null,
      previous,
      changedFields: [],
      unchangedActionPairs: [],
      displayOrder: previous.display_order,
    });
  }

  return rows.sort(compareRows);
}

function metadataChanges(
  diff: RecipeDiff,
): Partial<Record<RecipeFieldName, RecipeFieldChange>> {
  return Object.fromEntries(
    diff.metadata_changes.map((change) => [change.field, change]),
  );
}

export function buildRecipeComparisonModel(
  recipe: RecipeDetail,
  diff: RecipeDiff,
): RecipeComparisonModel {
  const ingredients = ingredientRows(recipe, diff);
  const instructions = instructionRows(recipe, diff);
  const ingredientChangeCount =
    diff.ingredients.added.length +
    diff.ingredients.removed.length +
    diff.ingredients.replaced.length +
    diff.ingredients.modified.length;
  const instructionChangeCount =
    diff.instructions.added.length +
    diff.instructions.removed.length +
    diff.instructions.modified.length;
  const metadataChangeCount = diff.metadata_changes.length;
  const totalChanges =
    ingredientChangeCount + instructionChangeCount + metadataChangeCount;

  return {
    recipe,
    diff,
    ingredientRows: ingredients,
    instructionRows: instructions,
    metadataChanges: metadataChanges(diff),
    ingredientChangeCount,
    instructionChangeCount,
    metadataChangeCount,
    totalChanges,
    hasChanges: totalChanges > 0,
  };
}
