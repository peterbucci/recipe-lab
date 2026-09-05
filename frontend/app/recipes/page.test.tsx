import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeBrowseType } from "../../lib/recipe-browse-query";
import type { RecipeCategory, RecipePage } from "../../lib/recipe-api";
import RecipeBrowsePage from "./page";

const mocks = vi.hoisted(() => ({
  fetchRecipeCategories: vi.fn(),
  fetchRecipePage: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

vi.mock("../../lib/recipe-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-api")>();
  return {
    ...actual,
    fetchRecipeCategories: mocks.fetchRecipeCategories,
    fetchRecipePage: mocks.fetchRecipePage,
  };
});

interface BrowserProps {
  categories: readonly RecipeCategory[];
  categoriesUnavailable: boolean;
  category?: RecipeCategory;
  categorySlug?: string;
  data: RecipePage;
  query: string;
  recipeType?: RecipeBrowseType;
  sort?: "newest" | "title";
}

const recipePage: RecipePage = {
  items: [],
  page: 1,
  page_size: 12,
  total: 0,
  total_pages: 0,
};

const breakfast: RecipeCategory = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Breakfast",
  slug: "breakfast",
};

function browserProps(
  element: Awaited<ReturnType<typeof RecipeBrowsePage>>,
): BrowserProps {
  return (element.props.children as ReactElement<BrowserProps>).props;
}

describe("RecipeBrowsePage", () => {
  beforeEach(() => {
    mocks.fetchRecipeCategories.mockReset();
    mocks.fetchRecipePage.mockReset().mockResolvedValue(recipePage);
    mocks.notFound.mockClear();
  });

  it("treats category metadata as optional and preserves a category-filtered result page", async () => {
    mocks.fetchRecipeCategories.mockRejectedValue(
      new Error("category service unavailable"),
    );

    const element = await RecipeBrowsePage({
      searchParams: Promise.resolve({ category: "breakfast", q: "oats" }),
    });
    const props = browserProps(element);

    expect(mocks.fetchRecipePage).toHaveBeenCalledWith(
      expect.objectContaining({ category: "breakfast", query: "oats" }),
    );
    expect(props).toMatchObject({
      categories: [],
      categoriesUnavailable: true,
      category: undefined,
      categorySlug: "breakfast",
      data: recipePage,
    });
  });

  it("keeps recipe results as the page-level blocking resource", async () => {
    mocks.fetchRecipeCategories.mockResolvedValue({ items: [] });
    mocks.fetchRecipePage.mockRejectedValue(new Error("recipes unavailable"));

    await expect(
      RecipeBrowsePage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("recipes unavailable");
  });

  it("normalizes first query values before loading and presenting recipes", async () => {
    mocks.fetchRecipeCategories.mockResolvedValue({ items: [breakfast] });

    const element = await RecipeBrowsePage({
      searchParams: Promise.resolve({
        category: [" breakfast ", "ignored"],
        page: ["3", "9"],
        q: [" oats ", "ignored"],
        sort: ["title", "newest"],
        type: "versions",
      }),
    });
    const props = browserProps(element);

    expect(mocks.fetchRecipePage).toHaveBeenCalledWith({
      category: "breakfast",
      isVariant: true,
      page: 3,
      pageSize: 12,
      query: "oats",
      sort: "title",
    });
    expect(props).toMatchObject({
      categories: [breakfast],
      categoriesUnavailable: false,
      category: breakfast,
      categorySlug: "breakfast",
      data: recipePage,
      query: "oats",
      recipeType: "versions",
      sort: "title",
    });
  });

  it.each([
    { label: "missing", page: undefined },
    { label: "zero", page: "0" },
    { label: "negative", page: "-1" },
    { label: "fractional", page: "1.5" },
    { label: "too large", page: "1000001" },
    { label: "unsafe", page: "9007199254740992" },
  ])(
    "uses safe browse defaults for a $label page query",
    async ({ page }) => {
      mocks.fetchRecipeCategories.mockResolvedValue({ items: [] });

      const element = await RecipeBrowsePage({
        searchParams: Promise.resolve({
          page,
          q: "   ",
          sort: "popular",
          type: ["versions", "originals"],
        }),
      });
      const props = browserProps(element);

      expect(mocks.fetchRecipePage).toHaveBeenCalledWith({
        category: undefined,
        isVariant: undefined,
        page: 1,
        pageSize: 12,
        query: "",
        sort: "newest",
      });
      expect(props).toMatchObject({
        categoriesUnavailable: false,
        category: undefined,
        categorySlug: undefined,
        query: "",
        recipeType: undefined,
        sort: "newest",
      });
    },
  );

  it("uses the not-found boundary for an unknown category", async () => {
    mocks.fetchRecipeCategories.mockResolvedValue({ items: [breakfast] });

    await expect(
      RecipeBrowsePage({
        searchParams: Promise.resolve({ category: "midnight-snacks" }),
      }),
    ).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.fetchRecipePage).toHaveBeenCalledWith(
      expect.objectContaining({ category: "midnight-snacks" }),
    );
  });
});
