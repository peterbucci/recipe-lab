import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "../../../shared/api/browser-session";
import { IngredientCatalogApiError } from "../ingredient-api-error";
import {
  browseMyIngredientRequests,
  submitMissingIngredientRequest,
} from "./ingredient-request-api";

const PECAN_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const REQUESTER_ID = "77777777-7777-4777-8777-777777777777";


beforeEach(() => {
  document.cookie = "recipe_lab_csrf=test-csrf-token; path=/";
});

afterEach(() => {
  document.cookie = "recipe_lab_csrf=; max-age=0; path=/";
  vi.unstubAllGlobals();
});

describe("member ingredient request API client", () => {
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
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ingredient-requests",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({
          proposed_name: "Dragon fruit",
          context: "Fresh pink fruit",
        }),
      }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-CSRF-Token")).toBe("test-csrf-token");
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


  it("loads a member's filtered request history with its catalog resolutions", async () => {
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        items: [approvedRequest],
        page: 2,
        page_size: 10,
        total: 11,
        total_pages: 2,
      }),
    );
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
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/ingredient-requests/mine?page=2&page_size=10&status=approved&reviewed_only=true&q=dragon+%26+fruit",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
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
          items: [
            {
              id: REQUEST_ID,
              proposed_name: "Dragon fruit",
              context: null,
              created_at: "2026-08-24T18:00:00Z",
              reviewed_at: null,
              decision_reason: null,
              ...value,
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          total_pages: 1,
        }),
      ),
    );

    await expect(browseMyIngredientRequests()).rejects.toMatchObject({
      status: 502,
      code: "invalid_ingredient_request_response",
    });
  });
});
