import { describe, expect, it } from "vitest";

import type { CatalogActionType } from "./cooking-action-api";
import type { CatalogUnit } from "./measurement-unit-api";
import type { RecipeDetail } from "./recipe-api";
import {
  createStructuredActionDraft,
  structuredActionFieldKey,
} from "./structured-action";
import {
  createAddedIngredientDraft,
  createAddedInstructionDraft,
  createVariantDraft,
  ingredientFieldKey,
  ingredientMeasureFieldKey,
  instructionActionsFieldKey,
  instructionFieldKey,
  validateVariantDraft,
} from "./variant-draft";

const SUGAR_ID = "11111111-1111-4111-8111-111111111111";
const WALNUT_ID = "22222222-2222-4222-8222-222222222222";
const PECAN_ID = "33333333-3333-4333-8333-333333333333";
const ORANGE_ZEST_ID = "55555555-5555-4555-8555-555555555555";
const GRAM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TABLESPOON_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIX_ACTION_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const BAKE_ACTION_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const actionTypes: CatalogActionType[] = [
  {
    id: MIX_ACTION_ID,
    key: "mix",
    canonical_verb: "mix",
    active: true,
    provenance: "Test fixture",
  },
  {
    id: BAKE_ACTION_ID,
    key: "bake",
    canonical_verb: "bake",
    active: true,
    provenance: "Test fixture",
  },
];

function action(id: string, type: CatalogActionType, ingredientIds: string[] = []) {
  return {
    id,
    action_type: {
      id: type.id,
      key: type.key,
      canonical_verb: type.canonical_verb,
      active: type.active,
    },
    display_order: 0,
    ingredient_occurrence_ids: ingredientIds,
    duration: null,
    temperature: null,
  };
}

const units: CatalogUnit[] = [
  {
    id: GRAM_ID,
    key: "gram",
    dimension: "mass",
    canonical_label: "gram",
    plural_label: "grams",
    symbol: "g",
    display_style: "symbol",
    aliases: ["gram", "grams"],
    active: true,
    provenance: "Test fixture",
  },
  {
    id: TABLESPOON_ID,
    key: "tablespoon",
    dimension: "volume",
    canonical_label: "tablespoon",
    plural_label: "tablespoons",
    symbol: "tbsp",
    display_style: "symbol",
    aliases: ["tablespoon"],
    active: true,
    provenance: "Test fixture",
  },
];

const gramSummary = {
  id: GRAM_ID,
  key: "gram",
  dimension: "mass" as const,
  canonical_label: "gram",
  plural_label: "grams",
  symbol: "g",
  display_style: "symbol" as const,
  active: true,
};

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
    author: { id: "catalog-cook", handle: "recipe-lab", display_name: "Recipe Lab catalog" },
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
        ingredient_id: SUGAR_ID,
        canonical_name: "Granulated sugar",
        display_name: "White sugar",
        measure: {
          kind: "exact",
          value: "140.0000",
          unit: gramSummary,
          display_unit: "g",
          display: "140 g",
        },
        preparation_notes: null,
        display_order: 0,
      },
      {
        id: "walnut-row",
        ingredient_id: WALNUT_ID,
        canonical_name: "Walnut",
        display_name: "Walnuts",
        measure: {
          kind: "exact",
          value: "100.0000",
          unit: gramSummary,
          display_unit: "g",
          display: "100 g",
        },
        preparation_notes: "roughly chopped",
        display_order: 1,
      },
    ],
    instructions: [
      {
        id: "mix-step",
        text: "Fold until just combined.",
        display_order: 0,
        actions: [action("mix-action", actionTypes[0], ["sugar-row"])],
      },
      {
        id: "bake-step",
        text: "Bake until springy.",
        display_order: 1,
        actions: [action("bake-action", actionTypes[1])],
      },
    ],
    ...overrides,
  };
}

