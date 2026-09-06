import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ingredient,
  instruction,
  mixedDiff,
  sectionNamed,
  structuredAction,
} from "./recipe-diff-view-test-support";
import { RecipeDiffView } from "./recipe-diff-view";

describe("RecipeDiffView", () => {
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

  it("shows authored step-title changes in the comparison", () => {
    const diff = mixedDiff();
    diff.metadata_changes = [];
    diff.ingredients = { added: [], removed: [], replaced: [], modified: [] };
    diff.instructions = {
      added: [],
      removed: [],
      modified: [
        {
          before: {
            ...instruction("before-step", "Blend until smooth.", 0),
            title: "Mix the batter",
          },
          after: {
            ...instruction("after-step", "Blend until smooth.", 0),
            title: "Make the batter",
          },
          changed_fields: ["title"],
        },
      ],
    };

    render(<RecipeDiffView diff={diff} />);

    const changed = screen.getByRole("article", { name: "Update step 1" });
    expect(within(changed).getByText("Step title changed")).toBeInTheDocument();
    expect(
      within(changed).getByText("Mix the batter").closest("del"),
    ).not.toBeNull();
    expect(
      within(changed).getByText("Make the batter").closest("ins"),
    ).not.toBeNull();
    expect(
      screen.getByText("Rename step 1 to Make the batter."),
    ).toBeInTheDocument();
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
});

