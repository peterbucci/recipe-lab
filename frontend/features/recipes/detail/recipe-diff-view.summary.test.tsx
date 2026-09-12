import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  baseVersion,
  comparisonModel,
  ingredient,
  instruction,
  mixedDiff,
  sectionNamed,
  targetRecipeDetail,
  targetVersion,
} from "./recipe-diff-view-test-support";
import { RecipeDiffView } from "./recipe-diff-view";

function recipeFirstComparison() {
  const diff = mixedDiff();
  const recipe = targetRecipeDetail(diff, {
    ingredients: [
      ingredient("flour-row", "Flour", "200.0000", "g", {
        display_order: 0,
      }),
      diff.ingredients.modified[0]!.after,
      diff.ingredients.added[0]!,
      diff.ingredients.replaced[0]!.after,
    ],
    instructions: [
      instruction("mix-step", "Mix the batter.", 0),
      diff.instructions.modified[0]!.after,
      diff.instructions.added[0]!,
    ],
    notes: "Serve slightly warm with yogurt.",
  });

  return comparisonModel(diff, recipe);
}

describe("RecipeDiffView", () => {
  it("presents the complete current recipe with comparison context in cooking order", () => {
    render(<RecipeDiffView comparison={recipeFirstComparison()} />);

    expect(
      screen.getByRole("article", {
        name: "Lower-Sugar Pecan Carrot Cake",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Lower-Sugar Pecan Carrot Cake",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The original cake with less sugar and toasted pecans.",
        { selector: ".recipe-comparison-hero__description" },
      ),
    ).toBeInTheDocument();

    const views = screen.getByRole("navigation", { name: "Recipe views" });
    const changesLink = within(views).getByRole("link", { name: "Changes" });
    expect(changesLink).toHaveAttribute(
      "href",
      `/recipes/${targetVersion.id}/compare?base_version_id=${baseVersion.id}`,
    );
    expect(changesLink).toHaveAttribute("aria-current", "page");
    expect(within(changesLink).getByText("10")).toBeInTheDocument();
    expect(within(views).getByRole("link", { name: "Recipe" })).toHaveAttribute(
      "href",
      `/recipes/${targetVersion.id}`,
    );
    expect(within(views).getByRole("link", { name: "Family" })).toHaveAttribute(
      "href",
      `/recipes/${targetVersion.id}#recipe-family`,
    );

    const legend = screen.getByRole("complementary", {
      name: "Comparison legend",
    });
    expect(within(legend).getByText("Reading the comparison:")).toBeVisible();
    expect(within(legend).getByText("Added / current")).toBeVisible();
    expect(within(legend).getByText("Removed / previous")).toBeVisible();
    expect(within(legend).getByText("Changed")).toBeVisible();

    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["Ingredients", "Instructions", "Notes from Second Cook"]);
    expect(
      screen.getByText("10 changes", {
        selector: ".recipe-comparison-strip__count",
      }),
    ).toBeVisible();

    for (const heading of [
      "Changes at a glance",
      "Cooking step changes",
      "Recipe details",
      "This recipe matches the starting recipe.",
    ]) {
      expect(
        screen.queryByRole("heading", { name: heading }),
      ).not.toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent(
      /key changes|more changes are listed below|direct parent|before · parent|after · variant/i,
    );
    expect(document.body).not.toHaveTextContent(/Catalog name:/i);
    expect(document.body).not.toHaveTextContent(/Ingredient \d+:/i);
    expect(document.body).not.toHaveTextContent(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
  });

  it("keeps unchanged recipe content visible when the structured diff has zero changes", () => {
    const diff = mixedDiff();
    diff.metadata_changes = [];
    diff.ingredients = { added: [], removed: [], replaced: [], modified: [] };
    diff.instructions = { added: [], removed: [], modified: [] };
    // The composed model, rather than a stale transport hint, owns this state.
    diff.has_changes = true;
    const recipe = targetRecipeDetail(diff, {
      ingredients: [
        ingredient("salt-row", "Sea salt", "1.0000", "tsp", {
          display_order: 0,
        }),
      ],
      instructions: [instruction("stir-step", "Stir until smooth.", 0)],
      notes: "Serve warm.",
    });

    const { container } = render(
      <RecipeDiffView comparison={comparisonModel(diff, recipe)} />,
    );

    const ingredients = sectionNamed("Ingredients");
    expect(within(ingredients).getByText("0 ingredient changes")).toBeVisible();
    expect(within(ingredients).getByText("Sea salt")).toBeVisible();
    expect(
      ingredients.querySelector(
        ".recipe-comparison-ingredient-row--unchanged",
      ),
    ).toHaveTextContent("Sea salt");

    const instructions = sectionNamed("Instructions");
    expect(within(instructions).getByText("0 cooking changes")).toBeVisible();
    expect(within(instructions).getByText("Stir until smooth.")).toBeVisible();
    expect(
      instructions.querySelector(
        ".recipe-comparison-instruction-row--unchanged",
      ),
    ).toHaveTextContent("Stir until smooth.");

    const notes = sectionNamed("Notes from Second Cook");
    expect(within(notes).getByText("Serve warm.")).toBeVisible();
    expect(
      screen.getByText("0 changes", {
        selector: ".recipe-comparison-strip__count",
      }),
    ).toBeVisible();

    const comparisonContent = screen.getByRole("region", {
      name: "Recipe comparison",
    });
    for (const status of ["Added", "Removed", "Changed"]) {
      expect(
        within(comparisonContent).queryByText(status, { exact: true }),
      ).not.toBeInTheDocument();
    }
    expect(comparisonContent.querySelector("ins, del")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "This recipe matches the starting recipe.",
      }),
    ).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("Original");
  });
});