describe("variant draft", () => {
  it("creates a human-friendly editable measure without changing the fixed-scale source snapshot", () => {
    const source = sourceRecipe({ description: null });
    const sourceBefore = structuredClone(source);

    const draft = createVariantDraft(source);

    expect(draft.description).toBe("");
    expect(draft.ingredients[0]).toMatchObject({
      key: "source-sugar-row",
      sourceId: "sugar-row",
      selectedIngredient: null,
      measure: {
        mode: "exact",
        exactValue: "140",
        rangeMinimum: "",
        rangeMaximum: "",
        unit: gramSummary,
      },
      originalMeasure: source.ingredients[0].measure,
      preparationNotes: "",
      removed: false,
    });
    expect(source.ingredients[0]?.measure).toMatchObject({
      kind: "exact",
      value: "140.0000",
    });
    draft.ingredients[0].measure.exactValue = "125";
    expect(source).toEqual(sourceBefore);
  });

  it("maps meaningful changes to one atomic measure edit in stable source order", () => {
    const draft = createVariantDraft(sourceRecipe());
    draft.title = "  Orange Pecan Carrot Cake  ";
    draft.description = "   ";
    draft.servings = " 10.00 ";
    draft.ingredients[0].selectedIngredient = {
      ingredientId: PECAN_ID,
      canonicalName: "Pecan",
      displayName: "Pecan",
    };
    draft.ingredients[0].measure.exactValue = " 125.5000 ";
    draft.ingredients[1].removed = true;

    const addedIngredient = createAddedIngredientDraft("new-orange-zest");
    addedIngredient.selectedIngredient = {
      ingredientId: ORANGE_ZEST_ID,
      canonicalName: "Orange zest",
      displayName: "Orange zest",
    };
    addedIngredient.measure = {
      ...addedIngredient.measure,
      mode: "exact",
      exactValue: " 1.25 ",
      unit: {
        id: TABLESPOON_ID,
        key: "tablespoon",
        dimension: "volume",
        canonical_label: "tablespoon",
        plural_label: "tablespoons",
        symbol: "tbsp",
        display_style: "symbol",
        active: true,
      },
    };
    addedIngredient.preparationNotes = " finely grated ";
    draft.ingredients.push(addedIngredient);

    draft.instructions[0].text = "  Fold gently until just combined.  ";
    draft.instructions[1].removed = true;
    const addedInstruction = createAddedInstructionDraft("new-cool-step");
    addedInstruction.text = "  Cool completely before serving. ";
    const coolAction = createStructuredActionDraft("new-cool-action");
    coolAction.actionType = {
      id: BAKE_ACTION_ID,
      key: "bake",
      canonical_verb: "bake",
      active: true,
    };
    addedInstruction.actions = [coolAction];
    draft.instructions.push(addedInstruction);

    expect(validateVariantDraft(draft, units, actionTypes)).toEqual({
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
            ingredient_id: PECAN_ID,
            display_name: "Pecan",
          },
          {
            op: "set_measure",
            recipe_ingredient_id: "sugar-row",
            measure: { kind: "exact", value: "125.5000", unit_id: GRAM_ID },
          },
          { op: "remove", recipe_ingredient_id: "walnut-row" },
          {
            op: "add",
            edit_ref: "new-orange-zest",
            ingredient_id: ORANGE_ZEST_ID,
            display_name: "Orange zest",
            measure: { kind: "exact", value: "1.25", unit_id: TABLESPOON_ID },
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
          {
            op: "add",
            text: "Cool completely before serving.",
            actions: [
              {
                action_type_id: BAKE_ACTION_ID,
                ingredient_refs: [],
              },
            ],
          },
        ],
      },
    });
  });

  it("emits no edits for unchanged normalized values", () => {
    const draft = createVariantDraft(sourceRecipe());
    draft.ingredients[0].measure.exactValue = " 140.0000 ";
    draft.instructions[0].text = "  Fold until just combined.  ";

    expect(validateVariantDraft(draft, units, actionTypes).payload).toMatchObject({
      ingredient_edits: [],
      instruction_edits: [],
    });
  });

  it("copies an unchanged inherited inactive action without making it selectable again", () => {
    const source = sourceRecipe();
    source.instructions[0].actions[0].action_type = {
      id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9",
      key: "retired",
      canonical_verb: "retired",
      active: false,
    };
    const draft = createVariantDraft(source);

    expect(validateVariantDraft(draft, units, actionTypes)).toMatchObject({
      fieldErrors: {},
      formErrors: [],
      payload: { ingredient_edits: [], instruction_edits: [] },
    });
    expect(draft.instructions[0].actions[0].actionType).toMatchObject({
      canonical_verb: "retired",
      active: false,
    });
  });

  it("preserves an unchanged action while reporting its removed ingredient input inline", () => {
    const draft = createVariantDraft(sourceRecipe());
    draft.ingredients[0].removed = true;
    const beforeValidation = structuredClone(draft.instructions[0].actions);

    const result = validateVariantDraft(draft, units, actionTypes);

    expect(result.payload).toBeNull();
    expect(result.fieldErrors).toMatchObject({
      [`instruction.source-mix-step.action.${structuredActionFieldKey(
        "source-action-mix-action",
        "inputs",
      )}`]: expect.stringContaining("restore the removed ingredient"),
    });
    expect(draft.instructions[0].actions).toEqual(beforeValidation);

    draft.ingredients[0].removed = false;
    expect(validateVariantDraft(draft, units, actionTypes).payload).toMatchObject({
      ingredient_edits: [],
      instruction_edits: [],
    });
  });

  it("emits set_actions when only authored action order changes", () => {
    const source = sourceRecipe();
    const second = action("second-mix-action", actionTypes[0], ["sugar-row"]);
    second.display_order = 1;
    source.instructions[0].actions.push(second);
    const draft = createVariantDraft(source);
    draft.instructions[0].actions.reverse();

    expect(validateVariantDraft(draft, units, actionTypes).payload?.instruction_edits).toEqual([
      {
        op: "set_actions",
        recipe_instruction_id: "mix-step",
        actions: [
          {
            action_type_id: MIX_ACTION_ID,
            ingredient_refs: [
              { kind: "existing", recipe_ingredient_id: "sugar-row" },
            ],
          },
          {
            action_type_id: MIX_ACTION_ID,
            ingredient_refs: [
              { kind: "existing", recipe_ingredient_id: "sugar-row" },
            ],
          },
        ],
      },
    ]);
  });

  it("links actions to same-request added ingredient occurrences by stable edit reference", () => {
    const draft = createVariantDraft(sourceRecipe());
    const addedIngredient = createAddedIngredientDraft("new-orange-zest");
    addedIngredient.selectedIngredient = {
      ingredientId: ORANGE_ZEST_ID,
      canonicalName: "Orange zest",
      displayName: "Orange zest",
    };
    draft.ingredients.push(addedIngredient);
    const addedInstruction = createAddedInstructionDraft("new-zest-step");
    addedInstruction.text = "Mix in the zest.";
    const mixAction = createStructuredActionDraft("new-zest-action");
    mixAction.actionType = {
      id: MIX_ACTION_ID,
      key: "mix",
      canonical_verb: "mix",
      active: true,
    };
    mixAction.ingredientKeys = [addedIngredient.key];
    addedInstruction.actions = [mixAction];
    draft.instructions.push(addedInstruction);

    expect(validateVariantDraft(draft, units, actionTypes).payload).toMatchObject({
      ingredient_edits: [
        {
          op: "add",
          edit_ref: "new-orange-zest",
          ingredient_id: ORANGE_ZEST_ID,
        },
      ],
      instruction_edits: [
        {
          op: "add",
          text: "Mix in the zest.",
          actions: [
            {
              action_type_id: MIX_ACTION_ID,
              ingredient_refs: [
                { kind: "added", ingredient_edit_ref: "new-orange-zest" },
              ],
            },
          ],
        },
      ],
    });
  });

  it("blocks publication of structurally incomplete legacy steps until actions are mapped", () => {
    const source = sourceRecipe();
    source.instructions[0].actions = [];

    const result = validateVariantDraft(createVariantDraft(source), units, actionTypes);

    expect(result.payload).toBeNull();
    expect(result.fieldErrors).toEqual({
      [instructionActionsFieldKey("source-mix-step")]:
        "Add at least one cooking action.",
    });
  });

  it("does not reject unchanged source-only fields that the editor cannot change", () => {
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

    expect(
      validateVariantDraft(createVariantDraft(source), units, actionTypes),
    ).toMatchObject({
      fieldErrors: {},
      formErrors: [],
      payload: { ingredient_edits: [], instruction_edits: [] },
    });
  });

  it("reports measure errors without mutating or clearing raw input", () => {
    const draft = createVariantDraft(sourceRecipe());
    draft.title = "   ";
    draft.description = "contains\0nul";
    draft.servings = "0.00";
    draft.ingredients[0].selectedIngredient = {
      ingredientId: SUGAR_ID,
      canonicalName: "Granulated sugar",
      displayName: "White sugar",
    };
    draft.ingredients[0].measure.exactValue = "1.00001";

    const addedIngredient = createAddedIngredientDraft("new-invalid");
    addedIngredient.measure = {
      ...addedIngredient.measure,
      mode: "exact",
      exactValue: "-2",
    };
    draft.ingredients.push(addedIngredient);
    draft.instructions[0].text = "   ";
    const beforeValidation = structuredClone(draft);

    const result = validateVariantDraft(draft, units, actionTypes);

    expect(result.payload).toBeNull();
    expect(result.fieldErrors).toMatchObject({
      title: "Version title is required.",
      description: "Description contains an unsupported character.",
      servings: "Servings must be greater than zero.",
      [ingredientFieldKey("source-sugar-row", "name")]:
        "Choose a different catalog ingredient or label, or clear the selection.",
      [ingredientMeasureFieldKey("source-sugar-row", "amount")]:
        "Amount can have at most 4 decimal places.",
      [ingredientFieldKey("new-invalid", "name")]:
        "Choose an ingredient from the catalog.",
      [ingredientMeasureFieldKey("new-invalid", "amount")]:
        "Amount must be a positive decimal number.",
      [ingredientMeasureFieldKey("new-invalid", "unit")]:
        "Choose a unit from the curated catalog.",
      [instructionFieldKey("source-mix-step")]: "Instruction is required.",
    });
    expect(draft).toEqual(beforeValidation);
  });

  it("rejects inactive historical units until an active unit is chosen", () => {
    const source = sourceRecipe();
    const measure = source.ingredients[0].measure;
    if (measure.kind !== "exact") {
      throw new Error("Expected exact fixture.");
    }
    measure.unit = { ...measure.unit, active: false };
    const draft = createVariantDraft(source);

    const result = validateVariantDraft(
      draft,
      units.filter((unit) => unit.id !== GRAM_ID),
      actionTypes,
    );

    expect(result.payload).toBeNull();
    expect(result.fieldErrors).toMatchObject({
      [ingredientMeasureFieldKey("source-sugar-row", "unit")]:
        "Choose an active compatible unit.",
    });
    expect(draft.ingredients[0].measure.unit).toMatchObject({ active: false });
  });

  it("rejects drafts that remove every ingredient or instruction and keeps removal state", () => {
    const draft = createVariantDraft(sourceRecipe());
    draft.ingredients.forEach((ingredient) => {
      ingredient.removed = true;
    });
    draft.instructions.forEach((instruction) => {
      instruction.removed = true;
    });
    const beforeValidation = structuredClone(draft);

    const result = validateVariantDraft(draft, units, actionTypes);

    expect(result.payload).toBeNull();
    expect(result.formErrors).toEqual([
      "Keep or add at least one ingredient.",
      "Keep or add at least one instruction.",
    ]);
    expect(draft).toEqual(beforeValidation);
  });

  it("ignores newly added rows removed before submission", () => {
    const draft = createVariantDraft(sourceRecipe());
    const ingredient = createAddedIngredientDraft("discarded-ingredient");
    ingredient.removed = true;
    draft.ingredients.push(ingredient);
    const instruction = createAddedInstructionDraft("discarded-instruction");
    instruction.removed = true;
    draft.instructions.push(instruction);

    expect(validateVariantDraft(draft, units, actionTypes).payload).toMatchObject({
      ingredient_edits: [],
      instruction_edits: [],
    });
  });
});
