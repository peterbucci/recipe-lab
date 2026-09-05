import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  mixedDiff,
  sectionNamed,
} from "./recipe-diff-view-test-support";
import { RecipeDiffView } from "./recipe-diff-view";

describe("RecipeDiffView", () => {
  it("gives additions, removals, substitutions, amounts, and preparation changes distinct text", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    const ingredients = sectionNamed("Ingredient changes");

    const substitution = within(ingredients).getByRole("article", {
      name: "Use Pecan instead of Walnut",
    });
    expect(within(substitution).getByText("Substitution")).toBeInTheDocument();
    expect(
      within(substitution).getByText("Amount changed"),
    ).toBeInTheDocument();
    expect(
      within(substitution).getByText("Preparation changed"),
    ).toBeInTheDocument();
    expect(
      within(substitution).getByText("Starting ingredient"),
    ).toBeInTheDocument();
    expect(within(substitution).getByText("Use instead")).toBeInTheDocument();
    const removedWalnutLabels = within(substitution).getAllByText("Walnut");
    expect(removedWalnutLabels).toHaveLength(2);
    expect(
      removedWalnutLabels.every((label) => label.closest("del") !== null),
    ).toBe(true);
    const addedPecanLabels = within(substitution).getAllByText("Pecan");
    expect(addedPecanLabels).toHaveLength(2);
    expect(
      addedPecanLabels.every((label) => label.closest("ins") !== null),
    ).toBe(true);
    expect(
      within(substitution).getByText("100 g").closest("del"),
    ).not.toBeNull();
    expect(
      within(substitution).getByText("90 g").closest("ins"),
    ).not.toBeNull();
    expect(
      within(substitution)
        .getByText(/preparation: roughly chopped/i)
        .closest("del"),
    ).not.toBeNull();
    expect(
      within(substitution)
        .getByText(/preparation: toasted and chopped/i)
        .closest("ins"),
    ).not.toBeNull();

    const amountChange = within(ingredients).getByRole("article", {
      name: "Change White sugar from 180 g to 140 g",
    });
    expect(
      within(amountChange).getByText("Amount changed"),
    ).toBeInTheDocument();
    expect(
      within(amountChange).getByText("Preparation changed"),
    ).toBeInTheDocument();
    expect(
      within(amountChange).getByText("Starting recipe"),
    ).toBeInTheDocument();
    expect(within(amountChange).getByText("This recipe")).toBeInTheDocument();
    expect(
      within(amountChange).getByText("180 g").closest("del"),
    ).not.toBeNull();
    expect(
      within(amountChange).getByText("140 g").closest("ins"),
    ).not.toBeNull();
    expect(
      within(amountChange)
        .getByText(/preparation: divided/i)
        .closest("ins"),
    ).not.toBeNull();

    const addition = within(ingredients).getByRole("article", {
      name: "Add Orange zest",
    });
    expect(within(addition).getByText("Added")).toBeInTheDocument();
    expect(within(addition).getByText("New ingredient")).toBeInTheDocument();
    expect(
      within(addition).getByText("Orange zest").closest("ins"),
    ).not.toBeNull();
    expect(within(addition).getByText("1 tbsp").closest("ins")).not.toBeNull();
    expect(
      within(addition).getByText(/preparation: finely grated/i),
    ).toBeInTheDocument();

    const removal = within(ingredients).getByRole("article", {
      name: "Remove Baking soda",
    });
    expect(within(removal).getByText("Removed")).toBeInTheDocument();
    expect(within(removal).getByText("Removed ingredient")).toBeInTheDocument();
    expect(
      within(removal).getByText("Baking soda").closest("del"),
    ).not.toBeNull();
    expect(within(removal).getByText("0.5 tsp").closest("del")).not.toBeNull();
  });
});

