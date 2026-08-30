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
    published_at: "2026-08-21T00:00:00Z",
    categories: [],
    author: { id: "cook-one", handle: "alice", display_name: "Alice Cook" },
    parent: null,
    ...overrides,
  };
}

describe("RecipeCard", () => {
  it("keeps image-first content and separate public, author, and member controls", () => {
    render(
      <RecipeCard
        actions={<button type="button">Save recipe</button>}
        recipe={recipe({ description: "Tender carrot cake with toasted walnuts." })}
        visibilityLabel="Published"
      />,
    );

    const card = screen.getByRole("article", { name: "Carrot Walnut Snack Cake" });
    const artwork = card.querySelector<HTMLElement>(".recipe-card__artwork");
    const body = card.querySelector<HTMLElement>(".recipe-card__body");
    const header = card.querySelector<HTMLElement>(".recipe-card__header");
    const metadata = card.querySelector<HTMLElement>(".recipe-card__metadata");
    const actions = card.querySelector<HTMLElement>(".recipe-card__actions");
    const recipeLink = within(card).getByRole("link", {
      name: "Carrot Walnut Snack Cake",
    });
    const authorLink = within(card).getByRole("link", { name: "Alice Cook" });
    const saveButton = within(card).getByRole("button", { name: "Save recipe" });

    expect(card.firstElementChild).toBe(artwork);
    expect(artwork?.nextElementSibling).toBe(body);
    expect(header).toContainElement(recipeLink);
    expect(header).toContainElement(authorLink);
    expect(metadata).toContainElement(within(card).getByText("8 servings"));
    expect(metadata).toContainElement(within(card).getByText("Published"));
    expect(actions).toContainElement(saveButton);
    expect(recipeLink).toHaveAttribute("href", "/recipes/recipe-one");
    expect(authorLink).toHaveAttribute("href", "/cooks/alice");
    expect(recipeLink).not.toContainElement(authorLink);
    expect(recipeLink).not.toContainElement(saveButton);
    expect(within(card).getByText("Tender carrot cake with toasted walnuts.")).toBeVisible();
    expect(within(card).queryByText(/no description provided/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/^original$/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/^version \d+$/i)).not.toBeInTheDocument();
  });

  it("keeps parent context without labeling the card as a version", () => {
    render(
      <RecipeCard
        recipe={recipe({
          id: "recipe-two",
          parent_version_id: "recipe-one",
          version_number: 2,
          title: "Lower-Sugar Pecan Carrot Cake",
          parent: {
            id: "recipe-one",
            title: "Carrot Walnut Snack Cake",
            version_number: 1,
            author: { id: "cook-one", handle: "alice", display_name: "Alice Cook" },
          },
        })}
      />,
    );

    const card = screen.getByRole("article", { name: "Lower-Sugar Pecan Carrot Cake" });
    expect(within(card).getByText(/based on/i)).toHaveTextContent(
      "Based on Carrot Walnut Snack Cake by Alice Cook",
    );
    expect(within(card).queryByText(/^version 2$/i)).not.toBeInTheDocument();
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

  it("shows immutable published category labels", () => {
    render(
      <RecipeCard
        recipe={recipe({
          categories: [
            {
              id: "category-one",
              name: "Quick & easy",
              slug: "quick-easy",
            },
            {
              id: "category-two",
              name: "Dinner",
              slug: "dinner",
            },
          ],
        })}
      />,
    );

    const categories = screen.getByRole("list", {
      name: "Categories for Carrot Walnut Snack Cake",
    });
    expect(within(categories).getByText("Quick & easy")).toBeVisible();
    expect(within(categories).getByText("Dinner")).toBeVisible();
    expect(within(categories).queryByRole("link")).not.toBeInTheDocument();
  });
});
