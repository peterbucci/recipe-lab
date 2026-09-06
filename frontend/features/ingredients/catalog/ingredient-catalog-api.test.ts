import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { searchCatalogIngredients } from "./ingredient-catalog-api";

const PECAN_ID = "33333333-3333-4333-8333-333333333333";


beforeEach(() => {
  document.cookie = "recipe_lab_csrf=test-csrf-token; path=/";
});

afterEach(() => {
  document.cookie = "recipe_lab_csrf=; max-age=0; path=/";
  vi.unstubAllGlobals();
});

describe("ingredient catalog API client", () => {
  it("searches a bounded page and validates the catalog response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: PECAN_ID,
              canonical_name: "Pecan",
              aliases: ["Pecan nut"],
            },
          ],
          page: 2,
          page_size: 20,
          total: 21,
          total_pages: 2,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchCatalogIngredients({ query: "  pecan & nut  ", page: 2 }),
    ).resolves.toMatchObject({ page: 2, total: 21 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ingredients?page=2&page_size=20&q=pecan+%26+nut",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
  });

  it("rejects malformed identities instead of exposing them to the picker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [{ id: "hidden-arbitrary-value", canonical_name: "Pecan", aliases: [] }],
            page: 1,
            page_size: 20,
            total: 1,
            total_pages: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(searchCatalogIngredients({ query: "pecan" })).rejects.toMatchObject({
      status: 502,
      code: "invalid_ingredient_catalog_response",
    });
  });


  it("hides ingredient-search backend messages and identifiers", async () => {
    const internalId = "99999999-9999-4999-8999-999999999999";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json(
        {
          error: {
            code: "catalog_search_unavailable",
            message: `Canonical UUID ${internalId} failed an operator policy check.`,
            issues: [],
          },
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );

    const error = await searchCatalogIngredients({ query: "pecan" }).catch(
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({
      status: 503,
      code: "catalog_search_unavailable",
      message: "The ingredient catalog could not be searched. Please try again.",
    });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /99999999|canonical|uuid|operator|policy/i,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps an unreadable successful search body to the validated response error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(searchCatalogIngredients({ query: "pecan" })).rejects.toMatchObject({
      code: "invalid_ingredient_catalog_response",
      status: 502,
    });
  });

});
