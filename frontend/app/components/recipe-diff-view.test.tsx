import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  RecipeDiff,
  RecipeIngredient,
  RecipeInstruction,
} from "../../lib/recipe-api";
import { RecipeDiffView } from "./recipe-diff-view";

const baseVersion = {
  id: "11111111-1111-4111-8111-111111111111",
  version_number: 1,
  title: "Carrot Walnut Snack Cake",
};

const targetVersion = {
  id: "22222222-2222-4222-8222-222222222222",
  version_number: 2,
  title: "Lower-Sugar Pecan Carrot Cake",
};

function ingredient(
  id: string,
  displayName: string,
  quantity: string | null,
  unit: string | null,
  overrides: Partial<RecipeIngredient> = {},
): RecipeIngredient {
  const amount = quantity?.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") ?? null;
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

function instruction(
  id: string,
  text: string,
  displayOrder: number,
): RecipeInstruction {
  return { id, text, display_order: displayOrder };
}

function mixedDiff(): RecipeDiff {
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
          before: ingredient("sugar-before-row", "White sugar", "180.0000", "g", {
            canonical_name: "Granulated sugar",
            display_order: 2,
          }),
          after: ingredient("sugar-after-row", "White sugar", "140.0000", "g", {
            canonical_name: "Granulated sugar",
            preparation_notes: "divided",
            display_order: 2,
          }),
          changed_fields: ["measure", "preparation_notes"],
        },
      ],
    },
    instructions: {
      added: [instruction("serve-step", "Serve with yogurt.", 3)],
      removed: [instruction("cool-step", "Cool completely before slicing.", 2)],
      modified: [
        {
          before: instruction("bake-before-step", "Bake until the center is set.", 1),
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

function sectionNamed(name: string | RegExp): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  expect(section).not.toBeNull();
  return section!;
}

function articleNamed(name: string | RegExp): HTMLElement {
  return screen.getByRole("article", { name });
}

describe("RecipeDiffView", () => {
  it("leads with a cooking-first summary and orders changes by cooking flow", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    expect(
      screen.getByRole("heading", {
        name: "What changed in Lower-Sugar Pecan Carrot Cake",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("10 changes from Carrot Walnut Snack Cake."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "See how this recipe differs from Carrot Walnut Snack Cake. This comparison covers recipe details, ingredients, and instructions.",
      ),
    ).toBeInTheDocument();

    const highlights = screen.getByRole("list", { name: "Change highlights" });
    expect(within(highlights).getByText("4 ingredient changes")).toBeInTheDocument();
    expect(within(highlights).getByText("3 instruction changes")).toBeInTheDocument();
    expect(within(highlights).getByText("3 other detail changes")).toBeInTheDocument();

    const versions = screen.getByRole("navigation", { name: "Compared recipes" });
    expect(
      within(versions).getByRole("link", {
        name: /starting recipe.*carrot walnut snack cake.*version 1/i,
      }),
    ).toHaveAttribute("href", `/recipes/${baseVersion.id}`);
    expect(
      within(versions).getByRole("link", {
        name: /this version.*lower-sugar pecan carrot cake.*version 2/i,
      }),
    ).toHaveAttribute("href", `/recipes/${targetVersion.id}`);
    expect(screen.queryByText(/direct parent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/before · parent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/after · variant/i)).not.toBeInTheDocument();

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(["Ingredient changes", "Instruction changes", "Other details"]);
  });

  it("preserves every old and new recipe detail value", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    const details = sectionNamed("Other details");
    const titleChange = within(details).getByRole("article", { name: "Title" });
    expect(within(titleChange).getByText("Title changed")).toBeInTheDocument();
    expect(within(titleChange).getByText("Before")).toBeInTheDocument();
    expect(within(titleChange).getByText("After")).toBeInTheDocument();
    expect(within(titleChange).getByText(baseVersion.title).closest("del")).not.toBeNull();
    expect(within(titleChange).getByText(targetVersion.title).closest("ins")).not.toBeNull();

    const descriptionChange = within(details).getByRole("article", {
      name: "Description",
    });
    expect(within(descriptionChange).getByText("Description changed")).toBeInTheDocument();
    expect(within(descriptionChange).getByText("Not provided").closest("del")).not.toBeNull();
    expect(
      within(descriptionChange).getByText(
        "The original cake with less sugar and toasted pecans.",
      ).closest("ins"),
    ).not.toBeNull();

    const yieldChange = within(details).getByRole("article", { name: "Yield" });
    expect(within(yieldChange).getByText("Yield changed")).toBeInTheDocument();
    expect(within(yieldChange).getByText("8 servings").closest("del")).not.toBeNull();
    expect(within(yieldChange).getByText("6 servings").closest("ins")).not.toBeNull();
  });

  it("gives additions, removals, substitutions, amounts, and preparation changes distinct text", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    const ingredients = sectionNamed("Ingredient changes");

    const substitution = within(ingredients).getByRole("article", {
      name: "Walnut replaced with Pecan",
    });
    expect(within(substitution).getByText("Substitution")).toBeInTheDocument();
    expect(within(substitution).getByText("Amount changed")).toBeInTheDocument();
    expect(within(substitution).getByText("Preparation changed")).toBeInTheDocument();
    expect(within(substitution).getByText("Original ingredient")).toBeInTheDocument();
    expect(within(substitution).getByText("Replacement ingredient")).toBeInTheDocument();
    expect(within(substitution).getByText("Walnut").closest("del")).not.toBeNull();
    expect(within(substitution).getByText("Pecan").closest("ins")).not.toBeNull();
    expect(within(substitution).getByText("100 g")).toBeInTheDocument();
    expect(within(substitution).getByText("90 g")).toBeInTheDocument();
    expect(within(substitution).getByText(/preparation: roughly chopped/i)).toBeInTheDocument();
    expect(
      within(substitution).getByText(/preparation: toasted and chopped/i),
    ).toBeInTheDocument();

    const amountChange = within(ingredients).getByRole("article", {
      name: "White sugar",
    });
    expect(within(amountChange).getByText("Amount changed")).toBeInTheDocument();
    expect(within(amountChange).getByText("Preparation changed")).toBeInTheDocument();
    expect(within(amountChange).getByText("Before")).toBeInTheDocument();
    expect(within(amountChange).getByText("After")).toBeInTheDocument();
    expect(within(amountChange).getByText("180 g")).toBeInTheDocument();
    expect(within(amountChange).getByText("140 g")).toBeInTheDocument();
    expect(within(amountChange).getByText(/preparation: divided/i)).toBeInTheDocument();

    const addition = within(ingredients).getByRole("article", { name: "Orange zest" });
    expect(within(addition).getByText("Added")).toBeInTheDocument();
    expect(within(addition).getByText("New ingredient")).toBeInTheDocument();
    expect(within(addition).getByText("Orange zest").closest("ins")).not.toBeNull();
    expect(within(addition).getByText("1 tbsp").closest("ins")).not.toBeNull();
    expect(within(addition).getByText(/preparation: finely grated/i)).toBeInTheDocument();

    const removal = within(ingredients).getByRole("article", { name: "Baking soda" });
    expect(within(removal).getByText("Removed")).toBeInTheDocument();
    expect(within(removal).getByText("Removed ingredient")).toBeInTheDocument();
    expect(within(removal).getByText("Baking soda").closest("del")).not.toBeNull();
    expect(within(removal).getByText("0.5 tsp").closest("del")).not.toBeNull();
  });

  it("distinguishes added, removed, and modified instructions", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    const instructions = sectionNamed("Instruction changes");
    const changed = within(instructions).getByRole("article", {
      name: "Updated instruction",
    });
    expect(within(changed).getByText("Instruction changed")).toBeInTheDocument();
    expect(within(changed).getByText("Before")).toBeInTheDocument();
    expect(within(changed).getByText("After")).toBeInTheDocument();
    expect(
      within(changed).getByText("Bake until the center is set.").closest("del"),
    ).not.toBeNull();
    expect(
      within(changed).getByText("Bake gently until the center is just set.").closest("ins"),
    ).not.toBeNull();

    const added = within(instructions).getByRole("article", { name: "Step 4" });
    expect(within(added).getByText("Instruction added")).toBeInTheDocument();
    expect(within(added).getByText("New instruction")).toBeInTheDocument();
    expect(within(added).getByText("Serve with yogurt.").closest("ins")).not.toBeNull();

    const removed = within(instructions).getByRole("article", { name: "Step 3" });
    expect(within(removed).getByText("Instruction removed")).toBeInTheDocument();
    expect(within(removed).getByText("Removed instruction")).toBeInTheDocument();
    expect(
      within(removed).getByText("Cool completely before slicing.").closest("del"),
    ).not.toBeNull();
  });

  it("labels every comparison article with its visible heading", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(11);
    for (const article of articles) {
      expect(article).toHaveAccessibleName();
      const labelledBy = article.getAttribute("aria-labelledby");
      expect(labelledBy).not.toBeNull();
      expect(document.getElementById(labelledBy!)).toBe(
        article.querySelector(":scope > h1, :scope > header h1, :scope > h3"),
      );
    }

    expect(articleNamed("What changed in Lower-Sugar Pecan Carrot Cake")).toBeInTheDocument();
    expect(articleNamed("Walnut replaced with Pecan")).toBeInTheDocument();
    expect(articleNamed("Updated instruction")).toBeInTheDocument();
    expect(articleNamed("Title")).toBeInTheDocument();
  });

  it("uses singular summary and highlight labels for one change", () => {
    const diff = mixedDiff();
    diff.metadata_changes = [diff.metadata_changes[2]];
    diff.ingredients = { added: [], removed: [], replaced: [], modified: [] };
    diff.instructions = { added: [], removed: [], modified: [] };

    render(<RecipeDiffView diff={diff} />);

    expect(screen.getByText("1 change from Carrot Walnut Snack Cake.")).toBeInTheDocument();
    const highlights = screen.getByRole("list", { name: "Change highlights" });
    expect(within(highlights).getByText("1 other detail change")).toBeInTheDocument();
    expect(within(highlights).queryByText(/ingredient/i)).not.toBeInTheDocument();
    expect(within(highlights).queryByText(/instruction/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Other details" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ingredient changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Instruction changes" })).not.toBeInTheDocument();
  });

  it("renders an honest no-change state without empty change groups", () => {
    const diff = mixedDiff();
    diff.metadata_changes = [];
    diff.ingredients = { added: [], removed: [], replaced: [], modified: [] };
    diff.instructions = { added: [], removed: [], modified: [] };
    diff.has_changes = false;

    render(<RecipeDiffView diff={diff} />);

    expect(
      screen.getByRole("heading", {
        name: "No changes from the starting recipe",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/matches carrot walnut snack cake/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ingredient changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Instruction changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Other details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Change highlights" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 changes? from/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\boriginal\b/i)).not.toBeInTheDocument();
  });
});
