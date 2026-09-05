import { describe, expect, it } from "vitest";

import type { CatalogActionType } from "./cooking-action-api";
import {
  catalogUnitSummary,
  type CatalogUnit,
  type CatalogUnitSummary,
} from "./measurement-unit-api";
import {
  createStructuredActionDraft,
  effectiveStructuredActionState,
  hydrateStructuredActionDrafts,
  structuredActionDraftsMatchRecipe,
  validateStructuredActionDrafts,
  type IngredientOccurrenceOption,
  type RecipeInstructionAction,
} from "./structured-action";

const MIX_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const BAKE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RETIRED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const MINUTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CELSIUS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const actionTypes: CatalogActionType[] = [
  {
    id: MIX_ID,
    key: "mix",
    canonical_verb: "mix",
    active: true,
    provenance: "Test fixture",
  },
  {
    id: BAKE_ID,
    key: "bake",
    canonical_verb: "bake",
    active: true,
    provenance: "Test fixture",
  },
];

const units: CatalogUnit[] = [
  {
    id: MINUTE_ID,
    key: "minute",
    dimension: "time",
    canonical_label: "minute",
    plural_label: "minutes",
    symbol: "min",
    display_style: "word",
    aliases: ["minute"],
    active: true,
    provenance: "Test fixture",
  },
  {
    id: CELSIUS_ID,
    key: "celsius",
    dimension: "temperature",
    canonical_label: "degree Celsius",
    plural_label: "degrees Celsius",
    symbol: "°C",
    display_style: "symbol",
    aliases: ["Celsius"],
    active: true,
    provenance: "Test fixture",
  },
];

function summary(unit: CatalogUnit): CatalogUnitSummary {
  return catalogUnitSummary(unit);
}

const occurrences: IngredientOccurrenceOption[] = [
  {
    key: "source-sugar",
    label: "Ingredient 1: Sugar, 1 cup",
    ref: { kind: "existing", recipe_ingredient_id: "sugar-row" },
    removed: false,
  },
  {
    key: "new-flour",
    label: "Ingredient 2: Flour, 100 g",
    ref: { kind: "added", ingredient_edit_ref: "new-flour" },
    removed: false,
  },
];

function recipeAction(
  id: string,
  actionType: CatalogActionType,
  displayOrder: number,
  ingredientIds: string[] = [],
): RecipeInstructionAction {
  return {
    id,
    action_type: {
      id: actionType.id,
      key: actionType.key,
      canonical_verb: actionType.canonical_verb,
      active: actionType.active,
    },
    display_order: displayOrder,
    ingredient_occurrence_ids: ingredientIds,
    duration: null,
    temperature: null,
  };
}

