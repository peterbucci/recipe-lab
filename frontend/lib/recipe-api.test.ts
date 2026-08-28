import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RecipeApiError,
  fetchRecipe,
  fetchRecipeDiff,
  fetchRecipePage,
  isRecipeVersionId,
  type RecipeDiff,
  type RecipePage,
} from "./recipe-api";

const emptyPage: RecipePage = {
  items: [],
  page: 2,
  page_size: 12,
  total: 0,
  total_pages: 0,
};

const noChangeDiff: RecipeDiff = {
  lineage_id: "33333333-3333-4333-8333-333333333333",
  base_version: {
    id: "11111111-1111-4111-8111-111111111111",
    version_number: 1,
    title: "Carrot Walnut Snack Cake",
    author: {
      id: "cook-one",
      handle: "first-cook",
      display_name: "First Cook",
    },
  },
  target_version: {
    id: "22222222-2222-4222-8222-222222222222",
    version_number: 2,
    title: "Copied Carrot Walnut Snack Cake",
    author: {
      id: "cook-two",
      handle: "second-cook",
      display_name: "Second Cook",
    },
  },
  metadata_changes: [],
  ingredients: { added: [], removed: [], replaced: [], modified: [] },
  ingredient_context: { base: [], target: [] },
  instructions: { added: [], removed: [], modified: [] },
  has_changes: false,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("recipe API client", () => {
  it("recognizes canonical recipe version identifiers before requesting detail", () => {
    expect(isRecipeVersionId("29454eba-3a4e-5380-b48c-c49dc3697b17")).toBe(
      true,
    );
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
      fetchRecipePage({
        isVariant: true,
        page: 2,
        pageSize: 12,
        query: "carrot & pecan",
      }),
    ).resolves.toEqual(emptyPage);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "http://api.example.test/api/recipes?page=2&page_size=12&q=carrot+%26+pecan&is_variant=true",
    );
    expect(options).toEqual({
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("sends an explicit false variant filter when browsing original recipes", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(emptyPage), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchRecipePage({ isVariant: false });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "http://api.example.test/api/recipes?page=1&page_size=12&is_variant=false",
    );
  });

  it("omits the variant filter when browsing all recipes", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(emptyPage), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchRecipePage({ isVariant: undefined });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "http://api.example.test/api/recipes?page=1&page_size=12",
    );
  });

  it("maps a missing recipe to null", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 404 })),
    );

    await expect(fetchRecipe("missing/id")).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://api.example.test/api/recipes/missing%2Fid"),
      expect.any(Object),
    );
  });

  it("fetches a parent diff from the encoded route without caching", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test/");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(noChangeDiff), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRecipeDiff("variant/id?draft=true")).resolves.toEqual(
      noChangeDiff,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "http://api.example.test/api/recipes/variant%2Fid%3Fdraft%3Dtrue/diff",
      ),
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("maps a missing recipe comparison to null", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRecipeDiff("missing-comparison")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves a documented comparison error for the compare route", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "recipe_has_no_parent",
              message: "This recipe version has no parent to compare.",
              issues: [],
            },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await fetchRecipeDiff(noChangeDiff.base_version.id).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(RecipeApiError);
    expect(error).toMatchObject({
      code: "recipe_has_no_parent",
      message: "Review the recipe request and try again.",
      status: 422,
    });
  });

  it("uses a safe fallback for a non-JSON comparison failure", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("private upstream details", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const error = await fetchRecipeDiff(noChangeDiff.target_version.id).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(RecipeApiError);
    expect(error).toMatchObject({
      code: "recipe_api_error",
      message: "The recipe service could not complete this request.",
      status: 503,
    });
    expect(String(error)).not.toContain("private upstream details");
  });

  it("preserves documented codes without exposing response internals", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "validation_error",
              message: "The request parameters are invalid.",
            },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await fetchRecipePage({ page: 1 }).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(RecipeApiError);
    expect(error).toMatchObject({
      code: "validation_error",
      message: "Review the recipe request and try again.",
      status: 422,
    });
  });

  it("drops hostile internal recipe error codes and messages", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    const internalId = "99999999-9999-4999-8999-999999999999";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "internal_operator_policy_failure",
              message: `Canonical recipe UUID ${internalId} failed an operator policy.`,
            },
          },
          { status: 503 },
        ),
      ),
    );

    const error = await fetchRecipePage({ page: 1 }).catch(
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({
      code: "recipe_api_error",
      message: "The recipe service could not complete this request.",
      status: 503,
    });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /99999999|canonical|uuid|operator|policy|internal_/i,
    );
  });
});
