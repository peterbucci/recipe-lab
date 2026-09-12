import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  RecipeDiff,
  RecipeIngredient,
} from "../shared/recipe-contracts";
import { buildRecipeComparisonModel } from "./recipe-comparison-model";
import { RecipeComparisonIngredients } from "./recipe-comparison-ingredients";
import {
  ingredient,
  mixedDiff,
  targetRecipeDetail,
} from "./recipe-diff-view-test-support";

interface IngredientFixture {
  comparison: ReturnType<typeof buildRecipeComparisonModel>;
  current: readonly RecipeIngredient[];
}

function ingredientFixture(): IngredientFixture {
  const unchanged = ingredient(
    "10000000-0000-4000-8000-000000000001",
    "Sea salt",
    "1.0000",
    "tsp",
    {
      canonical_name: "SECRET_CANONICAL_SALT",
      display_order: 0,
    },
  );
  const amountBefore = ingredient(
    "10000000-0000-4000-8000-000000000002",
    "Bread flour",
    "300.0000",
    "g",
    { display_order: 1 },
  );
  const amountAfter = ingredient(
    "20000000-0000-4000-8000-000000000002",
    "Bread flour",
    "250.0000",
    "g",
    { display_order: 1 },
  );
  const nameBefore = ingredient(
    "10000000-0000-4000-8000-000000000003",
    "Caster sugar",
    "100.0000",
    "g",
    { display_order: 2 },
  );
  const nameAfter = ingredient(
    "20000000-0000-4000-8000-000000000003",
    "Superfine sugar",
    "100.0000",
    "g",
    {
      canonical_name: "SECRET_CANONICAL_SUGAR",
      display_order: 2,
    },
  );
  const preparationBefore = ingredient(
    "10000000-0000-4000-8000-000000000004",
    "Parsley",
    "2.0000",
    "tbsp",
    { preparation_notes: "roughly chopped", display_order: 3 },
  );
  const preparationAfter = ingredient(
    "20000000-0000-4000-8000-000000000004",
    "Parsley",
    "2.0000",
    "tbsp",
    { preparation_notes: "finely chopped", display_order: 3 },
  );
  const removed = ingredient(
    "10000000-0000-4000-8000-000000000005",
    "Tomato paste",
    "1.0000",
    "tbsp",
    { preparation_notes: "from a tube", display_order: 4 },
  );
  const substitutionBefore = ingredient(
    "10000000-0000-4000-8000-000000000006",
    "Walnuts",
    "90.0000",
    "g",
    { preparation_notes: "roughly chopped", display_order: 4 },
  );
  const substitutionAfter = ingredient(
    "20000000-0000-4000-8000-000000000006",
    "Pecans",
    "80.0000",
    "g",
    { preparation_notes: "toasted and chopped", display_order: 4 },
  );
  const added = ingredient(
    "20000000-0000-4000-8000-000000000007",
    "Fresh basil",
    "1.0000",
    null,
    { preparation_notes: "torn", display_order: 5 },
  );

  const current = [
    added,
    preparationAfter,
    unchanged,
    substitutionAfter,
    nameAfter,
    amountAfter,
  ];
  const diff: RecipeDiff = {
    ...mixedDiff(),
    metadata_changes: [],
    ingredient_context: {
      base: [
        unchanged,
        amountBefore,
        nameBefore,
        preparationBefore,
        removed,
        substitutionBefore,
      ],
      target: current,
    },
    ingredients: {
      added: [added],
      removed: [removed],
      replaced: [
        {
          before: substitutionBefore,
          after: substitutionAfter,
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
          before: preparationBefore,
          after: preparationAfter,
          changed_fields: ["preparation_notes"],
        },
        {
          before: nameBefore,
          after: nameAfter,
          changed_fields: ["display_name"],
        },
        {
          before: amountBefore,
          after: amountAfter,
          changed_fields: ["measure"],
        },
      ],
    },
    instructions: { added: [], removed: [], modified: [] },
    has_changes: true,
  };
  const recipe = targetRecipeDetail(diff, {
    ingredients: [...current],
    instructions: [],
  });

  return {
    comparison: buildRecipeComparisonModel(recipe, diff),
    current,
  };
}

function renderIngredients() {
  const fixture = ingredientFixture();
  return {
    ...fixture,
    ...render(<RecipeComparisonIngredients comparison={fixture.comparison} />),
  };
}

function rowNamed(container: HTMLElement, name: string): HTMLElement {
  const row = Array.from(
    container.querySelectorAll<HTMLElement>(
      ".recipe-comparison-ingredient-row",
    ),
  ).find((candidate) => {
    const primaryName = candidate.querySelector<HTMLElement>(
      '[data-comparison-value="current"] .recipe-comparison-ingredient-value__name, [data-comparison-value="previous"].recipe-comparison-ingredient-row__previous--removed .recipe-comparison-ingredient-value__name',
    );
    return primaryName?.textContent === name;
  });
  expect(row).not.toBeNull();
  return row!;
}

