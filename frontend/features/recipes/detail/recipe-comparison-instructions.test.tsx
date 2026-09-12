import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  RecipeDiff,
  RecipeIngredient,
  RecipeInstruction,
} from "../shared/recipe-contracts";
import type { RecipeNumericMeasure } from "../shared/recipe-structure";
import { RecipeComparisonInstructions } from "./recipe-comparison-instructions";
import { buildRecipeComparisonModel } from "./recipe-comparison-model";
import {
  ingredient,
  instruction,
  mixedDiff,
  structuredAction,
  targetRecipeDetail,
} from "./recipe-diff-view-test-support";

const UNKNOWN_OCCURRENCE_ID = "90000000-0000-4000-8000-000000000099";

interface InstructionFixture {
  comparison: ReturnType<typeof buildRecipeComparisonModel>;
  currentInstructions: readonly RecipeInstruction[];
}

function exactMeasure(
  display: string,
  dimension: "temperature" | "time",
): RecipeNumericMeasure {
  const temperature = dimension === "temperature";
  return {
    kind: "exact",
    value: temperature ? "180.0000" : "5.0000",
    unit: {
      id: temperature ? "celsius-unit" : "minute-unit",
      key: temperature ? "celsius" : "minute",
      dimension,
      canonical_label: temperature ? "degree Celsius" : "minute",
      plural_label: temperature ? "degrees Celsius" : "minutes",
      symbol: temperature ? "°C" : "min",
      display_style: temperature ? "symbol" : "word",
      active: true,
    },
    display_unit: temperature ? "°C" : "minutes",
    display,
  };
}

function instructionFixture(): InstructionFixture {
  const baseSugar = ingredient(
    "10000000-0000-4000-8000-000000000001",
    "Base sugar",
    "180.0000",
    "g",
  );
  const seaSalt = ingredient(
    "20000000-0000-4000-8000-000000000001",
    "Sea salt",
    "1.0000",
    "tsp",
    { canonical_name: "SECRET_CURRENT_SALT" },
  );
  const freshZest = ingredient(
    "20000000-0000-4000-8000-000000000002",
    "Fresh zest",
    "1.0000",
    "tbsp",
  );
  const misleadingTargetZest: RecipeIngredient = {
    ...freshZest,
    display_name: "Wrong target-context name",
  };

  const priorAction = structuredAction(
    "prior-action",
    "mix",
    0,
    [baseSugar.id, UNKNOWN_OCCURRENCE_ID],
  );
  priorAction.duration = exactMeasure("5 minutes", "time");

  const laterCurrentAction = structuredAction(
    "later-current-action",
    "bake",
    2,
    [seaSalt.id],
  );
  laterCurrentAction.temperature = exactMeasure("180 °C", "temperature");

  const firstCurrentAction = structuredAction(
    "first-current-action",
    "line",
    0,
    [freshZest.id, UNKNOWN_OCCURRENCE_ID, seaSalt.id],
  );
  firstCurrentAction.action_type.active = false;
  firstCurrentAction.duration = exactMeasure("5 minutes", "time");
  firstCurrentAction.temperature = exactMeasure("180 °C", "temperature");

  const unchanged = {
    ...instruction("unchanged-step", "Prepare the pan.", 0),
    title: "Get ready",
  };
  const before = {
    ...instruction("before-step", "Mix the old batter.", 1, [priorAction]),
    title: "Mix",
  };
  const after = {
    ...instruction("after-step", "Fold the fresh batter.", 1, [
      laterCurrentAction,
      firstCurrentAction,
    ]),
    title: "Fold gently",
  };
  const removed = instruction(
    "removed-step",
    "Rest the batter overnight.",
    3,
    [priorAction],
  );
  const added = instruction(
    "added-step",
    "Serve while warm.",
    3,
    [laterCurrentAction],
  );

  const diff: RecipeDiff = {
    ...mixedDiff(),
    metadata_changes: [],
    ingredients: { added: [], removed: [], replaced: [], modified: [] },
    ingredient_context: {
      base: [baseSugar],
      target: [misleadingTargetZest],
    },
    instructions: {
      added: [added],
      removed: [removed],
      modified: [
        {
          before,
          after,
          changed_fields: [
            "title",
            "text",
            "actions",
            "inputs",
            "action_order",
            "duration",
            "temperature",
          ],
        },
      ],
    },
    has_changes: true,
  };
  const currentInstructions = [added, after, unchanged];
  const recipe = targetRecipeDetail(diff, {
    ingredients: [seaSalt, freshZest],
    instructions: [...currentInstructions],
  });

  return {
    comparison: buildRecipeComparisonModel(recipe, diff),
    currentInstructions,
  };
}

