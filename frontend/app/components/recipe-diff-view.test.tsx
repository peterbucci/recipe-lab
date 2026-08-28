import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  RecipeDiff,
  RecipeIngredient,
  RecipeInstruction,
} from "../../lib/recipe-api";
import type { RecipeInstructionAction } from "../../lib/structured-action";
import { RecipeDiffView } from "./recipe-diff-view";

const baseVersion = {
  id: "11111111-1111-4111-8111-111111111111",
  version_number: 1,
  title: "Carrot Walnut Snack Cake",
  author: { id: "cook-one", handle: "first-cook", display_name: "First Cook" },
};

const targetVersion = {
  id: "22222222-2222-4222-8222-222222222222",
  version_number: 2,
  title: "Lower-Sugar Pecan Carrot Cake",
  author: {
    id: "cook-two",
    handle: "second-cook",
    display_name: "Second Cook",
  },
};

function ingredient(
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

function instruction(
  id: string,
  text: string,
  displayOrder: number,
  actions: RecipeInstructionAction[] = [],
): RecipeInstruction {
  return { id, text, display_order: displayOrder, actions };
}

function structuredAction(
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
        name: "How Lower-Sugar Pecan Carrot Cake changed",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Compared with Carrot Walnut Snack Cake. Start with the main cooking changes, then review every recorded detail below.",
      ),
    ).toBeInTheDocument();

    const highlights = screen.getByRole("list", {
      name: "Changes at a glance",
    });
    expect(
      within(highlights).getByText("Use 90 g Pecan instead of 100 g Walnut."),
    ).toBeInTheDocument();
    expect(
      within(highlights).getByText("Change White sugar from 180 g to 140 g."),
    ).toBeInTheDocument();
    expect(
      within(highlights).getByText("Add Orange zest (1 tbsp)."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("7 more changes are listed below."),
    ).toBeInTheDocument();

    const versions = screen.getByRole("navigation", {
      name: "Compared recipes",
    });
    expect(
      within(versions).getByRole("link", {
        name: /starting recipe.*carrot walnut snack cake/i,
      }),
    ).toHaveAttribute("href", `/recipes/${baseVersion.id}`);
    expect(
      within(versions).getByRole("link", {
        name: /this recipe.*lower-sugar pecan carrot cake/i,
      }),
    ).toHaveAttribute("href", `/recipes/${targetVersion.id}`);
    expect(screen.queryByText(/version \d+/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/direct parent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/before · parent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/after · variant/i)).not.toBeInTheDocument();

    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Changes at a glance",
      "Ingredient changes",
      "Cooking step changes",
      "Recipe details",
    ]);
    expect(document.body).not.toHaveTextContent(/Catalog name:/i);
    expect(document.body).not.toHaveTextContent(/Ingredient \d+:/i);
    expect(document.body).not.toHaveTextContent(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
  });

  it("preserves every old and new recipe detail value", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    const details = sectionNamed("Recipe details");
    const titleChange = within(details).getByRole("article", { name: "Title" });
    expect(within(titleChange).getByText("Title changed")).toBeInTheDocument();
    expect(
      within(titleChange).getByText("Starting recipe"),
    ).toBeInTheDocument();
    expect(within(titleChange).getByText("This recipe")).toBeInTheDocument();
    expect(
      within(titleChange).getByText(baseVersion.title).closest("del"),
    ).not.toBeNull();
    expect(
      within(titleChange).getByText(targetVersion.title).closest("ins"),
    ).not.toBeNull();

    const descriptionChange = within(details).getByRole("article", {
      name: "Description",
    });
    expect(
      within(descriptionChange).getByText("Description changed"),
    ).toBeInTheDocument();
    expect(
      within(descriptionChange).getByText("Not provided").closest("del"),
    ).not.toBeNull();
    expect(
      within(descriptionChange)
        .getByText("The original cake with less sugar and toasted pecans.")
        .closest("ins"),
    ).not.toBeNull();

    const yieldChange = within(details).getByRole("article", { name: "Yield" });
    expect(within(yieldChange).getByText("Yield changed")).toBeInTheDocument();
    expect(
      within(yieldChange).getByText("8 servings").closest("del"),
    ).not.toBeNull();
    expect(
      within(yieldChange).getByText("6 servings").closest("ins"),
    ).not.toBeNull();
  });

  it("gives additions, removals, substitutions, amounts, and preparation changes distinct text", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    const ingredients = sectionNamed("Ingredient changes");

    const substitution = within(ingredients).getByRole("article", {
      name: "Use Pecan instead of Walnut",
    });
    expect(within(substitution).getByText("Substitution")).toBeInTheDocument();
    expect(
      within(substitution).getByText("Amount changed"),
    ).toBeInTheDocument();
    expect(
      within(substitution).getByText("Preparation changed"),
    ).toBeInTheDocument();
    expect(
      within(substitution).getByText("Starting ingredient"),
    ).toBeInTheDocument();
    expect(within(substitution).getByText("Use instead")).toBeInTheDocument();
    const removedWalnutLabels = within(substitution).getAllByText("Walnut");
    expect(removedWalnutLabels).toHaveLength(2);
    expect(
      removedWalnutLabels.every((label) => label.closest("del") !== null),
    ).toBe(true);
    const addedPecanLabels = within(substitution).getAllByText("Pecan");
    expect(addedPecanLabels).toHaveLength(2);
    expect(
      addedPecanLabels.every((label) => label.closest("ins") !== null),
    ).toBe(true);
    expect(
      within(substitution).getByText("100 g").closest("del"),
    ).not.toBeNull();
    expect(
      within(substitution).getByText("90 g").closest("ins"),
    ).not.toBeNull();
    expect(
      within(substitution)
        .getByText(/preparation: roughly chopped/i)
        .closest("del"),
    ).not.toBeNull();
    expect(
      within(substitution)
        .getByText(/preparation: toasted and chopped/i)
        .closest("ins"),
    ).not.toBeNull();

    const amountChange = within(ingredients).getByRole("article", {
      name: "Change White sugar from 180 g to 140 g",
    });
    expect(
      within(amountChange).getByText("Amount changed"),
    ).toBeInTheDocument();
    expect(
      within(amountChange).getByText("Preparation changed"),
    ).toBeInTheDocument();
    expect(
      within(amountChange).getByText("Starting recipe"),
    ).toBeInTheDocument();
    expect(within(amountChange).getByText("This recipe")).toBeInTheDocument();
    expect(
      within(amountChange).getByText("180 g").closest("del"),
    ).not.toBeNull();
    expect(
      within(amountChange).getByText("140 g").closest("ins"),
    ).not.toBeNull();
    expect(
      within(amountChange)
        .getByText(/preparation: divided/i)
        .closest("ins"),
    ).not.toBeNull();

    const addition = within(ingredients).getByRole("article", {
      name: "Add Orange zest",
    });
    expect(within(addition).getByText("Added")).toBeInTheDocument();
    expect(within(addition).getByText("New ingredient")).toBeInTheDocument();
    expect(
      within(addition).getByText("Orange zest").closest("ins"),
    ).not.toBeNull();
    expect(within(addition).getByText("1 tbsp").closest("ins")).not.toBeNull();
    expect(
      within(addition).getByText(/preparation: finely grated/i),
    ).toBeInTheDocument();

    const removal = within(ingredients).getByRole("article", {
      name: "Remove Baking soda",
    });
    expect(within(removal).getByText("Removed")).toBeInTheDocument();
    expect(within(removal).getByText("Removed ingredient")).toBeInTheDocument();
    expect(
      within(removal).getByText("Baking soda").closest("del"),
    ).not.toBeNull();
    expect(within(removal).getByText("0.5 tsp").closest("del")).not.toBeNull();
  });

  it("distinguishes added, removed, and modified instructions", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    const instructions = sectionNamed("Cooking step changes");
    const changed = within(instructions).getByRole("article", {
      name: "Update step 2",
    });
    expect(within(changed).getByText("Wording changed")).toBeInTheDocument();
    expect(within(changed).getByText("Starting recipe")).toBeInTheDocument();
    expect(within(changed).getByText("This recipe")).toBeInTheDocument();
    expect(
      within(changed).getByText("Bake until the center is set.").closest("del"),
    ).not.toBeNull();
    expect(
      within(changed)
        .getByText("Bake gently until the center is just set.")
        .closest("ins"),
    ).not.toBeNull();

    const added = within(instructions).getByRole("article", {
      name: "Add step 4",
    });
    expect(within(added).getByText("Cooking step added")).toBeInTheDocument();
    expect(within(added).getByText("New cooking step")).toBeInTheDocument();
    expect(
      within(added).getByText("Serve with yogurt.").closest("ins"),
    ).not.toBeNull();

    const removed = within(instructions).getByRole("article", {
      name: "Remove step 3",
    });
    expect(
      within(removed).getByText("Cooking step removed"),
    ).toBeInTheDocument();
    expect(
      within(removed).getByText("Removed cooking step"),
    ).toBeInTheDocument();
    expect(
      within(removed)
        .getByText("Cool completely before slicing.")
        .closest("del"),
    ).not.toBeNull();
  });

  it("renders every structural action change against full base and target ingredient context", () => {
    const diff = mixedDiff();
    const baseSugar = ingredient(
      "base-sugar-row",
      "White sugar",
      "180.0000",
      "g",
      {
        display_order: 2,
      },
    );
    const targetZest = ingredient(
      "target-zest-row",
      "Orange zest",
      "1.0000",
      "tbsp",
      {
        display_order: 4,
      },
    );
    diff.ingredient_context = { base: [baseSugar], target: [targetZest] };
    const beforeAction = structuredAction("before-mix", "mix", 0, [
      baseSugar.id,
    ]);
    beforeAction.duration = {
      kind: "exact",
      value: "5.0000",
      unit: {
        id: "minute-unit",
        key: "minute",
        dimension: "time",
        canonical_label: "minute",
        plural_label: "minutes",
        symbol: "min",
        display_style: "word",
        active: true,
      },
      display_unit: "minutes",
      display: "5 minutes",
    };
    const afterAction = structuredAction("after-fold", "fold", 0, [
      targetZest.id,
    ]);
    afterAction.temperature = {
      kind: "exact",
      value: "180.0000",
      unit: {
        id: "celsius-unit",
        key: "celsius",
        dimension: "temperature",
        canonical_label: "degree Celsius",
        plural_label: "degrees Celsius",
        symbol: "°C",
        display_style: "symbol",
        active: true,
      },
      display_unit: "°C",
      display: "180 °C",
    };
    diff.instructions.modified = [
      {
        before: instruction("before-step", "Mix the batter.", 0, [
          beforeAction,
        ]),
        after: instruction("after-step", "Fold in the zest.", 0, [afterAction]),
        changed_fields: [
          "text",
          "actions",
          "inputs",
          "action_order",
          "duration",
          "temperature",
        ],
      },
    ];

    render(<RecipeDiffView diff={diff} />);

    const changed = screen.getByRole("article", { name: "Update step 1" });
    for (const label of [
      "Wording changed",
      "Cooking actions changed",
      "Ingredients used in the step changed",
      "Order within the step changed",
      "Timing changed",
      "Temperature changed",
    ]) {
      expect(within(changed).getByText(label)).toBeInTheDocument();
    }
    expect(
      within(changed).getByText("With White sugar").closest("del"),
    ).not.toBeNull();
    expect(
      within(changed).getByText("For 5 minutes").closest("del"),
    ).not.toBeNull();
    expect(
      within(changed).getByText("With Orange zest").closest("ins"),
    ).not.toBeNull();
    expect(
      within(changed).getByText("At 180 °C").closest("ins"),
    ).not.toBeNull();
    expect(
      within(changed).getByRole("list", {
        name: "Cooking actions in the starting recipe",
      }),
    ).toBeInTheDocument();
    expect(
      within(changed).getByRole("list", {
        name: "Cooking actions in this recipe",
      }),
    ).toBeInTheDocument();
    expect(within(changed).queryByText(/Ingredient \d+:/)).toBeNull();
    expect(
      within(changed).queryByText(/[0-9a-f]{8}-[0-9a-f-]{27}/i),
    ).toBeNull();
    expect(
      within(changed)
        .getByText("Mix the batter.")
        .closest(".recipe-diff-instruction"),
    ).toHaveProperty("tagName", "DIV");
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

    expect(
      articleNamed("How Lower-Sugar Pecan Carrot Cake changed"),
    ).toBeInTheDocument();
    expect(articleNamed("Use Pecan instead of Walnut")).toBeInTheDocument();
    expect(articleNamed("Update step 2")).toBeInTheDocument();
    expect(articleNamed("Title")).toBeInTheDocument();
  });

  it("uses singular summary and highlight labels for one change", () => {
    const diff = mixedDiff();
    diff.metadata_changes = [diff.metadata_changes[2]];
    diff.ingredients = { added: [], removed: [], replaced: [], modified: [] };
    diff.instructions = { added: [], removed: [], modified: [] };

    render(<RecipeDiffView diff={diff} />);

    const overview = sectionNamed("Changes at a glance");
    expect(
      within(overview).getByText("1 change", { exact: true }),
    ).toBeInTheDocument();
    const highlights = screen.getByRole("list", {
      name: "Changes at a glance",
    });
    expect(
      within(highlights).getByText(
        "Change yield from 8 servings to 6 servings.",
      ),
    ).toBeInTheDocument();
    expect(
      within(highlights).queryByText(/ingredient/i),
    ).not.toBeInTheDocument();
    expect(
      within(highlights).queryByText(/cooking step/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recipe details" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Ingredient changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Cooking step changes" }),
    ).not.toBeInTheDocument();
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
        name: "This recipe matches the starting recipe.",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("heading", {
          name: "This recipe matches the starting recipe.",
        })
        .closest("section"),
    ).toHaveTextContent(
      "It has the same recipe details, ingredients, and cooking steps as Carrot Walnut Snack Cake.",
    );
    expect(
      screen.queryByRole("heading", { name: "Ingredient changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Cooking step changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Recipe details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Changes at a glance" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 changes?$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\boriginal\b/i)).not.toBeInTheDocument();
  });
});
