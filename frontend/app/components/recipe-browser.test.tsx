import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RecipeCardSummary,
  RecipeCategory,
  RecipePage,
} from "../../lib/recipe-api";
import { buildRecipeCardSummary } from "../../test/builders/recipe";
import { AuthSessionProvider } from "./auth-session-provider";
import { RecipeBrowser } from "./recipe-browser";

const { push, refresh } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

function recipe(overrides: Partial<RecipeCardSummary> = {}): RecipeCardSummary {
  return buildRecipeCardSummary({
    title: "Carrot Walnut Snack Cake",
    description: "A softly spiced cake built for an afternoon snack.",
    servings: "8.00",
    average_rating: 4.5,
    rating_count: 2,
    save_count: 12,
    ...overrides,
  });
}

function AnonymousAuth({ children }: PropsWithChildren) {
  return (
    <AuthSessionProvider initialSession={{ status: "anonymous" }}>
      {children}
    </AuthSessionProvider>
  );
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
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });

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
                author: {
                  id: "cook-one",
                  handle: "alice",
                  display_name: "Alice Cook",
                },
              },
            }),
          ],
        })}
        query="carrot"
      />,
      { wrapper: AnonymousAuth },
    );

    expect(
      screen.getByRole("heading", { name: /all recipes matching “carrot”/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /all recipes matching “carrot”/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("13 public recipes")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Saved recipes" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Recipe type" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Sort recipes" })).toHaveValue(
      "newest",
    );
    expect(
      within(
        screen.getByRole("navigation", { name: "Recipe categories" }),
      ).getByRole("link", { name: "All categories" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", {
        name: "Lower-Sugar Pecan Carrot Cake",
      }),
    ).toHaveAttribute("href", "/recipes/recipe-two");
    expect(screen.getByText("Original", { exact: true })).toBeVisible();
    expect(screen.queryByText(/^version 2$/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("8 servings")).toHaveLength(2);
    expect(screen.getByText(/based on/i)).toHaveTextContent(
      "Based on Carrot Walnut Snack Cake",
    );
    const originalCard = screen.getByRole("article", {
      name: "Carrot Walnut Snack Cake",
    });
    const author = within(originalCard).getByRole("link", {
      name: "Alice Cook",
    });
    const description = within(originalCard).getByText(
      "A softly spiced cake built for an afternoon snack.",
    );
    const rating = within(originalCard).getByLabelText(
      "4.5 out of 5 from 2 ratings",
    );
    expect(author).toHaveAttribute("href", "/cooks/alice");
    expect(
      author.compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(rating) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(originalCard).getByRole("link", {
        name: "Sign in to save Carrot Walnut Snack Cake",
      }),
    ).toBeVisible();
    expect(within(originalCard).getByText("12 saves")).toBeVisible();
    expect(
      screen.queryByText(/no description provided/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: /recipe type/i }),
    ).not.toBeInTheDocument();
    const artworks = container.querySelectorAll(".recipe-card__artwork");
    expect(artworks).toHaveLength(2);
    expect(artworks[0]).toHaveAttribute("aria-hidden", "true");
    expect(artworks[0].getAttribute("data-artwork-variant")).not.toBe(
      artworks[1].getAttribute("data-artwork-variant"),
    );
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/recipes?q=carrot&page=2",
    );
    expect(screen.getByText(/page 1 of 2/i)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("presents and preserves an exact curated category filter", () => {
    const category: RecipeCategory = {
      id: "category-breakfast",
      name: "Breakfast",
      slug: "breakfast",
    };
    render(
      <RecipeBrowser
        categories={[category]}
        category={category}
        data={page({ page: 2, total_pages: 3 })}
        query="toast"
        sort="newest"
      />,
      { wrapper: AnonymousAuth },
    );

    expect(
      screen.getByRole("heading", {
        name: "Breakfast recipes matching “toast”",
      }),
    ).toBeInTheDocument();
    const categories = screen.getByRole("navigation", {
      name: "Recipe categories",
    });
    expect(
      within(categories).getByRole("link", { name: "Breakfast" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(categories).getByRole("link", { name: "All categories" }),
    ).toHaveAttribute("href", "/recipes?q=toast&sort=newest");
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/recipes?q=toast&category=breakfast&sort=newest&page=3",
    );
  });

  it("distinguishes an empty search from an empty catalog", () => {
    const { rerender } = render(
      <RecipeBrowser
        data={page({ items: [], total: 0, total_pages: 0 })}
        query="rutabaga"
      />,
      { wrapper: AnonymousAuth },
    );

    expect(
      screen.getByRole("heading", { name: /no recipes matched/i }),
    ).toBeInTheDocument();
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
    expect(
      screen.getByRole("heading", { name: /no recipes are available yet/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/when they are added/i)).toBeInTheDocument();
  });

  it("preserves the search across pagination and stale-page recovery", () => {
    const { rerender } = render(
      <RecipeBrowser data={page({ page: 2, total_pages: 3 })} query="carrot" />,
      { wrapper: AnonymousAuth },
    );

    expect(screen.queryByRole("combobox", { name: "Recipe type" })).toBeNull();
    expect(screen.getByRole("link", { name: /clear search/i })).toHaveAttribute(
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

    expect(
      screen.getByRole("heading", { name: /beyond the results/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /return to the first page/i }),
    ).toHaveAttribute("href", "/recipes?q=carrot");
    expect(
      screen.queryByRole("navigation", { name: /recipe result pages/i }),
    ).not.toBeInTheDocument();
  });

  it("preserves recipe type in category pills and pagination", () => {
    const category: RecipeCategory = {
      id: "category-dinner",
      name: "Dinner",
      slug: "dinner",
    };
    render(
      <RecipeBrowser
        categories={[category]}
        data={page()}
        query=""
        recipeType="versions"
        sort="newest"
      />,
      { wrapper: AnonymousAuth },
    );

    expect(
      screen.getByRole("heading", { name: "Recipe versions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("13 public recipe versions")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Recipe type" })).toBeNull();
    expect(screen.getByRole("link", { name: "Dinner" })).toHaveAttribute(
      "href",
      "/recipes?category=dinner&type=versions&sort=newest",
    );
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/recipes?type=versions&sort=newest&page=2",
    );
  });

  it("keeps recipe results and the active filter when category metadata is unavailable", () => {
    render(
      <RecipeBrowser
        categoriesUnavailable
        categorySlug="breakfast"
        data={page()}
        query="oats"
        sort="newest"
      />,
      { wrapper: AnonymousAuth },
    );

    expect(
      screen.getByRole("heading", {
        name: "Recipes in this category matching “oats”",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Carrot Walnut Snack Cake")).toBeVisible();
    expect(
      screen.getByText("Category filters are unavailable."),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(
      1,
    );

    const categories = screen.getByRole("navigation", {
      name: "Recipe categories",
    });
    expect(
      within(categories).getByRole("link", { name: "All categories" }),
    ).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/recipes?q=oats&category=breakfast&sort=newest&page=2",
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