function renderInstructions() {
  const fixture = instructionFixture();
  return {
    ...fixture,
    ...render(
      <RecipeComparisonInstructions comparison={fixture.comparison} />,
    ),
  };
}

function rowWithText(container: HTMLElement, text: string): HTMLElement {
  const row = Array.from(
    container.querySelectorAll<HTMLElement>(
      ".recipe-comparison-instruction-row",
    ),
  ).find((candidate) => {
    const primaryText = candidate.querySelector<HTMLElement>(
      '[data-comparison-value="current"] .recipe-comparison-instruction-value__text, [data-comparison-value="previous"].recipe-comparison-instruction-row__previous--removed .recipe-comparison-instruction-value__text',
    );
    return primaryText?.textContent === text;
  });
  expect(row).not.toBeNull();
  return row!;
}

function rowWithHeading(container: HTMLElement, name: string): HTMLElement {
  const heading = within(container).getByRole("heading", { name });
  const row = heading.closest<HTMLElement>(".recipe-comparison-instruction-row");
  expect(row).not.toBeNull();
  return row!;
}

function viewPanel(name: "Steps" | "Cooking breakdown"): HTMLElement {
  return screen.getByRole("tabpanel", { name });
}

describe("RecipeComparisonInstructions", () => {
  it("opens in Steps with a wired, keyboard-ready comparison view switch", () => {
    const { comparison, currentInstructions } = renderInstructions();
    const stepsTab = screen.getByRole("tab", { name: "Steps" });
    const breakdownTab = screen.getByRole("tab", {
      name: "Cooking breakdown",
    });
    const steps = viewPanel("Steps");

    expect(
      screen.getByRole("tablist", { name: "Instruction comparison view" }),
    ).toContainElement(stepsTab);
    expect(stepsTab).toHaveAttribute("aria-selected", "true");
    expect(stepsTab).toHaveAttribute("tabindex", "0");
    expect(stepsTab).toHaveAttribute(
      "aria-controls",
      "recipe-comparison-instructions-steps-panel",
    );
    expect(breakdownTab).toHaveAttribute("aria-selected", "false");
    expect(breakdownTab).toHaveAttribute("tabindex", "-1");
    expect(
      document.getElementById("recipe-comparison-instructions-breakdown-panel"),
    ).toHaveAttribute("hidden");

    const rows = Array.from(
      steps.querySelectorAll<HTMLElement>(
        ".recipe-comparison-instruction-row",
      ),
    );

    expect(comparison.instructionRows.map((row) => row.displayOrder)).toEqual([
      0, 1, 3, 3,
    ]);
    expect(
      rows.map(
        (row) =>
          row.querySelector<HTMLElement>(
            ".recipe-comparison-instruction-value__text",
          )?.textContent,
      ),
    ).toEqual([
      "Prepare the pan.",
      "Fold the fresh batter.",
      "Rest the batter overnight.",
      "Serve while warm.",
    ]);

    for (const instructionItem of currentInstructions) {
      expect(
        Array.from(
          steps.querySelectorAll<HTMLElement>(
            '[data-comparison-value="current"] .recipe-comparison-instruction-value__text',
          ),
        ).filter((item) => item.textContent === instructionItem.text),
      ).toHaveLength(1);
    }
    expect(
      screen.getByRole("heading", { name: "Step 1: Get ready" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Step 2: Fold gently" }),
    ).toBeVisible();
    expect(screen.getByText("3 step changes")).toBeVisible();
  });

  it("keeps written-step statuses, insertions, deletions, and labels in Steps", () => {
    renderInstructions();
    const steps = viewPanel("Steps");
    const unchanged = rowWithText(steps, "Prepare the pan.");
    const changed = rowWithText(steps, "Fold the fresh batter.");
    const removed = rowWithText(steps, "Rest the batter overnight.");
    const added = rowWithText(steps, "Serve while warm.");

    expect(unchanged).toHaveClass(
      "recipe-comparison-instruction-row--unchanged",
    );
    expect(
      unchanged.querySelector(".recipe-comparison-instruction-row__status"),
    ).not.toBeInTheDocument();
    expect(unchanged.querySelector("ins, del")).not.toBeInTheDocument();

    expect(
      added.querySelector(".recipe-comparison-instruction-row__marker"),
    ).toHaveTextContent("+");
    expect(within(added).getByText("Added")).toBeVisible();
    expect(added.querySelector("ins")).toHaveTextContent("Serve while warm.");

    expect(
      removed.querySelector(".recipe-comparison-instruction-row__marker"),
    ).toHaveTextContent("−");
    expect(within(removed).getByText("Removed")).toBeVisible();
    expect(removed.querySelector("del")).toHaveTextContent(
      "Rest the batter overnight.",
    );

    expect(
      changed.querySelector(".recipe-comparison-instruction-row__marker"),
    ).toHaveTextContent("±");
    expect(within(changed).getByText("Changed")).toBeVisible();
    expect(changed.querySelector("ins")).toHaveTextContent(
      "Fold the fresh batter.",
    );
    expect(changed.querySelector("del")).toHaveTextContent(
      "Mix the old batter.",
    );
    for (const label of ["Step title changed", "Wording changed"]) {
      expect(within(changed).getByText(label)).toBeVisible();
    }
    expect(within(steps).queryByText("Cooking actions changed")).toBeNull();
    expect(
      within(steps).queryByRole("list", {
        name: "Cooking actions in this recipe for step 2",
      }),
    ).toBeNull();

    const current = changed.querySelector<HTMLElement>(
      '[data-comparison-value="current"]',
    );
    const previous = changed.querySelector<HTMLElement>(
      '[data-comparison-value="previous"]',
    );
    expect(current).not.toBeNull();
    expect(previous).not.toBeNull();
    expect(current!.nextElementSibling).toBe(previous);
    expect(within(previous!).getByText("Previous")).toBeVisible();
  });

  it("moves structured changes into Cooking breakdown and keeps version-specific action context", () => {
    const { container } = renderInstructions();
    fireEvent.click(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    );
    const breakdown = viewPanel("Cooking breakdown");
    const changed = rowWithHeading(breakdown, "Step 2: Fold gently");

    expect(screen.getByText("3 cooking breakdown changes")).toBeVisible();
    expect(within(breakdown).queryByText("Fold the fresh batter.")).toBeNull();
    expect(within(breakdown).queryByText("Wording changed")).toBeNull();
    for (const label of [
      "Cooking actions changed",
      "Ingredients used in the step changed",
      "Order within the step changed",
      "Timing changed",
      "Temperature changed",
    ]) {
      expect(within(changed).getByText(label)).toBeVisible();
    }

    const currentActions = within(changed).getByRole("list", {
      name: "Cooking actions in this recipe for step 2",
    });
    const previousActions = within(changed).getByRole("list", {
      name: "Cooking actions in the starting recipe for step 2",
    });
    expect(
      within(changed)
        .getByRole("heading", { name: "Step 2: Fold gently" })
        .closest("ins"),
    ).toBeNull();
    const currentActionGroup = currentActions.closest("ins");
    const previousActionGroup = previousActions.closest("del");
    expect(currentActionGroup).toHaveClass(
      "recipe-comparison-action-group--added",
    );
    expect(previousActionGroup).toHaveClass(
      "recipe-comparison-action-group--removed",
    );
    expect(currentActions).toHaveClass("recipe-comparison-actions--added");
    expect(previousActions).toHaveClass("recipe-comparison-actions--removed");
    expect(
      within(currentActionGroup!).getByText("Current cooking breakdown"),
    ).toBeVisible();
    expect(
      within(previousActionGroup!).getByText("Previous cooking breakdown"),
    ).toBeVisible();
    const currentActionRows = Array.from(currentActions.children);

    expect(currentActionRows).toHaveLength(2);
    expect(currentActionRows[0]).toHaveTextContent("Line pan");
    expect(currentActionRows[1]).toHaveTextContent("Bake");
    expect(currentActionRows[0]).toHaveTextContent(
      "Fresh zest, Ingredient no longer available, and Sea salt",
    );
    expect(currentActionRows[0]).toHaveTextContent("Previously used action");
    expect(currentActionRows[0]).toHaveTextContent("5 minutes");
    expect(currentActionRows[0]).toHaveTextContent("180 °C");
    expect(currentActionRows[1]).toHaveTextContent("Sea salt");
    expect(currentActionRows[1]).toHaveTextContent("180 °C");
    expect(currentActionRows[0]!.children).toHaveLength(3);
    expect(currentActionRows[0]!.children[0]).toHaveClass(
      "recipe-comparison-action__verb",
    );
    expect(currentActionRows[0]!.children[1]).toHaveClass(
      "recipe-comparison-action__main",
    );
    expect(currentActionRows[0]!.children[2]).toHaveClass(
      "recipe-comparison-action__details",
    );
    expect(previousActions).toHaveTextContent(
      "Base sugar and Ingredient no longer available",
    );
    expect(previousActions).toHaveTextContent("5 minutes");
    expect(currentActions).not.toHaveTextContent("With Fresh zest");
    expect(currentActions).not.toHaveTextContent("For 5 minutes");
    expect(currentActions).not.toHaveTextContent("At 180 °C");
    const added = breakdown.querySelector<HTMLElement>(
      ".recipe-comparison-instruction-row--added",
    );
    const removed = breakdown.querySelector<HTMLElement>(
      ".recipe-comparison-instruction-row--removed",
    );
    expect(added).not.toBeNull();
    expect(removed).not.toBeNull();
    expect(
      added?.querySelector(
        '[data-comparison-value="current"] ins.recipe-comparison-action-group--added',
      ),
    ).not.toBeNull();
    expect(
      removed?.querySelector(
        '[data-comparison-value="previous"] del.recipe-comparison-action-group--removed',
      ),
    ).not.toBeNull();
    expect(within(added!).getByText("Current cooking breakdown")).toBeVisible();
    expect(
      within(removed!).getByText("Previous cooking breakdown"),
    ).toBeVisible();
    expect(
      within(breakdown).getByText(
        "No cooking breakdown was recorded for this step.",
      ),
    ).toBeVisible();

    expect(container).not.toHaveTextContent("Wrong target-context name");
    expect(container).not.toHaveTextContent("SECRET_CURRENT_SALT");
    expect(container).not.toHaveTextContent(UNKNOWN_OCCURRENCE_ID);
    expect(container).not.toHaveTextContent(
      "20000000-0000-4000-8000-000000000001",
    );
  });

  it("projects prose-only and action-only modifications into their own views", () => {
    const priorAction = structuredAction("prior-mix", "mix", 0);
    const nextAction = structuredAction("next-fold", "fold", 0);
    const beforeWords = {
      ...instruction("before-words", "Old wording.", 0),
      title: "Written only",
    };
    const afterWords = {
      ...instruction("after-words", "New wording.", 0),
      title: "Written only",
    };
    const beforeActions = {
      ...instruction("before-actions", "Keep this wording.", 1, [priorAction]),
      title: "Action only",
    };
    const afterActions = {
      ...instruction("after-actions", "Keep this wording.", 1, [nextAction]),
      title: "Action only",
    };
    const addedWithoutActions = {
      ...instruction("added-without-actions", "A new written step.", 2),
      title: "New actionless step",
    };
    const removedWithoutActions = {
      ...instruction("removed-without-actions", "An old written step.", 3),
      title: "Removed actionless step",
    };
    const diff: RecipeDiff = {
      ...mixedDiff(),
      metadata_changes: [],
      ingredients: { added: [], removed: [], replaced: [], modified: [] },
      ingredient_context: { base: [], target: [] },
      instructions: {
        added: [addedWithoutActions],
        removed: [removedWithoutActions],
        modified: [
          { before: beforeWords, after: afterWords, changed_fields: ["text"] },
          {
            before: beforeActions,
            after: afterActions,
            changed_fields: ["actions"],
          },
        ],
      },
      has_changes: true,
    };
    const recipe = targetRecipeDetail(diff, {
      ingredients: [],
      instructions: [afterWords, afterActions, addedWithoutActions],
    });
    render(
      <RecipeComparisonInstructions
        comparison={buildRecipeComparisonModel(recipe, diff)}
      />,
    );

    const steps = viewPanel("Steps");
    expect(rowWithText(steps, "New wording.")).toHaveClass(
      "recipe-comparison-instruction-row--changed",
    );
    expect(rowWithText(steps, "Keep this wording.")).toHaveClass(
      "recipe-comparison-instruction-row--unchanged",
    );
    expect(screen.getByText("3 step changes")).toBeVisible();

    fireEvent.click(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    );
    const breakdown = viewPanel("Cooking breakdown");
    expect(rowWithHeading(breakdown, "Step 1: Written only")).toHaveClass(
      "recipe-comparison-instruction-row--unchanged",
    );
    expect(rowWithHeading(breakdown, "Step 2: Action only")).toHaveClass(
      "recipe-comparison-instruction-row--changed",
    );
    expect(rowWithHeading(breakdown, "Step 3: New actionless step")).toHaveClass(
      "recipe-comparison-instruction-row--unchanged",
    );
    expect(
      within(breakdown).queryByRole("heading", {
        name: "Step 4: Removed actionless step",
      }),
    ).toBeNull();
    expect(screen.getByText("1 cooking breakdown change")).toBeVisible();
  });

  it("shows only the meaningful side when a modification adds or removes every structured action", () => {
    const priorAction = structuredAction("remove-only-action", "mix", 0);
    const nextAction = structuredAction("add-only-action", "fold", 0);
    const beforeRemoval = {
      ...instruction("before-removal", "Keep this wording.", 0, [priorAction]),
      title: "Remove all actions",
    };
    const afterRemoval = {
      ...instruction("after-removal", "Keep this wording.", 0),
      title: "Remove all actions",
    };
    const beforeAddition = {
      ...instruction("before-addition", "Keep this wording too.", 1),
      title: "Add first action",
    };
    const afterAddition = {
      ...instruction("after-addition", "Keep this wording too.", 1, [nextAction]),
      title: "Add first action",
    };
    const diff: RecipeDiff = {
      ...mixedDiff(),
      metadata_changes: [],
      ingredients: { added: [], removed: [], replaced: [], modified: [] },
      ingredient_context: { base: [], target: [] },
      instructions: {
        added: [],
        removed: [],
        modified: [
          {
            before: beforeRemoval,
            after: afterRemoval,
            changed_fields: ["actions"],
          },
          {
            before: beforeAddition,
            after: afterAddition,
            changed_fields: ["actions"],
          },
        ],
      },
      has_changes: true,
    };
    const recipe = targetRecipeDetail(diff, {
      ingredients: [],
      instructions: [afterRemoval, afterAddition],
    });
    render(
      <RecipeComparisonInstructions
        comparison={buildRecipeComparisonModel(recipe, diff)}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    );
    const breakdown = viewPanel("Cooking breakdown");
    const removal = rowWithHeading(
      breakdown,
      "Step 1: Remove all actions",
    );
    const addition = rowWithHeading(breakdown, "Step 2: Add first action");

    expect(removal).toHaveClass("recipe-comparison-instruction-row--changed");
    expect(
      within(removal).queryByRole("list", {
        name: "Cooking actions in this recipe for step 1",
      }),
    ).toBeNull();
    expect(
      within(removal).getByRole("list", {
        name: "Cooking actions in the starting recipe for step 1",
      }),
    ).toHaveClass("recipe-comparison-actions--removed");
    expect(within(removal).getByText("Previous cooking breakdown")).toBeVisible();

    expect(addition).toHaveClass("recipe-comparison-instruction-row--changed");
    expect(
      within(addition).getByRole("list", {
        name: "Cooking actions in this recipe for step 2",
      }),
    ).toHaveClass("recipe-comparison-actions--added");
    expect(
      within(addition).queryByRole("list", {
        name: "Cooking actions in the starting recipe for step 2",
      }),
    ).toBeNull();
    expect(within(addition).getByText("Current cooking breakdown")).toBeVisible();
    expect(screen.getByText("2 cooking breakdown changes")).toBeVisible();
  });

  it("supports wrapped arrow, Home, and End navigation", () => {
    renderInstructions();
    const stepsTab = screen.getByRole("tab", { name: "Steps" });
    const breakdownTab = screen.getByRole("tab", {
      name: "Cooking breakdown",
    });
    stepsTab.focus();

    fireEvent.keyDown(stepsTab, { key: "ArrowLeft" });
    expect(breakdownTab).toHaveFocus();
    expect(breakdownTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(breakdownTab, { key: "Home" });
    expect(stepsTab).toHaveFocus();
    fireEvent.keyDown(stepsTab, { key: "End" });
    expect(breakdownTab).toHaveFocus();
    fireEvent.keyDown(breakdownTab, { key: "ArrowRight" });
    expect(stepsTab).toHaveFocus();
  });
});
