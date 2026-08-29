import { describe, expect, it } from "vitest";

import {
  createDraftIngredientState,
  createDraftInstructionState,
  type RecipeDraftEditorState,
} from "./recipe-draft";
import {
  appendDraftIngredient,
  appendDraftInstruction,
  moveDraftIngredient,
  moveDraftInstruction,
  removeDraftIngredient,
  removeDraftInstruction,
  replaceDraftIngredient,
  replaceDraftInstruction,
} from "./recipe-draft-editor-transforms";
import { createStructuredActionDraft } from "./structured-action";

function editorState(): RecipeDraftEditorState {
  return {
    title: "Bread",
    description: "A test draft",
    servings: "4",
    ingredients: [
      createDraftIngredientState("ingredient-a"),
      createDraftIngredientState("ingredient-b"),
      createDraftIngredientState("ingredient-c"),
    ],
    instructions: [
      createDraftInstructionState("instruction-a"),
      createDraftInstructionState("instruction-b"),
      createDraftInstructionState("instruction-c"),
    ],
  };
}

describe("recipe draft editor transformations", () => {
  it("replaces and appends caller-created rows without mutating the draft", () => {
    const original = editorState();
    const replacementIngredient = {
      ...original.ingredients[1]!,
      preparationNotes: "sifted",
    };
    const replacementInstruction = {
      ...original.instructions[1]!,
      text: "Fold gently.",
    };
    const newIngredient = createDraftIngredientState("ingredient-new");
    const newInstruction = createDraftInstructionState("instruction-new");

    const withIngredient = replaceDraftIngredient(
      original,
      "ingredient-b",
      replacementIngredient,
    );
    const withInstruction = replaceDraftInstruction(
      withIngredient,
      "instruction-b",
      replacementInstruction,
    );
    const withAppendedIngredient = appendDraftIngredient(withInstruction, newIngredient);
    const result = appendDraftInstruction(withAppendedIngredient, newInstruction);

    expect(result).not.toBe(original);
    expect(result.ingredients).not.toBe(original.ingredients);
    expect(result.instructions).not.toBe(original.instructions);
    expect(result.ingredients[1]).toBe(replacementIngredient);
    expect(result.instructions[1]).toBe(replacementInstruction);
    expect(result.ingredients.at(-1)).toBe(newIngredient);
    expect(result.instructions.at(-1)).toBe(newInstruction);
    expect(original.ingredients[1]?.preparationNotes).toBe("");
    expect(original.instructions[1]?.text).toBe("");
  });

  it("moves and removes ingredients and instructions in order", () => {
    const original = editorState();

    const movedIngredients = moveDraftIngredient(original, 2, -1);
    const movedInstructions = moveDraftInstruction(movedIngredients, 0, 1);
    const withoutIngredient = removeDraftIngredient(movedInstructions, 0);
    const result = removeDraftInstruction(withoutIngredient, 2);

    expect(result.ingredients.map((row) => row.key)).toEqual([
      "ingredient-c",
      "ingredient-b",
    ]);
    expect(result.instructions.map((row) => row.key)).toEqual([
      "instruction-b",
      "instruction-a",
    ]);
    expect(original.ingredients.map((row) => row.key)).toEqual([
      "ingredient-a",
      "ingredient-b",
      "ingredient-c",
    ]);
    expect(original.instructions.map((row) => row.key)).toEqual([
      "instruction-a",
      "instruction-b",
      "instruction-c",
    ]);
  });

  it("returns the original draft for invalid or boundary operations", () => {
    const original = editorState();

    expect(
      replaceDraftIngredient(
        original,
        "missing",
        createDraftIngredientState("missing"),
      ),
    ).toBe(original);
    expect(
      replaceDraftIngredient(
        original,
        "ingredient-a",
        createDraftIngredientState("different-key"),
      ),
    ).toBe(original);
    expect(appendDraftIngredient(original, original.ingredients[0]!)).toBe(original);
    expect(removeDraftIngredient(original, -1)).toBe(original);
    expect(removeDraftIngredient(original, original.ingredients.length)).toBe(original);
    expect(moveDraftIngredient(original, 0, -1)).toBe(original);
    expect(moveDraftIngredient(original, original.ingredients.length - 1, 1)).toBe(original);

    expect(
      replaceDraftInstruction(
        original,
        "missing",
        createDraftInstructionState("missing"),
      ),
    ).toBe(original);
    expect(appendDraftInstruction(original, original.instructions[0]!)).toBe(original);
    expect(removeDraftInstruction(original, 1.5)).toBe(original);
    expect(moveDraftInstruction(original, 0, -1)).toBe(original);
    expect(moveDraftInstruction(original, original.instructions.length - 1, 1)).toBe(original);
  });

  it("removes deleted ingredient references from every action without changing other data", () => {
    const original = editorState();
    const referencedAction = createStructuredActionDraft("action-referenced");
    referencedAction.sourceId = "source-action";
    referencedAction.actionType = {
      id: "action-type-mix",
      key: "mix",
      canonical_verb: "Mix",
      active: true,
    };
    referencedAction.ingredientKeys = [
      "ingredient-c",
      "ingredient-b",
      "ingredient-a",
      "ingredient-b",
    ];
    referencedAction.duration.enabled = true;
    referencedAction.duration.value.exactValue = "5";
    const unrelatedAction = createStructuredActionDraft("action-unrelated");
    unrelatedAction.ingredientKeys = ["ingredient-a"];
    original.instructions[0] = {
      ...original.instructions[0]!,
      text: "Mix everything.",
      actions: [referencedAction, unrelatedAction],
    };

    const result = removeDraftIngredient(original, 1);

    expect(result.instructions.map((row) => row.key)).toEqual(
      original.instructions.map((row) => row.key),
    );
    expect(result.instructions[0]?.actions.map((action) => action.key)).toEqual([
      "action-referenced",
      "action-unrelated",
    ]);
    expect(result.instructions[0]?.actions[0]).toEqual({
      ...referencedAction,
      ingredientKeys: ["ingredient-c", "ingredient-a"],
    });
    expect(result.instructions[0]?.actions[0]).not.toBe(referencedAction);
    expect(result.instructions[0]?.actions[1]).toBe(unrelatedAction);
    expect(result.instructions[1]).toBe(original.instructions[1]);
    expect(referencedAction.ingredientKeys).toEqual([
      "ingredient-c",
      "ingredient-b",
      "ingredient-a",
      "ingredient-b",
    ]);
  });
});