describe("RecipeComparisonIngredients", () => {
  it("renders every current ingredient once in canonical order and places an equal-order removal deterministically", () => {
    const { comparison, container, current } = renderIngredients();
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".recipe-comparison-ingredient-row",
      ),
    );

    expect(comparison.ingredientRows.map((row) => row.displayOrder)).toEqual([
      0, 1, 2, 3, 4, 4, 5,
    ]);
    expect(
      rows.map(
        (row) =>
          row.querySelector<HTMLElement>(
            ".recipe-comparison-ingredient-value__name",
          )?.textContent,
      ),
    ).toEqual([
      "Sea salt",
      "Bread flour",
      "Superfine sugar",
      "Parsley",
      "Tomato paste",
      "Pecans",
      "Fresh basil",
    ]);
    for (const ingredientItem of current) {
      expect(
        Array.from(
          container.querySelectorAll<HTMLElement>(
            `[data-comparison-value="current"] .recipe-comparison-ingredient-value__name`,
          ),
        ).filter((name) => name.textContent === ingredientItem.display_name),
      ).toHaveLength(1);
    }
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("communicates every state with marker text, structured labels, and insertion or deletion semantics", () => {
    const { container } = renderIngredients();
    const unchanged = rowNamed(container, "Sea salt");
    const added = rowNamed(container, "Fresh basil");
    const removed = rowNamed(container, "Tomato paste");
    const amount = rowNamed(container, "Bread flour");
    const name = rowNamed(container, "Superfine sugar");
    const preparation = rowNamed(container, "Parsley");
    const substitution = rowNamed(container, "Pecans");

    expect(unchanged).toHaveClass(
      "recipe-comparison-ingredient-row--unchanged",
    );
    expect(
      unchanged.querySelector(".recipe-comparison-ingredient-row__status"),
    ).not.toBeInTheDocument();
    expect(unchanged.querySelector("ins, del")).not.toBeInTheDocument();

    expect(
      added.querySelector(".recipe-comparison-ingredient-row__marker"),
    ).toHaveTextContent("+");
    expect(within(added).getByText("Added")).toBeVisible();
    expect(added.querySelector("ins")).toHaveTextContent(
      "1 Fresh basil Preparation: torn",
    );
    expect(added.querySelector("del")).not.toBeInTheDocument();

    expect(
      removed.querySelector(".recipe-comparison-ingredient-row__marker"),
    ).toHaveTextContent("−");
    expect(within(removed).getByText("Removed")).toBeVisible();
    expect(removed.querySelector("del")).toHaveTextContent(
      "1 tbsp Tomato paste Preparation: from a tube",
    );
    expect(removed.querySelector("ins")).not.toBeInTheDocument();

    for (const changed of [amount, name, preparation, substitution]) {
      expect(
        changed.querySelector(".recipe-comparison-ingredient-row__marker"),
      ).toHaveTextContent("±");
      expect(within(changed).getByText("Changed")).toBeVisible();
      expect(changed.querySelector("ins")).toBeInTheDocument();
      expect(changed.querySelector("del")).toBeInTheDocument();
    }
    expect(within(amount).getByText("Amount changed")).toBeVisible();
    expect(within(name).getByText("Name changed")).toBeVisible();
    expect(within(preparation).getByText("Preparation changed")).toBeVisible();
    expect(within(substitution).getByText("Substitution")).toBeVisible();
    expect(within(substitution).getByText("Amount changed")).toBeVisible();
    expect(
      within(substitution).getByText("Preparation changed"),
    ).toBeVisible();
    expect(within(substitution).queryByText("Name changed")).not.toBeInTheDocument();
  });

  it("places each changed ingredient's exact prior value immediately after its current value", () => {
    const { container } = renderIngredients();
    const expectations = [
      {
        currentName: "Bread flour",
        current: "250 g Bread flour",
        previous: "300 g Bread flour",
      },
      {
        currentName: "Superfine sugar",
        current: "100 g Superfine sugar",
        previous: "100 g Caster sugar",
      },
      {
        currentName: "Parsley",
        current: "2 tbsp Parsley Preparation: finely chopped",
        previous: "2 tbsp Parsley Preparation: roughly chopped",
      },
      {
        currentName: "Pecans",
        current: "80 g Pecans Preparation: toasted and chopped",
        previous: "90 g Walnuts Preparation: roughly chopped",
      },
    ];

    for (const expected of expectations) {
      const row = rowNamed(container, expected.currentName);
      const current = row.querySelector<HTMLElement>(
        '[data-comparison-value="current"]',
      );
      const previous = row.querySelector<HTMLElement>(
        '[data-comparison-value="previous"]',
      );

      expect(current).not.toBeNull();
      expect(previous).not.toBeNull();
      expect(current!.nextElementSibling).toBe(previous);
      expect(current!.querySelector("ins")).toHaveTextContent(expected.current);
      expect(previous!.querySelector("del")).toHaveTextContent(
        expected.previous,
      );
    }
  });

  it("shows a structured change count without leaking occurrence IDs or canonical names", () => {
    const { container } = renderIngredients();

    expect(screen.getByText("6 ingredient changes")).toBeVisible();
    expect(container).not.toHaveTextContent(
      "10000000-0000-4000-8000-000000000001",
    );
    expect(container).not.toHaveTextContent(
      "20000000-0000-4000-8000-000000000007",
    );
    expect(container).not.toHaveTextContent("SECRET_CANONICAL_SALT");
    expect(container).not.toHaveTextContent("SECRET_CANONICAL_SUGAR");
  });
});
