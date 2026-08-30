import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "./auth-api";
import {
  browseIngredientCatalogReviewRequests,
  browseMyIngredientRequests,
  fetchIngredientCatalogReviewDetail,
  fetchMyIngredientRequest,
  IngredientCatalogApiError,
  reviewIngredientCatalogRequest,
  searchCatalogIngredients,
  selectionForCatalogIngredient,
  submitMissingIngredientRequest,
} from "./ingredient-catalog-api";

const PECAN_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const REQUESTER_ID = "77777777-7777-4777-8777-777777777777";
const REVIEWER_ID = "88888888-8888-4888-8888-888888888888";

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

  it("maps a duplicate request to stable member-facing copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "ingredient_request_conflict",
              message:
                "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
              issues: [],
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await submitMissingIngredientRequest({
      proposed_name: "Pecan",
      context: null,
    }).catch((reason: unknown) => reason);
    expect(error).toEqual(
      expect.objectContaining({
        status: 409,
        code: "ingredient_request_conflict",
        message: "That ingredient is already approved or has a pending request.",
      }),
    );
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /99999999|canonical|uuid|operator|policy/i,
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

  it("hides ingredient-search backend messages and identifiers", async () => {
    const internalId = "99999999-9999-4999-8999-999999999999";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
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
      ),
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
  });

  it("loads a member's filtered request history and its trusted resolution detail", async () => {
    const approvedRequest = {
      id: REQUEST_ID,
      proposed_name: "Dragon fruit",
      context: "Fresh pink fruit",
      status: "approved",
      created_at: "2026-08-24T18:00:00Z",
      reviewed_at: "2026-08-24T19:00:00Z",
      decision_reason: "Added as pitaya.",
      resolved_ingredient_id: PECAN_ID,
      resolved_ingredient: {
        id: PECAN_ID,
        canonical_name: "Pitaya",
        aliases: ["Dragon fruit"],
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [approvedRequest],
          page: 2,
          page_size: 10,
          total: 11,
          total_pages: 2,
        }),
      )
      .mockResolvedValueOnce(Response.json(approvedRequest));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browseMyIngredientRequests({
        status: "approved",
        reviewedOnly: true,
        page: 2,
        pageSize: 10,
        query: "  dragon & fruit  ",
      }),
    ).resolves.toMatchObject({
      page: 2,
      items: [{ resolved_ingredient: { canonical_name: "Pitaya" } }],
    });
    await expect(fetchMyIngredientRequest(REQUEST_ID)).resolves.toMatchObject({
      id: REQUEST_ID,
      status: "approved",
      resolved_ingredient_id: PECAN_ID,
    });

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/ingredient-requests/mine?page=2&page_size=10&status=approved&reviewed_only=true&q=dragon+%26+fruit",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      `/api/ingredient-requests/${REQUEST_ID}`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    ]);
  });

  it("keeps history authorization errors local so an unsaved editor stays mounted", async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () =>
        new Response(
          JSON.stringify({
            error: { code: "authentication_required", message: "Sign in again." },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(browseMyIngredientRequests()).rejects.toMatchObject({
      status: 401,
      code: "authentication_required",
    });
    await expect(fetchMyIngredientRequest(REQUEST_ID)).rejects.toMatchObject({
      status: 401,
      code: "authentication_required",
    });
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it.each([
    {
      name: "pending request with a catalog resolution",
      value: {
        status: "pending",
        resolved_ingredient_id: PECAN_ID,
        resolved_ingredient: {
          id: PECAN_ID,
          canonical_name: "Pitaya",
          aliases: [],
        },
      },
    },
    {
      name: "approved request without a catalog resolution",
      value: {
        status: "approved",
        resolved_ingredient_id: null,
        resolved_ingredient: null,
      },
    },
    {
      name: "resolution whose identity does not match",
      value: {
        status: "duplicate",
        resolved_ingredient_id: REQUESTER_ID,
        resolved_ingredient: {
          id: PECAN_ID,
          canonical_name: "Pitaya",
          aliases: [],
        },
      },
    },
  ])("rejects a $name", async ({ value }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          id: REQUEST_ID,
          proposed_name: "Dragon fruit",
          context: null,
          created_at: "2026-08-24T18:00:00Z",
          reviewed_at: null,
          decision_reason: null,
          ...value,
        }),
      ),
    );

    await expect(fetchMyIngredientRequest(REQUEST_ID)).rejects.toMatchObject({
      status: 502,
      code: "invalid_ingredient_request_response",
    });
  });
});

