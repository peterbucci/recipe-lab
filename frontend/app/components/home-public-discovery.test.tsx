import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchFeaturedRecipes: vi.fn(),
  fetchRecipeCategories: vi.fn(),
}));
const navigationMocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("../../lib/recipe-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/recipe-api")>()),
  ...apiMocks,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigationMocks.refresh }),
}));

import type { RecipeSummary } from "../../lib/recipe-api";
import { buildRecipeSummary } from "../../test/builders/recipe";
import { AuthSessionProvider } from "./auth-session-provider";
import { HomeLoadNotice, HomeLoadStateProvider } from "./home-load-state";
import { HomePublicDiscovery } from "./home-public-discovery";

function recipe(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return buildRecipeSummary({
    title: "Carrot Walnut Snack Cake",
    description: "A softly spiced cake.",
    servings: "8.00",
    ...overrides,
  });
}

beforeEach(() => {
  navigationMocks.refresh.mockReset();
  apiMocks.fetchFeaturedRecipes.mockResolvedValue({
    items: [
      {
        ...recipe(),
        average_rating: 4.5,
        rating_count: 2,
        save_count: 12,
      },
    ],
  });
  apiMocks.fetchRecipeCategories.mockResolvedValue({
    items: [{ id: "category-breakfast", name: "Breakfast", slug: "breakfast" }],
  });
});

async function renderDiscovery() {
  render(
    <AuthSessionProvider initialSession={{ status: "anonymous" }}>
      <HomeLoadStateProvider>
        <HomeLoadNotice />
        {await HomePublicDiscovery()}
      </HomeLoadStateProvider>
    </AuthSessionProvider>,
  );
}

describe("HomePublicDiscovery", () => {
  it("shows honest featured and category content", async () => {
    await renderDiscovery();

    const featured = screen.getByRole("region", { name: "Featured recipes" });
    expect(
      within(featured).getByRole("link", { name: "Carrot Walnut Snack Cake" }),
    ).toHaveAttribute("href", "/recipes/recipe-one");
    expect(screen.getByRole("link", { name: "Breakfast" })).toHaveAttribute(
      "href",
      "/recipes?category=breakfast",
    );
    const featuredHeading = within(featured).getByRole("heading", {
      name: "Featured recipes",
      level: 1,
    });
    expect(featuredHeading).toHaveClass("home-content-section__title");
    expect(featuredHeading).not.toHaveClass("eyebrow");
    const categoryHeading = within(
      screen.getByRole("region", { name: "Explore by category" }),
    ).getByRole("heading", {
      name: "Explore by category",
      level: 2,
    });
    expect(categoryHeading).toHaveClass("home-content-section__title");
    expect(categoryHeading).not.toHaveClass("eyebrow");
    expect(screen.queryByText(/featured collection/i)).toBeNull();
    expect(
      within(featured).getByText("Original", { exact: true }),
    ).toBeVisible();
    expect(
      within(featured).getByRole("link", { name: "Alice Cook" }),
    ).toHaveTextContent("Alice Cook");
    expect(within(featured).queryByText(/^By\b/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("4.5 out of 5 from 2 ratings")).toBeVisible();
    expect(screen.getByText("12 saves")).toBeVisible();
    expect(screen.getByText("8 servings")).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Sign in to save Carrot Walnut Snack Cake",
      }),
    ).toHaveAttribute("href", "/sign-in?return_to=%2Frecipes%2Frecipe-one");
    expect(
      within(featured).queryByText(/followers|cook time|minutes?|hours?/i),
    ).not.toBeInTheDocument();
  });

  it("keeps each public section usable behind one shared recovery notice", async () => {
    apiMocks.fetchFeaturedRecipes.mockRejectedValueOnce(
      new Error("featured unavailable"),
    );
    apiMocks.fetchRecipeCategories.mockRejectedValueOnce(
      new Error("categories unavailable"),
    );

    await renderDiscovery();

    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(
      await screen.findByRole("status", {
        name: "Some homepage information couldn’t be updated.",
      }),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(
      1,
    );
    expect(screen.queryByRole("link", { name: /^Retry / })).toBeNull();
  });

  it("keeps successful public sections visible when one source remains unavailable", async () => {
    apiMocks.fetchRecipeCategories.mockRejectedValue(
      new Error("categories unavailable"),
    );

    await renderDiscovery();

    expect(
      screen.getByRole("link", { name: "Carrot Walnut Snack Cake" }),
    ).toBeVisible();
    expect(
      screen.getByLabelText("Recipe categories unavailable"),
    ).toHaveTextContent("Unavailable");
    expect(
      await screen.findByRole("status", {
        name: "Some homepage information couldn’t be updated.",
      }),
    ).toBeVisible();
  });

});
