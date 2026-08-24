import { describe, expect, it } from "vitest";

import type { RecipeDetail } from "./recipe-api";
import {
  createAddedIngredientDraft,
  createAddedInstructionDraft,
  createVariantDraft,
  ingredientFieldKey,
  instructionFieldKey,
  validateVariantDraft,
} from "./variant-draft";

function sourceRecipe(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    id: "carrot-v1",
    lineage_id: "carrot-lineage",
    parent_version_id: null,
    version_number: 1,
    title: "Carrot Walnut Snack Cake",
    description: "A softly spiced snack cake.",
    servings: "8.00",
    created_at: "2026-08-20T00:00:00Z",
    average_rating: 4.5,
    rating_count: 2,
    viewer_state: {
      recipe_version_id: "carrot-v1",
      saved: false,
      rating: null,
    },
    parent: null,
    children: [],
    ingredients: [
      {
        id: "sugar-row",
        ingredient_id: "sugar",
        canonical_name: "Granulated sugar",
        display_name: "White sugar",
        quantity: "140.0000",
        unit: "g",
        preparation_notes: null,
        display_order: 0,
      },
      {
        id: "walnut-row",
        ingredient_id: "walnut",
        canonical_name: "Walnut",
        display_name: "Walnuts",
        quantity: "100.0000",
        unit: "g",
        preparation_notes: "roughly chopped",
        display_order: 1,
      },
    ],
    instructions: [
      { id: "mix-step", text: "Fold until just combined.", display_order: 0 },
      { id: "bake-step", text: "Bake until springy.", display_order: 1 },
    ],
    ...overrides,
  };
}