describe("structured action domain", () => {
  it("hydrates deterministic multi-action order and preserves occurrence identity", () => {
    const originals = [
      recipeAction("bake-action", actionTypes[1], 1),
      recipeAction("mix-action", actionTypes[0], 0, ["sugar-row"]),
    ];
    const ingredientKeys = new Map([["sugar-row", "source-sugar"]]);

    const drafts = hydrateStructuredActionDrafts(originals, ingredientKeys);

    expect(drafts.map((draft) => draft.actionType?.canonical_verb)).toEqual([
      "mix",
      "bake",
    ]);
    expect(drafts[0].ingredientKeys).toEqual(["source-sugar"]);
    expect(structuredActionDraftsMatchRecipe(drafts, originals, ingredientKeys)).toBe(true);
    expect(
      structuredActionDraftsMatchRecipe([...drafts].reverse(), originals, ingredientKeys),
    ).toBe(false);
  });

  it("serializes existing and same-request ingredient references with numeric parameters", () => {
    const draft = createStructuredActionDraft("new-bake");
    draft.actionType = {
      id: BAKE_ID,
      key: "bake",
      canonical_verb: "bake",
      active: true,
    };
    draft.ingredientKeys = ["source-sugar", "new-flour"];
    draft.duration = {
      enabled: true,
      value: {
        mode: "range",
        exactValue: "",
        rangeMinimum: "20.000",
        rangeMaximum: "25.000",
        unit: summary(units[0]),
        packageSizeId: null,
      },
    };
    draft.temperature = {
      enabled: true,
      value: {
        mode: "exact",
        exactValue: "180.0",
        rangeMinimum: "",
        rangeMaximum: "",
        unit: summary(units[1]),
        packageSizeId: null,
      },
    };

    expect(validateStructuredActionDrafts([draft], actionTypes, occurrences, units)).toEqual({
      fieldErrors: {},
      actions: [
        {
          action_type_id: BAKE_ID,
          ingredient_refs: [
            { kind: "existing", recipe_ingredient_id: "sugar-row" },
            { kind: "added", ingredient_edit_ref: "new-flour" },
          ],
          duration: {
            kind: "range",
            minimum: "20.000",
            maximum: "25.000",
            unit_id: MINUTE_ID,
          },
          temperature: {
            kind: "exact",
            value: "180.0",
            unit_id: CELSIUS_ID,
          },
        },
      ],
    });
  });

  it("reports empty, inactive, removed-input, and qualitative parameter errors without mutation", () => {
    expect(validateStructuredActionDrafts([], actionTypes, occurrences, units)).toEqual({
      fieldErrors: { actions: "Add at least one cooking action." },
      actions: null,
    });

    const retired = createStructuredActionDraft("retired");
    retired.actionType = {
      id: RETIRED_ID,
      key: "retired",
      canonical_verb: "retired",
      active: false,
    };
    retired.ingredientKeys = ["source-sugar"];
    retired.duration.enabled = true;
    retired.duration.value.mode = "unspecified";
    const before = structuredClone(retired);
    const removedOccurrences = occurrences.map((item) =>
      item.key === "source-sugar" ? { ...item, removed: true } : item,
    );

    const validation = validateStructuredActionDrafts(
      [retired],
      actionTypes,
      removedOccurrences,
      units,
    );
    expect(validation.actions).toBeNull();
    expect(validation.fieldErrors).toMatchObject({
      "retired.type": "Choose an available cooking action.",
      "retired.inputs": expect.stringContaining("restore the removed ingredient"),
      "retired.duration.mode": "Choose a supported duration type.",
    });
    expect(retired).toEqual(before);
  });

  it("enforces the server action-list capacity before submission", () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => {
      const draft = createStructuredActionDraft(`action-${index}`);
      draft.actionType = {
        id: MIX_ID,
        key: "mix",
        canonical_verb: "mix",
        active: true,
      };
      return draft;
    });

    expect(validateStructuredActionDrafts(tooMany, actionTypes, occurrences, units)).toMatchObject({
      fieldErrors: {
        actions: "Use no more than 50 cooking actions in one step.",
      },
      actions: null,
    });
  });

  it("allows an inherited inactive type only when the caller explicitly preserves it", () => {
    const retired = createStructuredActionDraft("retired");
    retired.actionType = {
      id: RETIRED_ID,
      key: "retired",
      canonical_verb: "retired",
      active: false,
    };

    expect(
      validateStructuredActionDrafts(
        [retired],
        actionTypes,
        occurrences,
        units,
        new Set([RETIRED_ID]),
      ),
    ).toEqual({
      fieldErrors: {},
      actions: [
        {
          action_type_id: RETIRED_ID,
          ingredient_refs: [],
        },
      ],
    });
  });

  it("normalizes unchanged decimals and ignores disabled hidden parameter values", () => {
    const original = recipeAction("mix-action", actionTypes[0], 0);
    original.duration = {
      kind: "exact",
      value: "5.000",
      unit: summary(units[0]),
      display_unit: "minutes",
      display: "5 minutes",
    };
    const map = new Map<string, string>();
    const drafts = hydrateStructuredActionDrafts([original], map);
    expect(drafts[0].duration.value.exactValue).toBe("5");
    drafts[0].duration.value.exactValue = "05.0";
    drafts[0].temperature.value.exactValue = "999";

    expect(structuredActionDraftsMatchRecipe(drafts, [original], map)).toBe(true);
    expect(effectiveStructuredActionState(drafts, [original], map)).toEqual({
      matchesOriginal: true,
    });
  });
});
