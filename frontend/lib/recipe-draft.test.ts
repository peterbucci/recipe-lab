import { describe, expect, it } from "vitest";

import type { CatalogActionType } from "./cooking-action-api";
import { catalogUnitSummary, type CatalogUnit } from "./measurement-unit-api";
import {
  createDraftIngredientState,
  createDraftInstructionState,
  createStructuredActionDraft,
  draftIngredientOptions,
  hydrateRecipeDraft,
  recipeDraftFieldErrorsFromIssues,
  type RecipeDraftEditorState,
  validateRecipeDraft,
  validateRecipeDraftForPublication,
} from "./recipe-draft";
import type { RecipeDraftDetail } from "./recipe-draft-api";

const INGREDIENT_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const ROW_ID = "33333333-3333-4333-8333-333333333333";
const DRAFT_ID = "44444444-4444-4444-8444-444444444444";

const detail: RecipeDraftDetail = {
  id: DRAFT_ID,
  source_version_id: null,
  status: "active",
  revision: 1,
  title: "",
  description: null,
  servings: null,
  ingredients: [{
    id: ROW_ID,
    display_order: 0,
    selection: {
      kind: "request",
      request: {
        id: REQUEST_ID,
        proposed_name: "Silver herb",
        status: "approved",
        resolved_ingredient: {
          id: INGREDIENT_ID,
          canonical_name: "sage",
          aliases: ["garden sage"],
        },
      },
    },
    measure: {
      kind: "qualitative",
      value: "unspecified",
      unit: null,
      display_unit: null,
      display: "unspecified",
    },
    preparation_notes: null,
  }],
  instructions: [],
  created_at: "2026-08-25T12:00:00Z",
  updated_at: "2026-08-25T12:00:00Z",
};

