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
    render(
      <RecipeBrowser
        data={page({
          items: [
            recipe(),
            recipe({
              id: "recipe-two",
              parent_version_id: "recipe-one",
              version_number: 2,
              title: "Lower-Sugar Pecan Carrot Cake",
            }),
          ],
        })}
        query="carrot"
      />,
    );

    const search = screen.getByRole("search");
    expect(within(search).getByLabelText(/search recipes/i)).toHaveValue("carrot");
    expect(within(search).getByRole("link", { name: /clear/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
    expect(screen.getByRole("heading", { name: /results for “carrot”/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /lower-sugar pecan carrot cake/i })).toHaveAttribute(
      "href",
      "/recipes/recipe-two",
    );
    expect(screen.getByText(/variant · version 2/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/recipes?q=carrot&page=2",
    );
    expect(screen.getByText(/page 1 of 2/i)).toHaveAttribute("aria-current", "page");
  });

  it("distinguishes an empty search from an empty catalog", () => {
    const { rerender } = render(
      <RecipeBrowser data={page({ items: [], total: 0, total_pages: 0 })} query="rutabaga" />,
    );

    expect(screen.getByRole("heading", { name: /no recipes matched/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /clear search/i })).toHaveAttribute(
      "href",
      "/recipes",
    );

    rerender(<RecipeBrowser data={page({ items: [], total: 0, total_pages: 0 })} query="" />);
    expect(screen.getByRole("heading", { name: /catalog is empty/i })).toBeInTheDocument();
    expect(screen.getByText(/as soon as the demo catalog is loaded/i)).toBeInTheDocument();
  });

  it("recovers from a page beyond the available results", () => {
    render(
      <RecipeBrowser data={page({ items: [], page: 99, total: 13, total_pages: 2 })} query="carrot" />,
    );

    expect(screen.getByRole("heading", { name: /beyond the catalog/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /return to the first page/i })).toHaveAttribute(
      "href",
      "/recipes?q=carrot",
    );
    expect(screen.queryByRole("navigation", { name: /recipe result pages/i })).not.toBeInTheDocument();
  });
});
