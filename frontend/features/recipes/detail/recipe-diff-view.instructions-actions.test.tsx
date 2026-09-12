import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  comparisonModel,
  ingredient,
  instruction,
  mixedDiff,
  sectionNamed,
  structuredAction,
  targetRecipeDetail,
} from "./recipe-diff-view-test-support";
import { RecipeDiffView } from "./recipe-diff-view";

describe("RecipeDiffView instruction integration", () => {
  it("renders the full instruction sequence and version-specific actions without the old audit section", () => {
    const diff = mixedDiff();
    const baseSugar = ingredient(
      "base-sugar-row",
      "White sugar",
      "180.0000",
      "g",
    );
    const currentZest = ingredient(
      "current-zest-row",
      "Orange zest",
      "1.0000",
      "tbsp",
    );
    const previousAction = structuredAction("previous-mix", "mix", 0, [
      baseSugar.id,
    ]);
    const currentAction = structuredAction("current-fold", "fold", 0, [
      currentZest.id,
    ]);
    const unchanged = instruction("prepare-step", "Prepare the pan.", 0);
    const before = instruction(
      "before-step",
      "Mix the batter.",
      1,
      [previousAction],
    );
    const after = instruction(
      "after-step",
      "Fold in the zest.",
      1,
      [currentAction],
    );
    const removed = instruction(
      "removed-step",
      "Cool completely before slicing.",
      2,
    );
    const added = instruction("added-step", "Serve with yogurt.", 3);

    diff.metadata_changes = [];
    diff.ingredients = { added: [], removed: [], replaced: [], modified: [] };
    diff.ingredient_context = {
      base: [baseSugar],
      target: [currentZest],
    };
    diff.instructions = {
      added: [added],
      removed: [removed],
      modified: [
        {
          before,
          after,
          changed_fields: ["text", "actions", "inputs"],
          unchanged_action_pairs: [],
          modified_action_pairs: [],
        },
      ],
    };

    const recipe = targetRecipeDetail(diff, {
      ingredients: [currentZest],
      instructions: [unchanged, after, added],
      notes: "Serve the cake at room temperature.",
    });
    render(<RecipeDiffView comparison={comparisonModel(diff, recipe)} />);

    const instructions = sectionNamed("Instructions");
    expect(within(instructions).getByText("Prepare the pan.")).toBeVisible();
    expect(within(instructions).getByText("Fold in the zest.")).toBeVisible();
    expect(within(instructions).getByText("Serve with yogurt.")).toBeVisible();
    expect(
      within(instructions).getByText("Cool completely before slicing."),
    ).toBeVisible();
    expect(
      within(instructions).queryByRole("list", {
        name: "Cooking actions in this recipe for step 2",
      }),
    ).toBeNull();

    fireEvent.click(
      within(instructions).getByRole("tab", { name: "Cooking breakdown" }),
    );

    const actions = within(instructions).getByRole("list", {
      name: "Cooking action comparison for step 2",
    });
    const actionRows = Array.from(actions.children) as HTMLElement[];
    expect(actionRows).toHaveLength(2);
    expect(actionRows.map((row) => row.dataset.actionStatus)).toEqual([
      "removed",
      "added",
    ]);
    expect(actionRows[0]).toHaveTextContent("White sugar");
    expect(actionRows[0]).not.toHaveTextContent("With White sugar");
    expect(actionRows[0]!.querySelector("del")).toHaveTextContent(
      "Removed action",
    );
    expect(actionRows[1]).toHaveTextContent("Orange zest");
    expect(actionRows[1]).not.toHaveTextContent("With Orange zest");
    expect(actionRows[1]!.querySelector("ins")).toHaveTextContent(
      "Added action",
    );
    expect(
      within(instructions).getByText("Cooking actions changed"),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Cooking step changes" }),
    ).toBeNull();
  });
});