describe("variant draft", () => {
  it("creates an editable copy without changing the immutable source snapshot", () => {
    const source = sourceRecipe({ description: null });
    const sourceBefore = structuredClone(source);

    const draft = createVariantDraft(source);

    expect(draft).toEqual({
      title: "Carrot Walnut Snack Cake variation",
      description: "",
      servings: "8.00",
      ingredients: [
        {
          key: "source-sugar-row",
          sourceId: "sugar-row",
          sourceDisplayName: "White sugar",
          sourceCanonicalName: "Granulated sugar",
          ingredientName: "",
          quantity: "140.0000",
          originalQuantity: "140.0000",
          unit: "g",
          originalUnit: "g",
          preparationNotes: "",
          removed: false,
        },
        {
          key: "source-walnut-row",
          sourceId: "walnut-row",
          sourceDisplayName: "Walnuts",
          sourceCanonicalName: "Walnut",
          ingredientName: "",
          quantity: "100.0000",
          originalQuantity: "100.0000",
          unit: "g",
          originalUnit: "g",
          preparationNotes: "roughly chopped",
          removed: false,
        },
      ],
      instructions: [
        {
          key: "source-mix-step",
          sourceId: "mix-step",
          text: "Fold until just combined.",
          originalText: "Fold until just combined.",
          removed: false,
        },
        {
          key: "source-bake-step",
          sourceId: "bake-step",
          text: "Bake until springy.",
          originalText: "Bake until springy.",
          removed: false,
        },
      ],
    });
    expect(source).toEqual(sourceBefore);
  });

  it("maps only meaningful structured changes in stable source order", () => {
    const draft = createVariantDraft(sourceRecipe());
    draft.title = "  Orange Pecan Carrot Cake  ";
    draft.description = "   ";
    draft.servings = " 10.00 ";

    draft.ingredients[0].ingredientName = "  Pecan  ";
    draft.ingredients[0].quantity = " 125.5000 ";
    draft.ingredients[0].unit = "";

    draft.ingredients[1].removed = true;
    draft.ingredients[1].ingredientName = "Almond";
    draft.ingredients[1].quantity = "90";

    const addedIngredient = createAddedIngredientDraft("new-orange-zest");
    addedIngredient.ingredientName = "  Orange zest ";
    addedIngredient.quantity = " 1.25 ";
    addedIngredient.unit = " tbsp ";
    addedIngredient.preparationNotes = " finely grated ";
    draft.ingredients.push(addedIngredient);

    draft.instructions[0].text = "  Fold gently until just combined.  ";
    draft.instructions[1].removed = true;
    draft.instructions[1].text = "This edit must be suppressed.";
    const addedInstruction = createAddedInstructionDraft("new-cool-step");
    addedInstruction.text = "  Cool completely before serving. ";
    draft.instructions.push(addedInstruction);

    expect(validateVariantDraft(draft)).toEqual({
      fieldErrors: {},
      formErrors: [],
      payload: {
        title: "Orange Pecan Carrot Cake",
        description: null,
        servings: "10.00",
        ingredient_edits: [
          {
            op: "replace",
            recipe_ingredient_id: "sugar-row",
            ingredient_name: "Pecan",
          },
          {
            op: "set_quantity",
            recipe_ingredient_id: "sugar-row",
            quantity: "125.5000",
          },
          {
            op: "set_unit",
            recipe_ingredient_id: "sugar-row",
            unit: null,
          },
          { op: "remove", recipe_ingredient_id: "walnut-row" },
          {
            op: "add",
            ingredient_name: "Orange zest",
            quantity: "1.25",
            unit: "tbsp",
            preparation_notes: "finely grated",
          },
        ],
        instruction_edits: [
          {
            op: "update",
            recipe_instruction_id: "mix-step",
            text: "Fold gently until just combined.",
          },
          { op: "remove", recipe_instruction_id: "bake-step" },
          { op: "add", text: "Cool completely before serving." },
        ],
      },
    });
  });

  it("emits no edits for unchanged normalized source values", () => {
    const draft = createVariantDraft(sourceRecipe());
    draft.ingredients[0].quantity = " 140.0000 ";
    draft.ingredients[0].unit = " g ";
    draft.instructions[0].text = "  Fold until just combined.  ";

    const result = validateVariantDraft(draft);

    expect(result.fieldErrors).toEqual({});
    expect(result.formErrors).toEqual([]);
    expect(result.payload).toMatchObject({
      ingredient_edits: [],
      instruction_edits: [],
    });
  });

  it("accepts authored ingredient names without requiring a catalog match", () => {
    const draft = createVariantDraft(sourceRecipe());
    draft.ingredients[0].ingredientName = "Black lime powder (house blend)";
    const addedIngredient = createAddedIngredientDraft("new-spruce-tip-jam");
    addedIngredient.ingredientName = "Fermented Spruce-Tip Jam #2";
    draft.ingredients.push(addedIngredient);

    const result = validateVariantDraft(draft);

    expect(result.fieldErrors).toEqual({});
    expect(result.formErrors).toEqual([]);
    expect(result.payload?.ingredient_edits).toEqual([
      {
        op: "replace",
        recipe_ingredient_id: "sugar-row",
        ingredient_name: "Black lime powder (house blend)",
      },
      {
        op: "add",
        ingredient_name: "Fermented Spruce-Tip Jam #2",
        quantity: null,
        unit: null,
        preparation_notes: null,
      },
    ]);
  });

  it("allows a linked alias to be replaced with its canonical catalog name", () => {
    const draft = createVariantDraft(sourceRecipe());
    draft.ingredients[0].ingredientName = "  Granulated sugar  ";

    const result = validateVariantDraft(draft);

    expect(result.fieldErrors).toEqual({});
    expect(result.formErrors).toEqual([]);
    expect(result.payload?.ingredient_edits).toEqual([
      {
        op: "replace",
        recipe_ingredient_id: "sugar-row",
        ingredient_name: "Granulated sugar",
      },
    ]);
  });

  it("does not reject source-only fields that the editor cannot change", () => {
    const source = sourceRecipe({
      ingredients: [
        {
          ...sourceRecipe().ingredients[0],
          preparation_notes: "n".repeat(1_001),
        },
      ],
      instructions: [
        {
          ...sourceRecipe().instructions[0],
          text: "s".repeat(5_001),
        },
      ],
    });
    const draft = createVariantDraft(source);

    const result = validateVariantDraft(draft);

    expect(result.fieldErrors).toEqual({});
    expect(result.formErrors).toEqual([]);
    expect(result.payload).toMatchObject({
      ingredient_edits: [],
      instruction_edits: [],
    });
  });

  it("reports field errors without mutating or clearing invalid user input", () => {
    const draft = createVariantDraft(sourceRecipe());
    draft.title = "   ";
    draft.description = "contains\0nul";
    draft.servings = "0.00";
    draft.ingredients[0].ingredientName = " White sugar ";
    draft.ingredients[0].quantity = "1.00001";

    const addedIngredient = createAddedIngredientDraft("new-invalid");
    addedIngredient.ingredientName = "   ";
    addedIngredient.quantity = "-2";
    draft.ingredients.push(addedIngredient);

    draft.instructions[0].text = "   ";
    const beforeValidation = structuredClone(draft);

    const result = validateVariantDraft(draft);

    expect(result.payload).toBeNull();
    expect(result.formErrors).toEqual([]);
    expect(result.fieldErrors).toMatchObject({
      title: "Version title is required.",
      description: "Description contains an unsupported character.",
      servings: "Servings must be greater than zero.",
      [ingredientFieldKey("source-sugar-row", "name")]:
        "Choose a different ingredient or leave the replacement blank.",
      [ingredientFieldKey("source-sugar-row", "quantity")]:
        "Quantity can have at most 4 decimal places.",
      [ingredientFieldKey("new-invalid", "name")]: "Ingredient name is required.",
      [ingredientFieldKey("new-invalid", "quantity")]:
        "Quantity must be a positive decimal number.",
      [instructionFieldKey("source-mix-step")]: "Instruction is required.",
    });
    expect(draft).toEqual(beforeValidation);
  });

  it("rejects drafts that remove every ingredient or instruction and keeps removal state", () => {
    const draft = createVariantDraft(sourceRecipe());
    for (const ingredient of draft.ingredients) {
      ingredient.removed = true;
    }
    for (const instruction of draft.instructions) {
      instruction.removed = true;
    }
    const beforeValidation = structuredClone(draft);

    const result = validateVariantDraft(draft);

    expect(result.payload).toBeNull();
    expect(result.fieldErrors).toEqual({});
    expect(result.formErrors).toEqual([
      "Keep or add at least one ingredient.",
      "Keep or add at least one instruction.",
    ]);
    expect(draft).toEqual(beforeValidation);
  });

  it("ignores newly added rows that users remove before submission", () => {
    const draft = createVariantDraft(sourceRecipe());
    const ingredient = createAddedIngredientDraft("discarded-ingredient");
    ingredient.ingredientName = "Orange zest";
    ingredient.removed = true;
    draft.ingredients.push(ingredient);
    const instruction = createAddedInstructionDraft("discarded-instruction");
    instruction.text = "Discard this step.";
    instruction.removed = true;
    draft.instructions.push(instruction);

    const result = validateVariantDraft(draft);

    expect(result.payload).toMatchObject({
      ingredient_edits: [],
      instruction_edits: [],
    });
  });
});
