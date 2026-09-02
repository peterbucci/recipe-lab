import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeCategory, RecipePage } from "../../lib/recipe-api";
import RecipeBrowsePage from "./page";

const mocks = vi.hoisted(() => ({
  fetchRecipeCategories: vi.fn(),
  fetchRecipePage: vi.fn(),
}));

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
}

const recipePage: RecipePage = {
  items: [],
  page: 1,
  page_size: 12,
  total: 0,
  total_pages: 0,
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

});
