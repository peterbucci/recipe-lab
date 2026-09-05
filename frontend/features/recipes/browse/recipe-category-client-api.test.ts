import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchActiveRecipeCategories,
  RecipeCategoryApiError,
} from "./recipe-category-client-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authoring recipe category API", () => {
  it("loads and validates the active curated vocabulary in fixed response order", async () => {
    const payload = {
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Quick & easy",
          slug: "quick-easy",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Dinner",
          slug: "dinner",
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchActiveRecipeCategories()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recipe-categories",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
        redirect: "error",
      }),
    );
  });

  it("rejects malformed or duplicate vocabulary entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          items: [
            { id: "free-text", name: "Injected", slug: "injected" },
          ],
        }),
      ),
    );

    await expect(fetchActiveRecipeCategories()).rejects.toMatchObject({
      code: "invalid_recipe_category_response",
      status: 502,
    } satisfies Partial<RecipeCategoryApiError>);
  });
});

