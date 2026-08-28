import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "./auth-api";
import {
  createRecipeDraft,
  discardRecipeDraft,
  parseRecipeDraftDetail,
  parseRecipeDraftPage,
  RecipeDraftApiError,
  updateRecipeDraft,
} from "./recipe-draft-api";

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";

const blankDetail = {
  id: DRAFT_ID,
  source_version_id: null,
  status: "active",
  revision: 1,
  title: "",
  description: null,
  servings: null,
  ingredients: [],
  instructions: [],
  created_at: "2026-08-25T12:00:00Z",
  updated_at: "2026-08-25T12:00:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "recipe_lab_csrf=; Max-Age=0; path=/";
});

describe("private recipe draft API", () => {
  it("accepts the server's intentionally incomplete blank draft", () => {
    expect(parseRecipeDraftDetail(blankDetail)).toMatchObject({
      id: DRAFT_ID,
      revision: 1,
      title: "",
      ingredients: [],
    });
  });

  it("rejects unordered or malformed private responses", () => {
    expect(() => parseRecipeDraftDetail({ ...blankDetail, revision: 0 })).toThrow(RecipeDraftApiError);
    expect(() => parseRecipeDraftPage({
      items: [{
        id: DRAFT_ID,
        source_version_id: null,
        status: "active",
        revision: 1,
        title: "Recipe",
        ingredient_count: -1,
        instruction_count: 0,
        created_at: blankDetail.created_at,
        updated_at: blankDetail.updated_at,
      }],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    })).toThrow(RecipeDraftApiError);
  });

  it("creates an original draft with CSRF protection", async () => {
    document.cookie = "recipe_lab_csrf=test-token; path=/";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(blankDetail, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createRecipeDraft(null)).resolves.toMatchObject({ id: DRAFT_ID });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recipe-drafts",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({ source_version_id: null }),
        headers: expect.objectContaining({
          "X-CSRF-Token": "test-token",
        }),
      }),
    );
  });

  it("announces an expired session while retaining the typed API error", async () => {
    document.cookie = "recipe_lab_csrf=test-token; path=/";
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "authentication_required",
              message: "Private provider detail",
              issues: [],
            },
          },
          { status: 401 },
        ),
      ),
    );

    await expect(
      updateRecipeDraft(
        DRAFT_ID,
        {
          revision: 1,
          title: "Unsaved title",
          description: null,
          servings: null,
          ingredients: [],
          instructions: [],
        },
        "save-key",
      ),
    ).rejects.toMatchObject({
      code: "authentication_required",
      status: 401,
      message: "Your session expired. Your private draft is still here; sign in again to continue.",
    });
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it("keeps save and discard failures free of backend messages and identifiers", async () => {
    document.cookie = "recipe_lab_csrf=test-token; path=/";
    const internalId = "99999999-9999-4999-8999-999999999999";
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "invalid_recipe_draft",
                message: `Canonical ingredient occurrence ${internalId} failed validation.`,
                issues: [
                  {
                    location: ["body", "ingredients", 0, "selection", "ingredient_id"],
                    message: `Ingredient UUID ${internalId} is not canonical.`,
                    type: "internal_catalog_policy_failure",
                  },
                  {
                    location: ["body", internalId],
                    message: "Private operator detail",
                    type: "internal_error",
                  },
                ],
              },
            },
            { status: 422 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "recipe_draft_not_found",
                message: `Recipe draft ${internalId} was not found.`,
                issues: [],
              },
            },
            { status: 404 },
          ),
        ),
    );

    const saveError = await updateRecipeDraft(
      DRAFT_ID,
      {
        revision: 1,
        title: "Unsaved title",
        description: null,
        servings: null,
        ingredients: [],
        instructions: [],
      },
      "save-key",
    ).catch((reason: unknown) => reason);
    expect(saveError).toMatchObject({
      status: 422,
      code: "invalid_recipe_draft",
      message: "Some draft fields need attention. Review them and try again.",
      issues: [
        {
          location: ["body", "ingredients", 0, "selection", "ingredient_id"],
          message: "Review this ingredient.",
          type: "validation_error",
        },
      ],
    });
    expect(`${String(saveError)} ${JSON.stringify(saveError)}`).not.toContain(internalId);
    expect(`${String(saveError)} ${JSON.stringify(saveError)}`).not.toMatch(
      /canonical|occurrence|operator|policy/i,
    );

    const discardError = await discardRecipeDraft(DRAFT_ID, 1, "discard-key").catch(
      (reason: unknown) => reason,
    );
    expect(discardError).toMatchObject({
      status: 404,
      code: "recipe_draft_not_found",
      message: "This private draft is no longer available.",
    });
    expect(`${String(discardError)} ${JSON.stringify(discardError)}`).not.toContain(internalId);
  });
});