describe("private recipe draft state", () => {
  it("starts a new ingredient with blank exact amount fields", () => {
    expect(createDraftIngredientState("ingredient-ref").measure).toEqual({
      mode: "exact",
      exactValue: "",
      rangeMinimum: "",
      rangeMaximum: "",
      unit: null,
      packageSizeId: null,
    });
  });

  it("hydrates a request-backed slot without silently replacing it with its resolution", () => {
    const state = hydrateRecipeDraft(detail);

    expect(state.ingredients[0]?.selection).toMatchObject({
      kind: "request",
      request: { proposed_name: "Silver herb", resolved_ingredient: { canonical_name: "sage" } },
    });
    expect(draftIngredientOptions(state.ingredients)).toEqual([]);
  });

  it("hydrates fixed-scale ingredient amounts as human-friendly editor values", () => {
    const state = hydrateRecipeDraft({
      ...detail,
      ingredients: [{
        ...detail.ingredients[0],
        selection: {
          kind: "catalog",
          ingredient: {
            id: INGREDIENT_ID,
            canonical_name: "egg",
            aliases: [],
          },
          display_name: "Egg",
        },
        measure: {
          kind: "exact",
          value: "2.0000",
          unit: {
            id: "55555555-5555-4555-8555-555555555555",
            key: "item",
            dimension: "count",
            canonical_label: "item",
            plural_label: "items",
            symbol: null,
            display_style: "hidden",
            active: true,
          },
          package_size_id: null,
          display_unit: null,
          display: "2",
        },
      }],
    });

    expect(state.ingredients[0]?.measure.exactValue).toBe("2");
  });

  it("round-trips a complex saved draft without losing structured recipe meaning", () => {
    const gram: CatalogUnit = {
      id: "55555555-5555-4555-8555-555555555551",
      key: "gram",
      dimension: "mass",
      canonical_label: "gram",
      plural_label: "grams",
      symbol: "g",
      display_style: "symbol",
      aliases: ["grams"],
      active: true,
      provenance: "Test fixture",
    };
    const minute: CatalogUnit = {
      id: "55555555-5555-4555-8555-555555555552",
      key: "minute",
      dimension: "time",
      canonical_label: "minute",
      plural_label: "minutes",
      symbol: "min",
      display_style: "word",
      aliases: ["minutes"],
      active: true,
      provenance: "Test fixture",
    };
    const celsius: CatalogUnit = {
      id: "55555555-5555-4555-8555-555555555553",
      key: "celsius",
      dimension: "temperature",
      canonical_label: "degree Celsius",
      plural_label: "degrees Celsius",
      symbol: "°C",
      display_style: "symbol",
      aliases: ["Celsius"],
      active: true,
      provenance: "Test fixture",
    };
    const actionType: CatalogActionType = {
      id: "66666666-6666-4666-8666-666666666666",
      key: "simmer",
      canonical_verb: "simmer",
      active: true,
      provenance: "Test fixture",
    };
    const requestRowId = "77777777-7777-4777-8777-777777777777";
    const instructionId = "88888888-8888-4888-8888-888888888888";
    const saved: RecipeDraftDetail = {
      ...detail,
      revision: 8,
      title: "Garden sage broth",
      description: "A structured draft.",
      servings: "3.5",
      ingredients: [
        {
          id: ROW_ID,
          display_order: 0,
          selection: {
            kind: "catalog",
            ingredient: {
              id: INGREDIENT_ID,
              canonical_name: "sage",
              aliases: ["garden sage"],
            },
            display_name: "Garden sage",
          },
          measure: {
            kind: "exact",
            value: "1.5000",
            unit: catalogUnitSummary(gram),
            package_size_id: null,
            display_unit: "g",
            display: "1.5 g",
          },
          preparation_notes: "chopped",
        },
        {
          id: requestRowId,
          display_order: 1,
          selection: detail.ingredients[0]!.selection,
          measure: {
            kind: "qualitative",
            value: "as_needed",
            unit: null,
            display_unit: null,
            display: "as needed",
          },
          preparation_notes: null,
        },
      ],
      instructions: [
        {
          id: instructionId,
          display_order: 0,
          text: "Simmer the sage gently.",
          actions: [
            {
              id: "99999999-9999-4999-8999-999999999999",
              display_order: 0,
              action_type: {
                id: actionType.id,
                key: actionType.key,
                canonical_verb: actionType.canonical_verb,
                active: actionType.active,
              },
              ingredient_occurrence_ids: [ROW_ID],
              duration: {
                kind: "exact",
                value: "5.000",
                unit: catalogUnitSummary(minute),
                display_unit: "minutes",
                display: "5 minutes",
              },
              temperature: {
                kind: "range",
                minimum: "175.0",
                maximum: "180.0",
                unit: catalogUnitSummary(celsius),
                display_unit: "°C",
                display: "175–180 °C",
              },
            },
          ],
        },
      ],
    };

    const state = hydrateRecipeDraft(saved);
    const validation = validateRecipeDraft(
      state,
      saved.revision,
      [gram, minute, celsius],
      [actionType],
    );

    expect(validation).toMatchObject({ fieldErrors: {}, formErrors: [] });
    expect(validation.payload).toEqual({
      revision: 8,
      title: "Garden sage broth",
      description: "A structured draft.",
      servings: "3.5",
      ingredients: [
        {
          ref: ROW_ID,
          selection: {
            kind: "catalog",
            ingredient_id: INGREDIENT_ID,
            display_name: "Garden sage",
          },
          measure: { kind: "exact", value: "1.5", unit_id: gram.id },
          preparation_notes: "chopped",
        },
        {
          ref: requestRowId,
          selection: { kind: "request", ingredient_request_id: REQUEST_ID },
          measure: { kind: "qualitative", value: "as_needed" },
          preparation_notes: null,
        },
      ],
      instructions: [
        {
          ref: instructionId,
          text: "Simmer the sage gently.",
          actions: [
            {
              action_type_id: actionType.id,
              ingredient_refs: [ROW_ID],
              duration: { kind: "exact", value: "5.000", unit_id: minute.id },
              temperature: {
                kind: "range",
                minimum: "175.0",
                maximum: "180.0",
                unit_id: celsius.id,
              },
            },
          ],
        },
      ],
    });
  });

  it("allows an empty, untitled private document to be saved", () => {
    const state: RecipeDraftEditorState = {
      title: "",
      description: "",
      servings: "",
      ingredients: [],
      instructions: [],
    };

    expect(validateRecipeDraft(state, 4, [], []).payload).toEqual({
      revision: 4,
      title: "",
      description: null,
      servings: null,
      ingredients: [],
      instructions: [],
    });
    expect(validateRecipeDraftForPublication(state, 4, [], [])).toMatchObject({
      payload: null,
      fieldErrors: {
        title: "Title is required before publication.",
        servings: "Servings are required before publication.",
      },
      formErrors: [
        "Add at least one catalog ingredient before publication.",
        "Add at least one instruction before publication.",
      ],
    });
  });

  it("persists unresolved request identity and rejects incomplete populated rows", () => {
    const ingredient = createDraftIngredientState("ingredient-ref");
    const instruction = createDraftInstructionState("instruction-ref");
    const incomplete: RecipeDraftEditorState = {
      title: "Soup",
      description: "",
      servings: "2",
      ingredients: [ingredient],
      instructions: [instruction],
    };
    const invalid = validateRecipeDraft(incomplete, 1, [], []);
    expect(invalid.payload).toBeNull();
    expect(invalid.fieldErrors).toMatchObject({
      "ingredient.ingredient-ref.selection": expect.any(String),
      "instruction.instruction-ref.text": expect.any(String),
    });

    ingredient.selection = {
      kind: "request",
      request: {
        id: REQUEST_ID,
        proposed_name: "Silver herb",
        status: "pending",
        resolved_ingredient: null,
      },
    };
    ingredient.measure.mode = "unspecified";
    instruction.text = "Simmer gently.";
    const valid = validateRecipeDraft(incomplete, 1, [] satisfies CatalogUnit[], [] satisfies CatalogActionType[]);
    expect(valid.payload?.ingredients[0]?.selection).toEqual({
      kind: "request",
      ingredient_request_id: REQUEST_ID,
    });
    expect(
      validateRecipeDraftForPublication(incomplete, 1, [], []).fieldErrors,
    ).toMatchObject({
      "ingredient.ingredient-ref.selection":
        "Choose the request’s approved catalog ingredient before publication.",
      "instruction.instruction-ref.action.actions":
        "Add at least one cooking action before publication.",
    });
  });

  it("accepts a complete catalog-backed original with ordered structured actions", () => {
    const actionType: CatalogActionType = {
      id: "55555555-5555-4555-8555-555555555555",
      key: "mix",
      canonical_verb: "mix",
      active: true,
      provenance: "Test catalog.",
    };
    const ingredient = createDraftIngredientState("ingredient-ref");
    ingredient.selection = {
      kind: "catalog",
      ingredient: {
        ingredientId: INGREDIENT_ID,
        canonicalName: "sage",
        displayName: "Sage",
      },
    };
    ingredient.measure.mode = "unspecified";
    const instruction = createDraftInstructionState("instruction-ref");
    instruction.text = "Mix the sage.";
    const action = createStructuredActionDraft("action-ref");
    action.actionType = actionType;
    action.ingredientKeys = [ingredient.key];
    instruction.actions = [action];
    const state: RecipeDraftEditorState = {
      title: "Sage recipe",
      description: "A publishable test recipe.",
      servings: "2",
      ingredients: [ingredient],
      instructions: [instruction],
    };

    expect(
      validateRecipeDraftForPublication(state, 6, [], [actionType]),
    ).toMatchObject({
      fieldErrors: {},
      formErrors: [],
      payload: {
        revision: 6,
        title: "Sage recipe",
        servings: "2",
        ingredients: [
          { selection: { kind: "catalog", ingredient_id: INGREDIENT_ID } },
        ],
        instructions: [
          { actions: [{ action_type_id: actionType.id }] },
        ],
      },
    });
    expect(
      recipeDraftFieldErrorsFromIssues(state, [
        {
          location: ["body", "ingredients", 0, "selection", "ingredient_id"],
          message: "This catalog ingredient is no longer available.",
          type: "value_error",
        },
        {
          location: ["body", "instructions", 0, "actions", 0, "action_type_id"],
          message: "This cooking action is no longer available.",
          type: "value_error",
        },
      ]),
    ).toEqual({
      "ingredient.ingredient-ref.selection": "This catalog ingredient is no longer available.",
      "instruction.instruction-ref.action.action-ref.type":
        "This cooking action is no longer available.",
    });
  });
});