describe("ingredient catalog curator API client", () => {
  const pendingReview = {
    id: REQUEST_ID,
    proposed_name: "Dragon fruit",
    context: "Fresh pink fruit",
    status: "pending",
    created_at: "2026-08-24T18:00:00Z",
    updated_at: "2026-08-24T18:00:00Z",
    reviewed_at: null,
    decision_reason: null,
    resolved_ingredient_id: null,
    requester_user_id: REQUESTER_ID,
    reviewer_user_id: null,
    duplicate_of_request_id: null,
    approved_canonical_name: null,
    approved_aliases: null,
    approval_provenance: null,
  };

  it("loads the protected queue and bounded review detail", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [pendingReview],
          page: 2,
          page_size: 20,
          total: 21,
          total_pages: 2,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ...pendingReview,
          requester: {
            id: REQUESTER_ID,
            handle: "alice",
            display_name: "Alice Cook",
          },
          catalog_candidates: [
            { id: PECAN_ID, canonical_name: "Pitaya", aliases: ["Dragon fruit"] },
          ],
          request_candidates: [
            {
              id: "99999999-9999-4999-8999-999999999999",
              proposed_name: "Red pitaya",
              status: "approved",
              created_at: "2026-08-23T18:00:00Z",
              resolved_ingredient_id: PECAN_ID,
              approved_canonical_name: "Pitaya",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browseIngredientCatalogReviewRequests({
        status: "pending",
        page: 2,
        query: "  pitaya & fruit  ",
      }),
    ).resolves.toMatchObject({ page: 2, total: 21, items: [{ updated_at: pendingReview.updated_at }] });
    await expect(fetchIngredientCatalogReviewDetail(REQUEST_ID)).resolves.toMatchObject({
      requester: { handle: "alice" },
      catalog_candidates: [{ canonical_name: "Pitaya" }],
      request_candidates: [{ status: "approved" }],
    });

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/ingredient-requests?status=pending&page=2&page_size=20&q=pitaya+%26+fruit",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      `/api/ingredient-requests/${REQUEST_ID}/review`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    ]);
  });

  it("submits a CSRF-protected curator decision and preserves structured conflicts", async () => {
    const approved = {
      ...pendingReview,
      status: "approved",
      updated_at: "2026-08-24T18:05:00Z",
      reviewed_at: "2026-08-24T18:05:00Z",
      decision_reason: "Distinct ingredient.",
      resolved_ingredient_id: PECAN_ID,
      reviewer_user_id: REVIEWER_ID,
      approved_canonical_name: "Dragon fruit",
      approved_aliases: ["Pitaya"],
      approval_provenance: "Reviewed culinary reference.",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(approved))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "ingredient_request_already_reviewed",
              message: "This request has already received a decision.",
              issues: [
                {
                  location: ["body", "reason"],
                  message: "Review the current request before retrying.",
                  type: "value_error",
                },
              ],
            },
          },
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      decision: "approve" as const,
      canonical_name: "Dragon fruit",
      aliases: ["Pitaya"],
      reason: "Distinct ingredient.",
      provenance: "Reviewed culinary reference.",
    };
    await expect(reviewIngredientCatalogRequest(REQUEST_ID, input)).resolves.toMatchObject({
      status: "approved",
      approved_aliases: ["Pitaya"],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/ingredient-requests/${REQUEST_ID}/review`,
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": "test-csrf-token",
        },
        body: JSON.stringify(input),
      }),
    ]);

    await expect(
      reviewIngredientCatalogRequest(REQUEST_ID, {
        decision: "reject",
        reason: "Too late.",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ingredient_request_already_reviewed",
      issues: [{ location: ["body", "reason"] }],
    });
  });

  it("rejects a review queue item without its concurrency timestamp", async () => {
    const malformed: Record<string, unknown> = { ...pendingReview };
    delete malformed.updated_at;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ items: [malformed], page: 1, page_size: 20, total: 1, total_pages: 1 }),
      ),
    );

    await expect(browseIngredientCatalogReviewRequests()).rejects.toMatchObject({
      status: 502,
      code: "invalid_ingredient_review_response",
    });
  });
});
