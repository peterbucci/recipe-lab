import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RecipePage, RecipeSummary } from "../../lib/recipe-api";
import { RecipeBrowser } from "./recipe-browser";

function recipe(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: "recipe-one",
    lineage_id: "lineage-one",
    parent_version_id: null,
    version_number: 1,
    title: "Carrot Walnut Snack Cake",
    description: "A softly spiced cake built for an afternoon snack.",
    servings: "8.00",
    created_at: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

function page(overrides: Partial<RecipePage> = {}): RecipePage {
  return {
    items: [recipe()],
    page: 1,
    page_size: 12,
    total: 13,
    total_pages: 2,
    ...overrides,
  };
}

describe("RecipeBrowser", () => {
  it("renders searchable recipe cards and query-preserving pagination", () => {
    const { container } = render(
      <RecipeBrowser
        data={page({
          items: [
            recipe(),
            recipe({
              id: "recipe-two",
              parent_version_id: "recipe-one",
              version_number: 2,
              title: "Lower-Sugar Pecan Carrot Cake",
              description: null,
            }),
          ],
        })}
        query="carrot"
        recipeType="all"
      />,
    );

    const search = screen.getByRole("search");
    expect(within(search).getByLabelText(/search recipes/i)).toHaveValue("carrot");
    expect(within(search).getByRole("link", { name: /clear/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
    expect(screen.getByRole("heading", { name: /results for “carrot”/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /find something to cook/i })).toBeInTheDocument();
    expect(screen.getByText("13 recipes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /lower-sugar pecan carrot cake/i })).toHaveAttribute(
      "href",
      "/recipes/recipe-two",
    );
    expect(screen.getByText(/^original$/i)).toBeInTheDocument();
    expect(screen.getByText(/^version 2$/i)).toBeInTheDocument();
    expect(screen.getByText(/no description provided/i)).toBeInTheDocument();
    const filters = screen.getByRole("navigation", { name: /recipe type/i });
    expect(within(filters).getByRole("link", { name: "All" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(filters).getByRole("link", { name: "Originals" })).toHaveAttribute(
      "href",
      "/recipes?q=carrot&type=originals",
    );
    expect(within(filters).getByRole("link", { name: "Versions" })).toHaveAttribute(
      "href",
      "/recipes?q=carrot&type=versions",
    );
    const artworks = container.querySelectorAll(".recipe-card__artwork");
    expect(artworks).toHaveLength(2);
    expect(artworks[0]).toHaveAttribute("aria-hidden", "true");
    expect(artworks[0]).toHaveAttribute(
      "data-artwork-variant",
      artworks[1].getAttribute("data-artwork-variant"),
    );
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/recipes?q=carrot&page=2",
    );
    expect(screen.getByText(/page 1 of 2/i)).toHaveAttribute("aria-current", "page");
  });

  it("distinguishes an empty search from an empty catalog", () => {
    const { rerender } = render(
      <RecipeBrowser
        data={page({ items: [], total: 0, total_pages: 0 })}
        query="rutabaga"
        recipeType="all"
      />,
    );

    expect(screen.getByRole("heading", { name: /no recipes matched/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /clear search/i })).toHaveAttribute(
      "href",
      "/recipes",
    );

    rerender(
      <RecipeBrowser
        data={page({ items: [], total: 0, total_pages: 0 })}
        query=""
        recipeType="all"
      />,
    );
    expect(screen.getByRole("heading", { name: /no recipes are available yet/i })).toBeInTheDocument();
    expect(screen.getByText(/when they are added to the public demo/i)).toBeInTheDocument();
  });

  it("preserves the active filter across search controls, pagination, and stale-page recovery", () => {
    const { rerender } = render(
      <RecipeBrowser data={page({ page: 2, total_pages: 3 })} query="carrot" recipeType="versions" />,
    );

    const search = screen.getByRole("search");
    expect(search.querySelector('input[name="type"]')).toHaveValue("versions");
    expect(within(search).getByRole("link", { name: /clear/i })).toHaveAttribute(
      "href",
      "/recipes?type=versions",
    );

    const filters = screen.getByRole("navigation", { name: /recipe type/i });
    expect(within(filters).getByRole("link", { name: "Versions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(filters).getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/recipes?q=carrot",
    );
    expect(within(filters).getByRole("link", { name: "Originals" })).toHaveAttribute(
      "href",
      "/recipes?q=carrot&type=originals",
    );
    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute(
      "href",
      "/recipes?q=carrot&type=versions",
    );
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/recipes?q=carrot&type=versions&page=3",
    );

    rerender(
      <RecipeBrowser
        data={page({ items: [], page: 99, total: 13, total_pages: 2 })}
        query="carrot"
        recipeType="versions"
      />,
    );

    expect(screen.getByRole("heading", { name: /beyond the results/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /return to the first page/i })).toHaveAttribute(
      "href",
      "/recipes?q=carrot&type=versions",
    );
    expect(screen.queryByRole("navigation", { name: /recipe result pages/i })).not.toBeInTheDocument();
  });

  it("shows an honest empty state for a filtered collection", () => {
    render(
      <RecipeBrowser
        data={page({ items: [], total: 0, total_pages: 0 })}
        query=""
        recipeType="originals"
      />,
    );

    expect(screen.getByRole("heading", { name: /no original recipes are available yet/i })).toBeInTheDocument();
    expect(screen.getByText(/choose another filter/i)).toBeInTheDocument();
  });
});
