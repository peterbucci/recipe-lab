import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  comparisonModel,
  mixedDiff,
  sectionNamed,
  targetRecipeDetail,
} from "./recipe-diff-view-test-support";
import { RecipeDiffView } from "./recipe-diff-view";

describe("RecipeDiffView notes integration", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/recipes/target/compare");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("renders current and previous notes without the old recipe-details audit section", () => {
    const diff = mixedDiff();
    diff.metadata_changes = [
      {
        field: "notes",
        before: "Rest overnight before slicing.",
        after: "Serve the cake at room temperature.",
      },
    ];
    diff.ingredients = { added: [], removed: [], replaced: [], modified: [] };
    diff.ingredient_context = { base: [], target: [] };
    diff.instructions = { added: [], removed: [], modified: [] };

    const recipe = targetRecipeDetail(diff, {
      ingredients: [],
      instructions: [],
      notes: "Serve the cake at room temperature.",
    });
    const { container } = render(
      <RecipeDiffView comparison={comparisonModel(diff, recipe)} />,
    );

    expect(
      screen.queryByRole("heading", { name: "Notes from Second Cook" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    const notes = sectionNamed("Notes from Second Cook");
    expect(notes.querySelector("ins")).toHaveTextContent(
      "Serve the cake at room temperature.",
    );
    expect(notes.querySelector("del")).toHaveTextContent(
      "Rest overnight before slicing.",
    );
    expect(
      container.querySelector('[data-comparison-value="current"]')
        ?.nextElementSibling,
    ).toBe(container.querySelector('[data-comparison-value="previous"]'));
    expect(screen.queryByRole("heading", { name: "Recipe details" })).toBeNull();
  });
});
