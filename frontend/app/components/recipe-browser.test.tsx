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
    author: { id: "cook-one", handle: "alice", display_name: "Alice Cook" },
    parent: null,
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
              parent: {
                id: "recipe-one",
                title: "Carrot Walnut Snack Cake",
                version_number: 1,
                author: { id: "cook-one", handle: "alice", display_name: "Alice Cook" },
              },
            }),
          ],
        })}
        query="carrot"
      />,
    );

    const search = screen.getByRole("search", { name: "Search recipe catalog" });
    expect(search).toHaveAttribute("action", "/recipes");
    expect(search).toHaveAttribute("method", "get");
    expect(within(search).getByLabelText(/search by recipe name/i)).toHaveValue("carrot");
    expect(within(search).getByRole("link", { name: /clear/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
    expect(screen.getByRole("heading", { name: /results for “carrot”/i })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /results for “carrot”/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /find something to cook/i })).toBeInTheDocument();
    expect(screen.getByText("13 recipes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /lower-sugar pecan carrot cake/i })).toHaveAttribute(
      "href",
      "/recipes/recipe-two",
    );
    expect(screen.queryByText(/^original$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^version 2$/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("8 servings")).toHaveLength(2);
    expect(screen.getByText(/based on/i)).toHaveTextContent(
      "Based on Carrot Walnut Snack Cake by Alice Cook",
    );
    expect(screen.getAllByRole("link", { name: "Alice Cook" })[0]).toHaveAttribute(
      "href",
      "/cooks/alice",
    );
    expect(screen.queryByText(/no description provided/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /recipe type/i })).not.toBeInTheDocument();
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
      />,
    );
    expect(screen.getByRole("heading", { name: /no recipes are available yet/i })).toBeInTheDocument();
    expect(screen.getByText(/when they are added/i)).toBeInTheDocument();
  });

  it("preserves the search across pagination and stale-page recovery", () => {
    const { rerender } = render(
      <RecipeBrowser data={page({ page: 2, total_pages: 3 })} query="carrot" />,
    );

    const search = screen.getByRole("search", { name: "Search recipe catalog" });
    expect(search.querySelector('input[name="type"]')).not.toBeInTheDocument();
    expect(within(search).getByRole("link", { name: /clear/i })).toHaveAttribute(
      "href",
      "/recipes",
    );

    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute(
      "href",
      "/recipes?q=carrot",
    );
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/recipes?q=carrot&page=3",
    );

    rerender(
      <RecipeBrowser
        data={page({ items: [], page: 99, total: 13, total_pages: 2 })}
        query="carrot"
      />,
    );

    expect(screen.getByRole("heading", { name: /beyond the results/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /return to the first page/i })).toHaveAttribute(
      "href",
      "/recipes?q=carrot",
    );
    expect(screen.queryByRole("navigation", { name: /recipe result pages/i })).not.toBeInTheDocument();
  });
});
