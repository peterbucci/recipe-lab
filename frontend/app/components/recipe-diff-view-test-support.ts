import { screen } from "@testing-library/react";
import { expect } from "vitest";

import type {
  RecipeDiff,
  RecipeIngredient,
  RecipeInstruction,
} from "../../lib/recipe-api";
import type { RecipeInstructionAction } from "../../lib/structured-action";

export const baseVersion = {
  id: "11111111-1111-4111-8111-111111111111",
  version_number: 1,
  title: "Carrot Walnut Snack Cake",
  author: { id: "cook-one", handle: "first-cook", display_name: "First Cook" },
};

export const targetVersion = {
  id: "22222222-2222-4222-8222-222222222222",
  version_number: 2,
  title: "Lower-Sugar Pecan Carrot Cake",
  author: {
    id: "cook-two",
    handle: "second-cook",
    display_name: "Second Cook",
  },
};

export function ingredient(
  id: string,
  displayName: string,
  quantity: string | null,
  unit: string | null,
  overrides: Partial<RecipeIngredient> = {},
): RecipeIngredient {
  const amount =
    quantity?.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") ?? null;
  return {
    id,
    ingredient_id: `catalog-${id}`,
    canonical_name: displayName,
    display_name: displayName,
    measure:
      amount === null
        ? {
            kind: "qualitative",
            value: "unspecified",
            unit: null,
            display_unit: null,
            display: "Amount not specified",
          }
        : {
            kind: "exact",
            value: quantity!,
            unit: {
              id: `unit-${unit ?? "count"}`,
              key: unit ?? "count",
              dimension: unit === "g" ? "mass" : "volume",
              canonical_label: unit ?? "count",
              plural_label: unit ?? "count",
              symbol: unit,
              display_style: unit ? "symbol" : "hidden",
              active: true,
            },
            display_unit: unit ?? "",
            display: `${amount}${unit ? ` ${unit}` : ""}`,
          },
    preparation_notes: null,
    display_order: 0,
    ...overrides,
  };
}

export function instruction(
  id: string,
  text: string,
  displayOrder: number,
  actions: RecipeInstructionAction[] = [],
): RecipeInstruction {
  return { id, title: null, text, display_order: displayOrder, actions };
}

export function structuredAction(
  id: string,
  verb: string,
  displayOrder: number,
  ingredientOccurrenceIds: string[] = [],
): RecipeInstructionAction {
  return {
    id,
    action_type: {
      id: `type-${id}`,
      key: verb,
      canonical_verb: verb,
      active: true,
    },
    display_order: displayOrder,
    ingredient_occurrence_ids: ingredientOccurrenceIds,
    duration: null,
    temperature: null,
  };
}

export function mixedDiff(): RecipeDiff {
  return {
    lineage_id: "33333333-3333-4333-8333-333333333333",
    base_version: baseVersion,
    target_version: targetVersion,
    metadata_changes: [
      {
        field: "title",
        before: baseVersion.title,
        after: targetVersion.title,
      },
      {
        field: "description",
        before: null,
        after: "The original cake with less sugar and toasted pecans.",
      },
      { field: "servings", before: "8.0000", after: "6.0000" },
    ],
    ingredients: {
      added: [
        ingredient("orange-zest-row", "Orange zest", "1.0000", "tbsp", {
          preparation_notes: "finely grated",
          display_order: 4,
        }),
      ],
      removed: [
        ingredient("baking-soda-row", "Baking soda", "0.5000", "tsp", {
          display_order: 7,
        }),
      ],
      replaced: [
        {
          before: ingredient("walnut-row", "Walnut", "100.0000", "g", {
            preparation_notes: "roughly chopped",
            display_order: 5,
          }),
          after: ingredient("pecan-row", "Pecan", "90.0000", "g", {
            preparation_notes: "toasted and chopped",
            display_order: 5,
          }),
          changed_fields: [
            "ingredient",
            "display_name",
            "measure",
            "preparation_notes",
          ],
        },
      ],
      modified: [
        {
          before: ingredient(
            "sugar-before-row",
            "White sugar",
            "180.0000",
            "g",
            {
              canonical_name: "Granulated sugar",
              display_order: 2,
            },
          ),
          after: ingredient("sugar-after-row", "White sugar", "140.0000", "g", {
            canonical_name: "Granulated sugar",
            preparation_notes: "divided",
            display_order: 2,
          }),
          changed_fields: ["measure", "preparation_notes"],
        },
      ],
    },
    ingredient_context: { base: [], target: [] },
    instructions: {
      added: [instruction("serve-step", "Serve with yogurt.", 3)],
      removed: [instruction("cool-step", "Cool completely before slicing.", 2)],
      modified: [
        {
          before: instruction(
            "bake-before-step",
            "Bake until the center is set.",
            1,
          ),
          after: instruction(
            "bake-after-step",
            "Bake gently until the center is just set.",
            1,
          ),
          changed_fields: ["text"],
        },
      ],
    },
    has_changes: true,
  };
}

export function sectionNamed(name: string | RegExp): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  expect(section).not.toBeNull();
  return section!;
}

export function articleNamed(name: string | RegExp): HTMLElement {
  return screen.getByRole("article", { name });
}

