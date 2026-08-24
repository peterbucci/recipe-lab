import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "./auth-api";
import {
  IngredientCatalogApiError,
  searchCatalogIngredients,
  selectionForCatalogIngredient,
  submitMissingIngredientRequest,
} from "./ingredient-catalog-api";

const PECAN_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";

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

  it("preserves an exact curated alias as the selected display label", () => {
    expect(
      selectionForCatalogIngredient(
        {
          id: PECAN_ID,
          canonical_name: "Granulated sugar",
          aliases: ["Caster sugar", "White sugar"],
        },
        " white sugar ",
      ),
    ).toEqual({
      ingredientId: PECAN_ID,
      canonicalName: "Granulated sugar",
      displayName: "White sugar",
    });
  });

  it("submits a missing-item request separately with member protection", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: REQUEST_ID,
          proposed_name: "Dragon fruit",
          context: "Fresh pink fruit",
          status: "pending",
          created_at: "2026-08-24T18:00:00Z",
          reviewed_at: null,
          decision_reason: null,
          resolved_ingredient_id: null,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitMissingIngredientRequest({
        proposed_name: "Dragon fruit",
        context: "Fresh pink fruit",
      }),
    ).resolves.toMatchObject({ id: REQUEST_ID, status: "pending" });
    expect(fetchMock).toHaveBeenCalledWith("/api/ingredient-requests", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": "test-csrf-token",
      },
      body: JSON.stringify({
        proposed_name: "Dragon fruit",
        context: "Fresh pink fruit",
      }),
    });
  });

  it("preserves a bounded duplicate message from the standard error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "ingredient_request_conflict",
              message: "That ingredient already exists or has a pending request.",
              issues: [],
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      submitMissingIngredientRequest({ proposed_name: "Pecan", context: null }),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 409,
        code: "ingredient_request_conflict",
        message: "That ingredient already exists or has a pending request.",
      }),
    );
  });

  it("notifies the session provider when request authorization expires", async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "authentication_required", message: "Sign in again." },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      submitMissingIngredientRequest({ proposed_name: "Dragon fruit", context: null }),
    ).rejects.toBeInstanceOf(IngredientCatalogApiError);
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });
});
