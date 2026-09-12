import { render, screen, within } from "@testing-library/react";
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

describe("RecipeComparisonInstructions", () => {
  it("renders every current step once in target order with deterministic removed rows", () => {
    const { comparison, container, currentInstructions } = renderInstructions();
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
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
          container.querySelectorAll<HTMLElement>(
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
    expect(screen.getByText("3 cooking changes")).toBeVisible();
  });

  it("uses visible statuses, insertion and deletion semantics, and every structured change label", () => {
    const { container } = renderInstructions();
    const unchanged = rowWithText(container, "Prepare the pan.");
    const changed = rowWithText(container, "Fold the fresh batter.");
    const removed = rowWithText(container, "Rest the batter overnight.");
    const added = rowWithText(container, "Serve while warm.");

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
    for (const label of [
      "Step title changed",
      "Wording changed",
      "Cooking actions changed",
      "Ingredients used in the step changed",
      "Order within the step changed",
      "Timing changed",
      "Temperature changed",
    ]) {
      expect(within(changed).getByText(label)).toBeVisible();
    }

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

  it("sorts structured actions and resolves inputs from the correct recipe version without exposing IDs", () => {
    const { container } = renderInstructions();
    const changed = rowWithText(container, "Fold the fresh batter.");
    const currentActions = within(changed).getByRole("list", {
      name: "Cooking actions in this recipe for step 2",
    });
    const previousActions = within(changed).getByRole("list", {
      name: "Cooking actions in the starting recipe for step 2",
    });
    const currentActionRows = Array.from(currentActions.children);

    expect(currentActionRows).toHaveLength(2);
    expect(currentActionRows[0]).toHaveTextContent("Line pan");
    expect(currentActionRows[1]).toHaveTextContent("Bake");
    expect(currentActionRows[0]).toHaveTextContent(
      "With Fresh zest, Ingredient no longer available, and Sea salt",
    );
    expect(currentActionRows[0]).toHaveTextContent("Previously used action");
    expect(currentActionRows[0]).toHaveTextContent("For 5 minutes");
    expect(currentActionRows[0]).toHaveTextContent("At 180 °C");
    expect(currentActionRows[1]).toHaveTextContent("With Sea salt");
    expect(currentActionRows[1]).toHaveTextContent("At 180 °C");
    expect(previousActions).toHaveTextContent(
      "With Base sugar and Ingredient no longer available",
    );
    expect(previousActions).toHaveTextContent("For 5 minutes");

    expect(container).not.toHaveTextContent("Wrong target-context name");
    expect(container).not.toHaveTextContent("SECRET_CURRENT_SALT");
    expect(container).not.toHaveTextContent(UNKNOWN_OCCURRENCE_ID);
    expect(container).not.toHaveTextContent(
      "20000000-0000-4000-8000-000000000001",
    );
  });
});
