import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RecipeSummary } from "../../lib/recipe-api";
import { RecipeCard } from "./recipe-card";

function recipe(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: "recipe-one",
    lineage_id: "lineage-one",
    parent_version_id: null,
    version_number: 1,
    title: "Carrot Walnut Snack Cake",
    description: null,
    servings: "8.00",
    created_at: "2026-08-20T00:00:00Z",
    author: { id: "cook-one", handle: "alice", display_name: "Alice Cook" },
    parent: null,
    ...overrides,
  };
}

describe("RecipeCard", () => {
  it("keeps the public card link, author, and member action as separate controls", () => {
    render(
      <RecipeCard
        actions={<button type="button">Save recipe</button>}
        recipe={recipe()}
      />,
    );

    const card = screen.getByRole("article", { name: "Carrot Walnut Snack Cake" });
    const recipeLink = within(card).getByRole("link", {
      name: "Carrot Walnut Snack Cake",
    });
    const authorLink = within(card).getByRole("link", { name: "Alice Cook" });
    const saveButton = within(card).getByRole("button", { name: "Save recipe" });

    expect(recipeLink).toHaveAttribute("href", "/recipes/recipe-one");
    expect(authorLink).toHaveAttribute("href", "/cooks/alice");
    expect(recipeLink).not.toContainElement(authorLink);
    expect(recipeLink).not.toContainElement(saveButton);
    expect(within(card).queryByText(/no description provided/i)).not.toBeInTheDocument();
    expect(within(card).getByText("Original")).toBeInTheDocument();
  });

  it("does not link a private recipe title", () => {
    render(<RecipeCard publiclyAccessible={false} recipe={recipe()} />);

    const card = screen.getByRole("article", { name: "Carrot Walnut Snack Cake" });
    expect(
      within(card).queryByRole("link", { name: "Carrot Walnut Snack Cake" }),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByRole("heading", { name: "Carrot Walnut Snack Cake" }),
    ).toBeInTheDocument();
  });
});
