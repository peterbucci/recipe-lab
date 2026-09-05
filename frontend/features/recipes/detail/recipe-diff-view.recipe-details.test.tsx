import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  baseVersion,
  mixedDiff,
  sectionNamed,
  targetVersion,
} from "./recipe-diff-view-test-support";
import { RecipeDiffView } from "./recipe-diff-view";

describe("RecipeDiffView", () => {
  it("preserves every old and new recipe detail value", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    const details = sectionNamed("Recipe details");
    const titleChange = within(details).getByRole("article", { name: "Title" });
    expect(within(titleChange).getByText("Title changed")).toBeInTheDocument();
    expect(
      within(titleChange).getByText("Starting recipe"),
    ).toBeInTheDocument();
    expect(within(titleChange).getByText("This recipe")).toBeInTheDocument();
    expect(
      within(titleChange).getByText(baseVersion.title).closest("del"),
    ).not.toBeNull();
    expect(
      within(titleChange).getByText(targetVersion.title).closest("ins"),
    ).not.toBeNull();

    const descriptionChange = within(details).getByRole("article", {
      name: "Description",
    });
    expect(
      within(descriptionChange).getByText("Description changed"),
    ).toBeInTheDocument();
    expect(
      within(descriptionChange).getByText("Not provided").closest("del"),
    ).not.toBeNull();
    expect(
      within(descriptionChange)
        .getByText("The original cake with less sugar and toasted pecans.")
        .closest("ins"),
    ).not.toBeNull();

    const yieldChange = within(details).getByRole("article", { name: "Yield" });
    expect(within(yieldChange).getByText("Yield changed")).toBeInTheDocument();
    expect(
      within(yieldChange).getByText("8 servings").closest("del"),
    ).not.toBeNull();
    expect(
      within(yieldChange).getByText("6 servings").closest("ins"),
    ).not.toBeNull();
  });

  it("formats timing, difficulty, and notes changes as recipe details", () => {
    const diff = mixedDiff();
    diff.metadata_changes = [
      {
        field: "total_time_minutes",
        before: 420,
        after: 445,
      },
      {
        field: "active_time_minutes",
        before: null,
        after: 25,
      },
      { field: "difficulty", before: "easy", after: "medium" },
      {
        field: "notes",
        before: null,
        after: "Rest overnight before slicing.",
      },
    ];
    diff.ingredients = { added: [], removed: [], replaced: [], modified: [] };
    diff.instructions = { added: [], removed: [], modified: [] };

    render(<RecipeDiffView diff={diff} />);

    const details = sectionNamed("Recipe details");
    const totalTime = within(details).getByRole("article", {
      name: "Total time",
    });
    expect(within(totalTime).getByText("7 hr").closest("del")).not.toBeNull();
    expect(
      within(totalTime).getByText("7 hr 25 min").closest("ins"),
    ).not.toBeNull();

    const activeTime = within(details).getByRole("article", {
      name: "Active time",
    });
    expect(
      within(activeTime).getByText("Not provided").closest("del"),
    ).not.toBeNull();
    expect(within(activeTime).getByText("25 min").closest("ins")).not.toBeNull();

    const difficulty = within(details).getByRole("article", {
      name: "Difficulty",
    });
    expect(within(difficulty).getByText("Easy").closest("del")).not.toBeNull();
    expect(within(difficulty).getByText("Medium").closest("ins")).not.toBeNull();

    const notes = within(details).getByRole("article", { name: "Notes" });
    expect(within(notes).getByText("Not provided").closest("del")).not.toBeNull();
    expect(
      within(notes).getByText("Rest overnight before slicing.").closest("ins"),
    ).not.toBeNull();
  });
});

