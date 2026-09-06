import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  browseIngredientCatalogReviewRequests,
  fetchIngredientCatalogReviewDetail,
  reviewIngredientCatalogRequest,
} from "./ingredient-request-review-api";

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
        body: JSON.stringify(input),
      }),
    ]);
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-CSRF-Token")).toBe("test-csrf-token");

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
