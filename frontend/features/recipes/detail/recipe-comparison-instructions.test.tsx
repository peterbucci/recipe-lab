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
    1,
    [baseSugar.id, UNKNOWN_OCCURRENCE_ID],
  );
  priorAction.duration = exactMeasure("5 minutes", "time");

  const previousRestAction = structuredAction(
    "previous-rest-action",
    "rest",
    0,
  );
  previousRestAction.duration = exactMeasure("10 minutes", "time");

  const currentRestAction = structuredAction(
    "current-rest-action",
    "rest",
    1,
  );
  currentRestAction.action_type = { ...previousRestAction.action_type };
  currentRestAction.duration = exactMeasure("10 minutes", "time");

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
    ...instruction("before-step", "Mix the old batter.", 1, [
      previousRestAction,
      priorAction,
    ]),
    title: "Mix",
  };
  const after = {
    ...instruction("after-step", "Fold the fresh batter.", 1, [
      laterCurrentAction,
      firstCurrentAction,
      currentRestAction,
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
          unchanged_action_pairs: [
            {
              before_id: previousRestAction.id,
              after_id: currentRestAction.id,
            },
          ],
          modified_action_pairs: [],
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
    const changedHeading = within(changed).getByRole("heading", {
      name: "Step 2: Fold gently",
    });
    const changedHeadingRow = changedHeading.closest(
      ".recipe-comparison-instruction-row__heading",
    );
    expect(changedHeadingRow).not.toBeNull();
    expect(
      changedHeadingRow?.querySelector(
        ".recipe-comparison-instruction-row__status",
      ),
    ).toContainElement(within(changed).getByText("Changed"));
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
    const labels = within(changed).getByRole("list", {
      name: "Changes to step 2",
    });
    expect(previous!.nextElementSibling).toBe(labels);
    expect(current).not.toContainElement(labels);
  });

  it("merges structured changes into one Cooking breakdown list with version-specific action context", () => {
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

    const actions = within(changed).getByRole("list", {
      name: "Cooking action comparison for step 2",
    });
    expect(
      within(changed)
        .getByRole("heading", { name: "Step 2: Fold gently" })
        .closest("ins"),
    ).toBeNull();
    expect(within(changed).getAllByRole("list", { hidden: true })).toContain(
      actions,
    );
    const actionRows = Array.from(actions.children) as HTMLElement[];

    expect(actionRows).toHaveLength(4);
    expect(actionRows.map((item) => item.dataset.actionStatus)).toEqual([
      "added",
      "unchanged",
      "removed",
      "added",
    ]);
    expect(actionRows[0]).toHaveTextContent("Line pan");
    expect(actionRows[1]).toHaveTextContent("Rest");
    expect(actionRows[2]).toHaveTextContent("Mix");
    expect(actionRows[3]).toHaveTextContent("Bake");
    expect(actionRows[0]).toHaveTextContent(
      "Fresh zest, Ingredient no longer available, and Sea salt",
    );
    expect(actionRows[0]).toHaveTextContent("Previously used action");
    expect(actionRows[0]).toHaveTextContent("5 minutes");
    expect(actionRows[0]).toHaveTextContent("180 °C");
    expect(actionRows[1]).toHaveTextContent("10 minutes");
    expect(actionRows[2]).toHaveTextContent(
      "Base sugar and Ingredient no longer available",
    );
    expect(actionRows[2]).toHaveTextContent("5 minutes");
    expect(actionRows[3]).toHaveTextContent("Sea salt");
    expect(actionRows[3]).toHaveTextContent("180 °C");
    expect(actionRows[0]!.children).toHaveLength(4);
    expect(actionRows[0]!.children[1]).toHaveClass(
      "recipe-comparison-action__verb",
    );
    expect(actionRows[0]!.children[2]).toHaveClass(
      "recipe-comparison-action__main",
    );
    expect(actionRows[0]!.children[3]).toHaveClass(
      "recipe-comparison-action__details",
    );
    expect(actionRows[0]!.querySelector("ins")).toHaveTextContent(
      "Added action",
    );
    expect(actionRows[1]!.querySelector("ins, del")).toBeNull();
    expect(actionRows[2]!.querySelector("del")).toHaveTextContent(
      "Removed action",
    );
    expect(actionRows[3]!.querySelector("ins")).toHaveTextContent(
      "Added action",
    );
    expect(actions).not.toHaveTextContent("With Fresh zest");
    expect(actions).not.toHaveTextContent("For 5 minutes");
    expect(actions).not.toHaveTextContent("At 180 °C");
    expect(
      changed.querySelector(".recipe-comparison-instruction-row__step-number"),
    ).toHaveTextContent("2");
    expect(
      changed.querySelector(".recipe-comparison-instruction-row__step-number"),
    ).toBeVisible();
    const added = breakdown.querySelector<HTMLElement>(
      ".recipe-comparison-instruction-row--added",
    );
    const removed = breakdown.querySelector<HTMLElement>(
      ".recipe-comparison-instruction-row--removed",
    );
    expect(added).not.toBeNull();
    expect(removed).not.toBeNull();
    const addedActions = within(added!).getByRole("list", {
      name: "Cooking action comparison for step 4",
    });
    const removedActions = within(removed!).getByRole("list", {
      name: "Cooking action comparison for step 4",
    });
    expect(addedActions.children).toHaveLength(1);
    expect(addedActions.children[0]).toHaveAttribute(
      "data-action-status",
      "added",
    );
    expect(removedActions.children).toHaveLength(1);
    expect(removedActions.children[0]).toHaveAttribute(
      "data-action-status",
      "removed",
    );
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
          {
            before: beforeWords,
            after: afterWords,
            changed_fields: ["text"],
            unchanged_action_pairs: [],
            modified_action_pairs: [],
          },
          {
            before: beforeActions,
            after: afterActions,
            changed_fields: ["actions"],
            unchanged_action_pairs: [],
            modified_action_pairs: [],
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
    const wordingChange = rowWithText(steps, "New wording.");
    expect(wordingChange).toHaveClass(
      "recipe-comparison-instruction-row--changed",
    );
    const previousWording = wordingChange.querySelector<HTMLElement>(
      '[data-comparison-value="previous"]',
    );
    expect(previousWording).not.toBeNull();
    expect(previousWording?.querySelector("del")).toHaveTextContent(
      "Old wording.",
    );
    expect(previousWording).not.toHaveTextContent("Written only");
    expect(previousWording?.querySelector("h3")).not.toBeInTheDocument();
    const wordingLabels = within(wordingChange).getByRole("list", {
      name: "Changes to step 1",
    });
    expect(previousWording?.nextElementSibling).toBe(wordingLabels);
    expect(within(wordingLabels).getByText("Wording changed")).toBeVisible();
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
            unchanged_action_pairs: [],
            modified_action_pairs: [],
          },
          {
            before: beforeAddition,
            after: afterAddition,
            changed_fields: ["actions"],
            unchanged_action_pairs: [],
            modified_action_pairs: [],
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
    const removalActions = within(removal).getByRole("list", {
      name: "Cooking action comparison for step 1",
    });
    expect(removalActions.children).toHaveLength(1);
    expect(removalActions.children[0]).toHaveAttribute(
      "data-action-status",
      "removed",
    );

    expect(addition).toHaveClass("recipe-comparison-instruction-row--changed");
    const additionActions = within(addition).getByRole("list", {
      name: "Cooking action comparison for step 2",
    });
    expect(additionActions.children).toHaveLength(1);
    expect(additionActions.children[0]).toHaveAttribute(
      "data-action-status",
      "added",
    );
    expect(screen.getByText("2 cooking breakdown changes")).toBeVisible();
  });

  it("uses semantic action pairs instead of regenerated ids and keeps reordered actions neutral once", () => {
    const previousMix = structuredAction("previous-mix", "mix", 0);
    const previousBake = structuredAction("previous-bake", "bake", 1);
    const currentBake = structuredAction("current-bake", "bake", 0);
    const currentMix = structuredAction("current-mix", "mix", 1);
    currentBake.action_type = { ...previousBake.action_type };
    currentMix.action_type = { ...previousMix.action_type };
    const before = {
      ...instruction("before-reorder", "Mix, then bake.", 0, [
        previousMix,
        previousBake,
      ]),
      title: "Prepare",
    };
    const after = {
      ...instruction("after-reorder", "Mix, then bake.", 0, [
        currentBake,
        currentMix,
      ]),
      title: "Prepare",
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
            before,
            after,
            changed_fields: ["action_order"],
            unchanged_action_pairs: [
              { before_id: previousMix.id, after_id: currentMix.id },
              { before_id: previousBake.id, after_id: currentBake.id },
            ],
            modified_action_pairs: [],
          },
        ],
      },
      has_changes: true,
    };
    const recipe = targetRecipeDetail(diff, {
      ingredients: [],
      instructions: [after],
    });
    render(
      <RecipeComparisonInstructions
        comparison={buildRecipeComparisonModel(recipe, diff)}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    );
    const actions = screen.getByRole("list", {
      name: "Cooking action comparison for step 1",
    });
    const rows = Array.from(actions.children) as HTMLElement[];

    expect(rows).toHaveLength(2);
    expect(rows.map((item) => item.dataset.actionStatus)).toEqual([
      "unchanged",
      "unchanged",
    ]);
    expect(rows.map((item) => item.textContent)).toEqual(["BakeNo ingredient linked", "MixNo ingredient linked"]);
    expect(actions.querySelector("ins, del")).toBeNull();
    expect(screen.getByText("Order within the step changed")).toBeVisible();
  });

  it("renders changed action inputs inline while keeping shared ingredients neutral", () => {
    const baseOats = ingredient("base-oats", "Rolled oats", "100.0000", "g");
    const baseBlueberry = ingredient(
      "base-blueberry",
      "Blueberry",
      "50.0000",
      "g",
    );
    const baseOil = ingredient("base-oil", "Neutral oil", "1.0000", "tbsp");
    const currentOats = ingredient(
      "current-oats",
      "Rolled oats",
      "100.0000",
      "g",
    );
    const currentCinnamon = ingredient(
      "current-cinnamon",
      "Cinnamon",
      "1.0000",
      "tsp",
    );
    const currentOil = ingredient(
      "current-oil",
      "Neutral oil",
      "1.0000",
      "tbsp",
    );
    const previousAction = structuredAction("previous-cook", "cook", 0, [
      baseOats.id,
      baseBlueberry.id,
      baseOil.id,
    ]);
    const currentAction = structuredAction("current-cook", "cook", 0, [
      currentOats.id,
      currentCinnamon.id,
      currentOil.id,
    ]);
    currentAction.action_type = { ...previousAction.action_type };
    const before = instruction("before-cook", "Cook the batter.", 0, [
      previousAction,
    ]);
    const after = instruction("after-cook", "Cook the batter.", 0, [
      currentAction,
    ]);
    const diff: RecipeDiff = {
      ...mixedDiff(),
      metadata_changes: [],
      ingredients: { added: [], removed: [], replaced: [], modified: [] },
      ingredient_context: {
        base: [baseOats, baseBlueberry, baseOil],
        target: [currentOats, currentCinnamon, currentOil],
      },
      instructions: {
        added: [],
        removed: [],
        modified: [
          {
            before,
            after,
            changed_fields: ["inputs"],
            unchanged_action_pairs: [],
            modified_action_pairs: [
              { before_id: previousAction.id, after_id: currentAction.id },
            ],
          },
        ],
      },
      has_changes: true,
    };
    const recipe = targetRecipeDetail(diff, {
      ingredients: [currentOats, currentCinnamon, currentOil],
      instructions: [after],
    });
    render(
      <RecipeComparisonInstructions
        comparison={buildRecipeComparisonModel(recipe, diff)}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    );
    const actions = screen.getByRole("list", {
      name: "Cooking action comparison for step 1",
    });
    const rows = Array.from(actions.children) as HTMLElement[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-action-status", "changed");
    expect(rows[0]).toHaveTextContent("Cook");
    expect(rows[0]).toHaveTextContent("Rolled oats");
    expect(rows[0]).toHaveTextContent("Neutral oil");
    expect(
      rows[0]!.querySelector(
        ".recipe-comparison-action__fragment--removed",
      ),
    ).toHaveTextContent("Removed ingredient: Blueberry");
    expect(
      rows[0]!.querySelector(".recipe-comparison-action__fragment--added"),
    ).toHaveTextContent("Added ingredient: Cinnamon");
    expect(rows[0]!.querySelectorAll("del")).toHaveLength(1);
    expect(rows[0]!.querySelectorAll("ins")).toHaveLength(1);
  });

  it("renders changed duration and temperature within one changed action", () => {
    const previousAction = structuredAction("previous-heat", "heat", 0);
    previousAction.duration = exactMeasure("5 minutes", "time");
    previousAction.temperature = exactMeasure("180 °C", "temperature");
    const currentAction = structuredAction("current-heat", "heat", 0);
    currentAction.action_type = { ...previousAction.action_type };
    currentAction.duration = exactMeasure("10 minutes", "time");
    currentAction.temperature = exactMeasure("190 °C", "temperature");
    const before = instruction(
      "before-heat",
      "Heat the mixture.",
      0,
      [previousAction],
    );
    const after = instruction("after-heat", "Heat the mixture.", 0, [
      currentAction,
    ]);
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
            before,
            after,
            changed_fields: ["duration", "temperature"],
            unchanged_action_pairs: [],
            modified_action_pairs: [
              { before_id: previousAction.id, after_id: currentAction.id },
            ],
          },
        ],
      },
      has_changes: true,
    };
    const recipe = targetRecipeDetail(diff, {
      ingredients: [],
      instructions: [after],
    });
    render(
      <RecipeComparisonInstructions
        comparison={buildRecipeComparisonModel(recipe, diff)}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    );
    const actions = screen.getByRole("list", {
      name: "Cooking action comparison for step 1",
    });
    const rows = Array.from(actions.children) as HTMLElement[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-action-status", "changed");
    expect(rows[0]).toHaveClass("recipe-comparison-action--changed");
    expect(rows[0]).toHaveTextContent("Changed action:");
    expect(rows[0]).toHaveTextContent("5 minutes");
    expect(rows[0]).toHaveTextContent("10 minutes");
    expect(rows[0]).toHaveTextContent("180 °C");
    expect(rows[0]).toHaveTextContent("190 °C");
    expect(rows[0]!.querySelectorAll("del")).toHaveLength(2);
    expect(rows[0]!.querySelectorAll("ins")).toHaveLength(2);
    expect(rows[0]!.querySelector("del")).toHaveTextContent(
      "Previous duration: 5 minutes",
    );
    expect(rows[0]!.querySelector("ins")).toHaveTextContent(
      "New duration: 10 minutes",
    );
  });

  it("preserves the multiplicity of duplicate unchanged actions", () => {
    const previousFirst = structuredAction("previous-rest-one", "rest", 0);
    const previousSecond = structuredAction("previous-rest-two", "rest", 1);
    const currentFirst = structuredAction("current-rest-one", "rest", 0);
    const currentSecond = structuredAction("current-rest-two", "rest", 1);
    currentFirst.action_type = { ...previousFirst.action_type };
    currentSecond.action_type = { ...previousSecond.action_type };
    const before = instruction("before-rests", "Rest twice.", 0, [
      previousFirst,
      previousSecond,
    ]);
    const after = instruction("after-rests", "Rest twice, checking each time.", 0, [
      currentFirst,
      currentSecond,
    ]);
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
            before,
            after,
            changed_fields: ["text"],
            unchanged_action_pairs: [
              { before_id: previousFirst.id, after_id: currentFirst.id },
              { before_id: previousSecond.id, after_id: currentSecond.id },
            ],
            modified_action_pairs: [],
          },
        ],
      },
      has_changes: true,
    };
    const recipe = targetRecipeDetail(diff, {
      ingredients: [],
      instructions: [after],
    });
    render(
      <RecipeComparisonInstructions
        comparison={buildRecipeComparisonModel(recipe, diff)}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    );
    const actions = screen.getByRole("list", {
      name: "Cooking action comparison for step 1",
    });
    const rows = Array.from(actions.children) as HTMLElement[];

    expect(rows).toHaveLength(2);
    expect(rows.every((item) => item.dataset.actionStatus === "unchanged")).toBe(
      true,
    );
    expect(rows[0]).toHaveTextContent("Rest");
    expect(rows[1]).toHaveTextContent("Rest");
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
