import { describe, expect, it } from "vitest";

import type { RecipeDetail, RecipeDiff } from "../shared/recipe-contracts";
import { buildRecipeSummary } from "../shared/recipe-test-support";
import {
  ingredient,
  instruction,
  mixedDiff,
  targetVersion,
} from "./recipe-diff-view-test-support";
import { buildRecipeComparisonModel } from "./recipe-comparison-model";

function targetRecipe(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    ...buildRecipeSummary({
      ...targetVersion,
      lineage_id: "33333333-3333-4333-8333-333333333333",
      parent_version_id: "11111111-1111-4111-8111-111111111111",
      parent: {
        id: "11111111-1111-4111-8111-111111111111",
        version_number: 1,
        title: "Carrot Walnut Snack Cake",
        author: {
          id: "cook-one",
          handle: "first-cook",
          display_name: "First Cook",
        },
      },
      description: "The original cake with less sugar and toasted pecans.",
      servings: "6.0000",
    }),
    average_rating: null,
    rating_count: 0,
    save_count: 0,
    total_time_minutes: 60,
    active_time_minutes: 20,
    difficulty: "easy",
    notes: null,
    viewer_state: null,
    children: [],
    ingredients: [
      ingredient("flour-row", "Flour", "200.0000", "g", {
        display_order: 0,
      }),
      ingredient("sugar-after-row", "White sugar", "140.0000", "g", {
        canonical_name: "Granulated sugar",
        preparation_notes: "divided",
        display_order: 2,
      }),
      ingredient("orange-zest-row", "Orange zest", "1.0000", "tbsp", {
        preparation_notes: "finely grated",
        display_order: 4,
      }),
      ingredient("pecan-row", "Pecan", "90.0000", "g", {
        preparation_notes: "toasted and chopped",
        display_order: 5,
      }),
    ],
    instructions: [
      instruction("mix-step", "Mix the batter.", 0),
      instruction(
        "bake-after-step",
        "Bake gently until the center is just set.",
        1,
      ),
      instruction("serve-step", "Serve with yogurt.", 3),
    ],
    ...overrides,
  };
}

describe("buildRecipeComparisonModel", () => {
  it("keeps the current ingredient recipe in canonical order and inserts removed rows deterministically", () => {
    const model = buildRecipeComparisonModel(targetRecipe(), mixedDiff());

    expect(
      model.ingredientRows.map((row) => [
        row.status,
        row.current?.id ?? row.previous?.id,
      ]),
    ).toEqual([
      ["unchanged", "flour-row"],
      ["changed", "sugar-after-row"],
      ["added", "orange-zest-row"],
      ["changed", "pecan-row"],
      ["removed", "baking-soda-row"],
    ]);

    const currentOrder = model.ingredientRows
      .filter((row) => row.current !== null)
      .map((row) => row.current!.id);
    expect(currentOrder).toEqual([
      "flour-row",
      "sugar-after-row",
      "orange-zest-row",
      "pecan-row",
    ]);
  });

  it("associates structured ingredient changes with their exact prior values", () => {
    const model = buildRecipeComparisonModel(targetRecipe(), mixedDiff());
    const amountChange = model.ingredientRows.find(
      (row) => row.current?.id === "sugar-after-row",
    );
    const substitution = model.ingredientRows.find(
      (row) => row.current?.id === "pecan-row",
    );

    expect(amountChange).toMatchObject({
      status: "changed",
      changeKind: "modified",
      previous: { id: "sugar-before-row" },
      changedFields: ["measure", "preparation_notes"],
    });
    expect(substitution).toMatchObject({
      status: "changed",
      changeKind: "substitution",
      previous: { id: "walnut-row" },
    });
  });

  it("keeps the current cooking flow while retaining changed, added, and removed steps", () => {
    const model = buildRecipeComparisonModel(targetRecipe(), mixedDiff());

    expect(
      model.instructionRows.map((row) => [
        row.status,
        row.current?.id ?? row.previous?.id,
      ]),
    ).toEqual([
      ["unchanged", "mix-step"],
      ["changed", "bake-after-step"],
      ["removed", "cool-step"],
      ["added", "serve-step"],
    ]);
    expect(model.instructionRows[1]).toMatchObject({
      previous: { id: "bake-before-step" },
      changedFields: ["text"],
    });
  });

  it("derives metadata lookup and the authoritative total from structured changes", () => {
    const model = buildRecipeComparisonModel(targetRecipe(), mixedDiff());

    expect(model.metadataChanges.title).toEqual({
      field: "title",
      before: "Carrot Walnut Snack Cake",
      after: "Lower-Sugar Pecan Carrot Cake",
    });
    expect(model.metadataChangeCount).toBe(3);
    expect(model.ingredientChangeCount).toBe(4);
    expect(model.instructionChangeCount).toBe(3);
    expect(model.totalChanges).toBe(10);
    expect(model.hasChanges).toBe(true);
  });

  it("does not infer changes from matching display content", () => {
    const recipe = targetRecipe({
      ingredients: [ingredient("same-row", "Salt", "1.0000", "tsp")],
      instructions: [instruction("same-step", "Stir.", 0)],
    });
    const diff: RecipeDiff = {
      ...mixedDiff(),
      metadata_changes: [],
      ingredients: { added: [], removed: [], replaced: [], modified: [] },
      instructions: { added: [], removed: [], modified: [] },
      has_changes: false,
    };

    const model = buildRecipeComparisonModel(recipe, diff);

    expect(model.ingredientRows[0]?.status).toBe("unchanged");
    expect(model.instructionRows[0]?.status).toBe("unchanged");
    expect(model.totalChanges).toBe(0);
    expect(model.hasChanges).toBe(false);
  });

  it("uses stable keys to break equal display-order ties without reordering current rows", () => {
    const recipe = targetRecipe({
      ingredients: [
        ingredient("current-c", "C", "1.0000", null, {
          display_order: 1,
        }),
        ingredient("current-b", "B", "1.0000", null, {
          display_order: 1,
        }),
      ],
    });
    const diff: RecipeDiff = {
      ...mixedDiff(),
      metadata_changes: [],
      ingredients: {
        added: [],
        replaced: [],
        modified: [],
        removed: [
          ingredient("removed-a", "A", "1.0000", null, {
            display_order: 1,
          }),
        ],
      },
      instructions: { added: [], removed: [], modified: [] },
      has_changes: true,
    };

    const model = buildRecipeComparisonModel(recipe, diff);

    expect(
      model.ingredientRows.map((row) => row.current?.id ?? row.previous?.id),
    ).toEqual(["removed-a", "current-c", "current-b"]);
  });
});
