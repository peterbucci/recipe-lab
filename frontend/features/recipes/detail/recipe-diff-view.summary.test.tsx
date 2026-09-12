import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  comparisonModel,
  ingredient,
  instruction,
  mixedDiff,
  sectionNamed,
  targetRecipeDetail,
} from "./recipe-diff-view-test-support";
import { RecipeDiffView } from "./recipe-diff-view";

function recipeFirstComparison() {
  const diff = mixedDiff();
  diff.metadata_changes.push({
    field: "notes",
    before: null,
    after: "Serve slightly warm with yogurt.",
  });
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
  beforeEach(() => {
    window.history.replaceState(
      null,
      "",
      "/recipes/target/compare?base_version_id=base",
    );
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

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

    const tabs = screen.getByRole("tablist", { name: "Recipe sections" });
    const recipeTab = within(tabs).getByRole("tab", { name: "Recipe" });
    const notesTab = within(tabs).getByRole("tab", { name: "Notes" });
    const familyTab = within(tabs).getByRole("tab", { name: "Family" });
    expect(within(tabs).getAllByRole("tab")).toEqual([
      recipeTab,
      notesTab,
      familyTab,
    ]);
    expect(recipeTab).toHaveAttribute("aria-selected", "true");
    expect(notesTab).toHaveAttribute("aria-selected", "false");
    expect(familyTab).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("link", { name: "Changes" })).toBeNull();

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
    ).toEqual(["Ingredients", "Instructions"]);
    expect(
      screen.queryByRole("heading", { name: "Notes from Second Cook" }),
    ).toBeNull();
    expect(
      screen.getByText("11 changes", {
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

    fireEvent.click(notesTab);
    const notesPanel = screen.getByRole("tabpanel", { name: "Notes" });
    expect(notesTab).toHaveAttribute("aria-selected", "true");
    expect(
      within(notesPanel).getByRole("heading", {
        name: "Notes from Second Cook",
      }),
    ).toBeVisible();
    expect(within(notesPanel).getByText("Notes changed")).toBeVisible();
    expect(
      within(notesPanel).getByText("Serve slightly warm with yogurt."),
    ).toBeVisible();
    expect(
      within(notesPanel).getByText(
        "No notes were added for the starting recipe.",
      ),
    ).toBeVisible();
    expect(document.getElementById("recipe-panel-recipe")).toHaveAttribute(
      "hidden",
    );

    fireEvent.click(familyTab);
    const familyPanel = screen.getByRole("tabpanel", { name: "Family" });
    expect(familyTab).toHaveAttribute("aria-selected", "true");
    expect(
      within(familyPanel).getByRole("heading", { name: "Recipe family" }),
    ).toBeVisible();
    expect(
      within(familyPanel).getByRole("link", {
        name: "Lower-Sugar Pecan Carrot Cake",
      }),
    ).not.toHaveAttribute("aria-current");
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
    expect(within(instructions).getByText("0 step changes")).toBeVisible();
    expect(
      within(instructions).getByRole("tab", { name: "Steps" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(within(instructions).getByText("Stir until smooth.")).toBeVisible();
    expect(
      instructions.querySelector(
        ".recipe-comparison-instruction-row--unchanged",
      ),
    ).toHaveTextContent("Stir until smooth.");
    fireEvent.click(
      within(instructions).getByRole("tab", { name: "Cooking breakdown" }),
    );
    expect(
      within(instructions).getByText("0 cooking breakdown changes"),
    ).toBeVisible();
    expect(
      within(instructions).getByText(
        "No cooking breakdown was recorded for this step.",
      ),
    ).toBeVisible();

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
    expect(comparisonContent).not.toHaveTextContent("Original");

    expect(
      screen.queryByRole("heading", { name: "Notes from Second Cook" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    const notes = sectionNamed("Notes from Second Cook");
    expect(within(notes).getByText("Serve warm.")).toBeVisible();
    expect(
      container.querySelector(
        ".recipe-comparison-notes ins, .recipe-comparison-notes del",
      ),
    ).not.toBeInTheDocument();
  });
});
