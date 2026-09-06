import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkspaceEmptyState } from "./workspace-empty-state";

describe("WorkspaceEmptyState", () => {
  it("connects its default empty-state copy to an accessible level-two heading", () => {
    render(
      <WorkspaceEmptyState
        className="account-empty-state"
        description="Recipes you save will appear here."
        headingId="saved-recipes-empty"
        title="You have no saved recipes yet."
      />,
    );

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "You have no saved recipes yet.",
    });
    const emptyState = heading.closest("section");

    expect(emptyState).not.toBeNull();
    expect(emptyState).toHaveClass(
      "empty-state",
      "workspace-empty-state",
      "account-empty-state",
    );
    expect(emptyState).toHaveAttribute("aria-labelledby", "saved-recipes-empty");
    expect(emptyState).toHaveAttribute(
      "aria-describedby",
      "saved-recipes-empty-description",
    );
    expect(heading).toHaveAttribute("id", "saved-recipes-empty");
    expect(
      within(emptyState!).getByText("Nothing here yet"),
    ).toHaveClass("eyebrow", "workspace-empty-state__eyebrow");
    expect(
      within(emptyState!).getByText("Recipes you save will appear here."),
    ).toHaveAttribute("id", "saved-recipes-empty-description");
    expect(emptyState!.querySelector(".workspace-empty-state__action")).toBeNull();
  });

  it("supports a custom eyebrow, level-three heading, and action", () => {
    render(
      <WorkspaceEmptyState
        action={<button type="button">Clear search</button>}
        description="Try a different search term."
        eyebrow="No matches"
        headingId="activity-search-empty"
        headingLevel={3}
        title="No activity matches your search."
      />,
    );

    const heading = screen.getByRole("heading", {
      level: 3,
      name: "No activity matches your search.",
    });
    const emptyState = heading.closest("section");

    expect(emptyState).not.toBeNull();
    expect(within(emptyState!).getByText("No matches")).toHaveClass(
      "workspace-empty-state__eyebrow",
    );
    expect(
      within(emptyState!).getByRole("button", { name: "Clear search" }),
    ).toBeVisible();
    expect(
      within(emptyState!).getByRole("button", { name: "Clear search" }).parentElement,
    ).toHaveClass("workspace-empty-state__action");
  });
});
