import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RecipeIngredient,
  RecipeInstruction,
} from "../../lib/recipe-api";
import type { RecipeInstructionAction } from "../../lib/structured-action";
import { RecipeInstructionsPanel } from "./recipe-instructions-panel";

function instruction(
  id: string,
  displayOrder: number,
  title: string | null,
  text: string,
  actions: RecipeInstructionAction[] = [],
): RecipeInstruction {
  return {
    id,
    title,
    text,
    display_order: displayOrder,
    actions,
  };
}

function action(
  id: string,
  canonicalVerb: string,
  displayOrder: number,
  ingredientOccurrenceIds: string[] = [],
): RecipeInstructionAction {
  return {
    id,
    action_type: {
      id: `type-${id}`,
      key: canonicalVerb,
      canonical_verb: canonicalVerb,
      active: true,
    },
    display_order: displayOrder,
    ingredient_occurrence_ids: ingredientOccurrenceIds,
    duration: null,
    temperature: null,
  };
}

const flour: RecipeIngredient = {
  id: "ingredient-flour",
  ingredient_id: "catalog-flour",
  canonical_name: "flour",
  display_name: "All-purpose flour",
  measure: {
    kind: "qualitative",
    value: "as_needed",
    unit: null,
    display_unit: null,
    display: "As needed",
  },
  preparation_notes: null,
  display_order: 0,
};

describe("RecipeInstructionsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback): number => {
        callback(0);
        return 1;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens in the readable Steps view and uses a numbered fallback for untitled steps", () => {
    render(
      <RecipeInstructionsPanel
        ingredients={[]}
        instructions={[
          instruction(
            "second-step",
            1,
            null,
            "Let the batter rest before cooking.",
          ),
          instruction(
            "first-step",
            0,
            "Make the batter",
            "Whisk the dry ingredients together.",
          ),
        ]}
      />,
    );

    const stepsTab = screen.getByRole("tab", { name: "Steps" });
    const breakdownTab = screen.getByRole("tab", {
      name: "Cooking breakdown",
    });
    expect(stepsTab).toHaveAttribute("aria-selected", "true");
    expect(stepsTab).toHaveAttribute("tabindex", "0");
    expect(breakdownTab).toHaveAttribute("aria-selected", "false");
    expect(breakdownTab).toHaveAttribute("tabindex", "-1");

    const stepsPanel = screen.getByRole("tabpanel", { name: "Steps" });
    expect(
      within(stepsPanel)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Make the batter", "Step 2"]);
    expect(
      within(stepsPanel).getByText("Whisk the dry ingredients together."),
    ).toBeVisible();
    expect(
      document.getElementById("recipe-instructions-breakdown-panel"),
    ).toHaveAttribute("hidden");
  });

  it("switches to the Cooking breakdown and preserves authored action order", () => {
    const mix = action("mix", "mix", 0, [flour.id]);
    const fold = action("fold", "fold", 1);
    render(
      <RecipeInstructionsPanel
        ingredients={[flour]}
        instructions={[
          instruction(
            "batter-step",
            0,
            "Make the batter",
            "Mix, then fold the batter.",
            [fold, mix],
          ),
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    );

    const breakdown = screen.getByRole("list", {
      name: "Cooking breakdown for step 1",
    });
    const actions = within(breakdown).getAllByRole("listitem");
    expect(actions).toHaveLength(2);
    expect(
      within(actions[0]!).getByText("Mix", { selector: "strong" }),
    ).toBeVisible();
    expect(within(actions[0]!).getByText("All-purpose flour")).toBeVisible();
    expect(
      within(actions[1]!).getByText("Fold", { selector: "strong" }),
    ).toBeVisible();
    expect(within(actions[1]!).getByText("No ingredient linked")).toBeVisible();
    expect(document.getElementById("recipe-instructions-steps-panel")).toHaveAttribute(
      "hidden",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Steps" }));
    expect(screen.getByText("Mix, then fold the batter.")).toBeVisible();
  });

  it("supports arrow, Home, and End keyboard navigation between views", () => {
    render(
      <RecipeInstructionsPanel
        ingredients={[]}
        instructions={[
          instruction("step", 0, "Prepare", "Prepare the ingredients."),
        ]}
      />,
    );

    const stepsTab = screen.getByRole("tab", { name: "Steps" });
    const breakdownTab = screen.getByRole("tab", {
      name: "Cooking breakdown",
    });
    stepsTab.focus();

    fireEvent.keyDown(stepsTab, { key: "ArrowRight" });
    expect(breakdownTab).toHaveFocus();
    expect(breakdownTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(breakdownTab, { key: "Home" });
    expect(stepsTab).toHaveFocus();
    expect(stepsTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(stepsTab, { key: "End" });
    expect(breakdownTab).toHaveFocus();
    expect(breakdownTab).toHaveAttribute("aria-selected", "true");
  });
});
