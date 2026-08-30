import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchFeaturedRecipes: vi.fn(),
  fetchRecipeCategories: vi.fn(),
  fetchRecipePage: vi.fn(),
}));

vi.mock("../../lib/recipe-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/recipe-api")>()),
  ...apiMocks,
}));

import type { RecipeSummary } from "../../lib/recipe-api";
import { HomePublicDiscovery } from "./home-public-discovery";

function recipe(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: "recipe-one",
    lineage_id: "lineage-one",
    parent_version_id: null,
    version_number: 1,
    title: "Carrot Walnut Snack Cake",
    description: "A softly spiced cake.",
    servings: "8.00",
    created_at: "2026-08-20T00:00:00Z",
    published_at: "2026-08-21T00:00:00Z",
    categories: [],
    author: { id: "cook-one", handle: "alice", display_name: "Alice Cook" },
    parent: null,
    ...overrides,
  };
}

beforeEach(() => {
  apiMocks.fetchFeaturedRecipes.mockResolvedValue({ items: [recipe()] });
  apiMocks.fetchRecipeCategories.mockResolvedValue({
    items: [{ id: "category-breakfast", name: "Breakfast", slug: "breakfast" }],
  });
  apiMocks.fetchRecipePage.mockResolvedValue({
    items: [
      recipe({
        id: "recipe-two",
        parent_version_id: "recipe-one",
        title: "Pecan Carrot Cake",
      }),
    ],
    page: 1,
    page_size: 5,
    total: 1,
    total_pages: 1,
  });
});

describe("HomePublicDiscovery", () => {
  it("shows honest featured, category, and recent-publication content", async () => {
    render(await HomePublicDiscovery());

    const featured = screen.getByRole("region", { name: "Featured recipes" });
    expect(within(featured).getByRole("link", { name: "Carrot Walnut Snack Cake" })).toHaveAttribute(
      "href",
      "/recipes/recipe-one",
    );
    expect(screen.getByRole("link", { name: "Breakfast" })).toHaveAttribute(
      "href",
      "/recipes?category=breakfast",
    );
    const community = screen.getByRole("region", { name: "From the community" });
    expect(within(community).getByText(/published a new version/i)).toBeInTheDocument();
    expect(within(community).getByRole("link", { name: "Pecan Carrot Cake" })).toHaveAttribute(
      "href",
      "/recipes/recipe-two",
    );
    expect(within(community).getByText("Aug 21, 2026")).toHaveAttribute(
      "datetime",
      "2026-08-21T00:00:00Z",
    );
    expect(apiMocks.fetchRecipePage).toHaveBeenCalledWith({
      page: 1,
      pageSize: 5,
      sort: "newest",
    });
    expect(screen.queryByText(/picked for you/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/followers|cook time|save total/i)).not.toBeInTheDocument();
  });

  it("keeps each public section usable when its request fails", async () => {
    apiMocks.fetchFeaturedRecipes.mockRejectedValueOnce(new Error("featured unavailable"));
    apiMocks.fetchRecipeCategories.mockRejectedValueOnce(new Error("categories unavailable"));
    apiMocks.fetchRecipePage.mockRejectedValueOnce(new Error("community unavailable"));

    render(await HomePublicDiscovery());

    expect(screen.getByText("Featured recipes are unavailable right now.")).toBeInTheDocument();
    expect(screen.getByText("Categories are unavailable right now.")).toBeInTheDocument();
    expect(screen.getByText("Recent community recipes are unavailable right now.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retry featured recipes" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Retry recipe categories" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Retry community recipes" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("keeps the community item readable when an upstream publication date is invalid", async () => {
    apiMocks.fetchRecipePage.mockResolvedValueOnce({
      items: [recipe({ published_at: "not-a-timestamp", title: "Readable Recipe" })],
      page: 1,
      page_size: 5,
      total: 1,
      total_pages: 1,
    });

    render(await HomePublicDiscovery());

    const community = screen.getByRole("region", { name: "From the community" });
    expect(within(community).getByRole("link", { name: "Readable Recipe" })).toBeVisible();
    expect(community.querySelector("time")).toBeNull();
  });
});
