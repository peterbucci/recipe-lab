import type {
  RecipeDraftEditorState,
  RecipeDraftIngredientState,
  RecipeDraftInstructionState,
} from "./recipe-draft";

type MoveDirection = -1 | 1;

function replaceRow<T extends { key: string }>(
  rows: readonly T[],
  key: string,
  replacement: T,
): T[] | null {
  if (replacement.key !== key) return null;
  const index = rows.findIndex((row) => row.key === key);
  if (index < 0 || rows[index] === replacement) return null;

  const next = [...rows];
  next[index] = replacement;
  return next;
}

function appendRow<T extends { key: string }>(
  rows: readonly T[],
  row: T,
): T[] | null {
  if (rows.some((existing) => existing.key === row.key)) return null;
  return [...rows, row];
}

function removeRow<T>(rows: readonly T[], index: number): T[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return null;
  return rows.filter((_, rowIndex) => rowIndex !== index);
}

function moveRow<T>(
  rows: readonly T[],
  index: number,
  direction: MoveDirection,
): T[] | null {
  if (!Number.isInteger(index) || (direction !== -1 && direction !== 1)) return null;
  const destination = index + direction;
  if (index < 0 || index >= rows.length || destination < 0 || destination >= rows.length) {
    return null;
  }

  const next = [...rows];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return null;
  next.splice(destination, 0, moved);
  return next;
}

export function replaceDraftIngredient(
  state: RecipeDraftEditorState,
  key: string,
  ingredient: RecipeDraftIngredientState,
): RecipeDraftEditorState {
  const ingredients = replaceRow(state.ingredients, key, ingredient);
  return ingredients ? { ...state, ingredients } : state;
}

export function appendDraftIngredient(
  state: RecipeDraftEditorState,
  ingredient: RecipeDraftIngredientState,
): RecipeDraftEditorState {
  const ingredients = appendRow(state.ingredients, ingredient);
  return ingredients ? { ...state, ingredients } : state;
}

export function removeDraftIngredient(
  state: RecipeDraftEditorState,
  index: number,
): RecipeDraftEditorState {
  const removed = state.ingredients[index];
  const ingredients = removeRow(state.ingredients, index);
  if (!removed || !ingredients) return state;

  const instructions = state.instructions.map((instruction) => {
    let changed = false;
    const actions = instruction.actions.map((action) => {
      if (!action.ingredientKeys.includes(removed.key)) return action;
      changed = true;
      return {
        ...action,
        ingredientKeys: action.ingredientKeys.filter((key) => key !== removed.key),
      };
    });
    return changed ? { ...instruction, actions } : instruction;
  });

  return { ...state, ingredients, instructions };
}

export function moveDraftIngredient(
  state: RecipeDraftEditorState,
  index: number,
  direction: MoveDirection,
): RecipeDraftEditorState {
  const ingredients = moveRow(state.ingredients, index, direction);
  return ingredients ? { ...state, ingredients } : state;
}

export function replaceDraftInstruction(
  state: RecipeDraftEditorState,
  key: string,
  instruction: RecipeDraftInstructionState,
): RecipeDraftEditorState {
  const instructions = replaceRow(state.instructions, key, instruction);
  return instructions ? { ...state, instructions } : state;
}

export function appendDraftInstruction(
  state: RecipeDraftEditorState,
  instruction: RecipeDraftInstructionState,
): RecipeDraftEditorState {
  const instructions = appendRow(state.instructions, instruction);
  return instructions ? { ...state, instructions } : state;
}

export function removeDraftInstruction(
  state: RecipeDraftEditorState,
  index: number,
): RecipeDraftEditorState {
  const instructions = removeRow(state.instructions, index);
  return instructions ? { ...state, instructions } : state;
}

export function moveDraftInstruction(
  state: RecipeDraftEditorState,
  index: number,
  direction: MoveDirection,
): RecipeDraftEditorState {
  const instructions = moveRow(state.instructions, index, direction);
  return instructions ? { ...state, instructions } : state;
}
