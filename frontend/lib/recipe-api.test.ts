import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RecipeApiError,
  fetchRecipe,
  fetchRecipePage,
  isRecipeVersionId,
  type RecipePage,
} from "./recipe-api";

const emptyPage: RecipePage = {
  items: [],
  page: 2,
  page_size: 12,
  total: 0,
  total_pages: 0,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("recipe API client", () => {
  it("recognizes canonical recipe version identifiers before requesting detail", () => {
    expect(isRecipeVersionId("29454eba-3a4e-5380-b48c-c49dc3697b17")).toBe(true);
    expect(isRecipeVersionId("not-a-recipe-id")).toBe(false);
    expect(isRecipeVersionId("29454eba3a4e5380b48cc49dc3697b17")).toBe(false);
  });

  it("encodes browse parameters and disables caching", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test/");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(emptyPage), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRecipePage({ page: 2, pageSize: 12, query: "carrot & pecan" }),
    ).resolves.toEqual(emptyPage);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "http://api.example.test/api/recipes?page=2&page_size=12&q=carrot+%26+pecan",
    );
    expect(options).toEqual({
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("maps a missing recipe to null", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(fetchRecipe("missing/id")).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://api.example.test/api/recipes/missing%2Fid"),
      expect.any(Object),
    );
  });

  it("preserves the documented API error without exposing response internals", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "validation_error", message: "The request parameters are invalid." },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await fetchRecipePage({ page: 1 }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RecipeApiError);
    expect(error).toMatchObject({
      code: "validation_error",
      message: "The request parameters are invalid.",
      status: 422,
    });
  });
});
