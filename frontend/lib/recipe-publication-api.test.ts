import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "./auth-api";
import {
  parseRecipeDraftPublication,
  publishRecipeDraft,
  RecipePublicationApiError,
  type RecipeDraftPublishRequest,
} from "./recipe-publication-api";

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const RECIPE_ID = "22222222-2222-4222-8222-222222222222";
const PREFLIGHT_ID = "33333333-3333-4333-8333-333333333333";
const ACTION_ID = "44444444-4444-4444-8444-444444444444";
const LOCATION = `/recipes/${RECIPE_ID}`;
const request: RecipeDraftPublishRequest = {
  revision: 4,
  community_rules_accepted: true,
  content_rights_confirmed: true,
  duplicate_review: {
    preflight_id: PREFLIGHT_ID,
    policy_version: "recipe-duplicate-preflight-policy-v1",
    result_digest: "a".repeat(64),
    decision: "continue",
  },
};

beforeEach(() => {
  document.cookie = "recipe_lab_csrf=test-token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "recipe_lab_csrf=; Max-Age=0; path=/";
});

describe("recipe publication API", () => {
  it("requires matching stable body and Location header", () => {
    expect(
      parseRecipeDraftPublication(
        { recipe_version_id: RECIPE_ID, location: LOCATION },
        LOCATION,
      ),
    ).toEqual({ recipe_version_id: RECIPE_ID, location: LOCATION });
    expect(() =>
      parseRecipeDraftPublication(
        { recipe_version_id: RECIPE_ID, location: LOCATION },
        `/recipes/${DRAFT_ID}`,
      ),
    ).toThrow(RecipePublicationApiError);
    expect(() =>
      parseRecipeDraftPublication(
        { recipe_version_id: RECIPE_ID, location: LOCATION, author_email: "private@example.test" },
        LOCATION,
      ),
    ).toThrow(RecipePublicationApiError);
  });

  it("publishes one saved revision with CSRF and idempotency evidence", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ recipe_version_id: RECIPE_ID, location: LOCATION }), {
        status: 201,
        headers: { "Content-Type": "application/json", Location: LOCATION },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishRecipeDraft(DRAFT_ID, request, ACTION_ID)).resolves.toEqual({
      recipe_version_id: RECIPE_ID,
      location: LOCATION,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipe-drafts/${DRAFT_ID}/publish`,
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify(request),
        headers: expect.objectContaining({
          "Idempotency-Key": ACTION_ID,
          "X-CSRF-Token": "test-token",
        }),
      }),
    );
  });

  it("keeps failures bounded and announces an expired session", async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        error: {
          code: "authentication_required",
          message: "Private upstream identity",
          issues: [],
        },
      }, { status: 401 }),
    ));

    const error = await publishRecipeDraft(DRAFT_ID, request, ACTION_ID).catch(
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({
      status: 401,
      code: "authentication_required",
      message: "Your session expired. Your draft is still here; sign in again before publishing.",
    });
    expect(String(error)).not.toContain("Private upstream identity");
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it("uses a stable draft-preserving conflict when a fork source is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        error: {
          code: "recipe_fork_source_unavailable",
          message: "Source title and private operator detail",
          issues: [],
        },
      }, { status: 409 }),
    ));

    const error = await publishRecipeDraft(DRAFT_ID, request, ACTION_ID).catch(
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({
      status: 409,
      code: "recipe_fork_source_unavailable",
      message: "The public source recipe is no longer available. Your private draft is unchanged.",
    });
    expect(String(error)).not.toContain("private operator detail");
  });
});
