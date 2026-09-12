import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  RecipeDiff,
  RecipeFieldValue,
} from "../shared/recipe-contracts";
import { RecipeComparisonNotes } from "./recipe-comparison-notes";
import {
  comparisonModel,
  mixedDiff,
  targetRecipeDetail,
} from "./recipe-diff-view-test-support";

function renderNotes({
  before,
  current,
  changed = true,
}: {
  before: RecipeFieldValue;
  current: string | null;
  changed?: boolean;
}) {
  const diff: RecipeDiff = mixedDiff();
  diff.metadata_changes = changed
    ? [{ field: "notes", before, after: current }]
    : [];
  const recipe = targetRecipeDetail(diff, {
    notes: current,
    author: {
      id: "notes-cook",
      handle: "notes-cook",
      display_name: "Notes Cook",
    },
  });
  const comparison = comparisonModel(diff, recipe);

  return render(<RecipeComparisonNotes comparison={comparison} />);
}

describe("RecipeComparisonNotes", () => {
  it("always renders the authoritative current notes under the current author", () => {
    const { container } = renderNotes({
      before: null,
      current: "The notes people can read today.",
      changed: false,
    });

    expect(
      screen.getByRole("heading", { name: "Notes from Notes Cook" }),
    ).toBeVisible();
    expect(screen.getByText("The notes people can read today.")).toBeVisible();
    expect(
      container.querySelector('[data-comparison-value="current"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-comparison-value="previous"]'),
    ).not.toBeInTheDocument();
    expect(container.querySelector("ins, del")).not.toBeInTheDocument();
  });

  it("renders a readable current empty state even when notes did not change", () => {
    const { container } = renderNotes({
      before: null,
      current: null,
      changed: false,
    });

    expect(screen.getByText("No notes were added for this recipe.")).toBeVisible();
    expect(container).not.toHaveTextContent("null");
  });

  it.each([
    {
      name: "addition from null",
      before: null,
      current: "Add lemon zest just before serving.",
      expectedCurrent: "Add lemon zest just before serving.",
      expectedPrevious: "No notes were added for the starting recipe.",
    },
    {
      name: "addition from an empty string",
      before: "",
      current: "Keep the sauce warm.",
      expectedCurrent: "Keep the sauce warm.",
      expectedPrevious: "No notes were added for the starting recipe.",
    },
    {
      name: "removal to null",
      before: "Best served on the same day.",
      current: null,
      expectedCurrent: "No notes were added for this recipe.",
      expectedPrevious: "Best served on the same day.",
    },
    {
      name: "removal to an empty string",
      before: "Chill before slicing.",
      current: "",
      expectedCurrent: "No notes were added for this recipe.",
      expectedPrevious: "Chill before slicing.",
    },
    {
      name: "replacement",
      before: "Use walnuts if pecans are unavailable.",
      current: "Toast the pecans for the fullest flavor.",
      expectedCurrent: "Toast the pecans for the fullest flavor.",
      expectedPrevious: "Use walnuts if pecans are unavailable.",
    },
  ])(
    "places the exact prior value immediately after the current value for a $name",
    ({ before, current, expectedCurrent, expectedPrevious }) => {
      const { container } = renderNotes({ before, current });
      const currentValue = container.querySelector<HTMLElement>(
        '[data-comparison-value="current"]',
      );
      const previousValue = container.querySelector<HTMLElement>(
        '[data-comparison-value="previous"]',
      );

      expect(currentValue).not.toBeNull();
      expect(previousValue).not.toBeNull();
      expect(currentValue!.nextElementSibling).toBe(previousValue);
      expect(currentValue!.querySelector("ins")).toHaveTextContent(
        expectedCurrent,
      );
      expect(previousValue!.querySelector("del")).toHaveTextContent(
        expectedPrevious,
      );
      expect(screen.getByText("Notes changed")).toBeVisible();
      expect(container).not.toHaveTextContent("null");
    },
  );
});
