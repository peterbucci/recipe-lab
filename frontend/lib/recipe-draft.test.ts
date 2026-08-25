import { describe, expect, it } from "vitest";

import type { CatalogActionType } from "./cooking-action-api";
import type { CatalogUnit } from "./measurement-unit-api";
import {
  createDraftIngredientState,
  createDraftInstructionState,
  draftIngredientOptions,
  hydrateRecipeDraft,
  type RecipeDraftEditorState,
  validateRecipeDraft,
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
    instruction.text = "Simmer gently.";
    const valid = validateRecipeDraft(incomplete, 1, [] satisfies CatalogUnit[], [] satisfies CatalogActionType[]);
    expect(valid.payload?.ingredients[0]?.selection).toEqual({
      kind: "request",
      ingredient_request_id: REQUEST_ID,
    });
  });
});
