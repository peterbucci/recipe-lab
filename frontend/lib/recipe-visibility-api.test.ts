import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "./auth-api";
import {
  parseRecipeVisibilityUpdate,
  RecipeVisibilityApiError,
  updateRecipeVisibility,
} from "./recipe-visibility-api";

const RECIPE_ID = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  vi.unstubAllGlobals();
});

describe("recipe visibility API", () => {
  it("sends a CSRF-protected idempotent visibility replacement and validates its response", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const payload = {
      recipe_version_id: RECIPE_ID,
      state: "author_withdrawn",
      updated_at: "2026-08-26T12:00:00Z",
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateRecipeVisibility(RECIPE_ID, "author_withdrawn")).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipes/${RECIPE_ID}/visibility`,
      {
        method: "PUT",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-value",
        },
        body: JSON.stringify({ state: "author_withdrawn" }),
      },
    );
  });

  it("rejects undocumented states and extra response fields", () => {
    expect(() =>
      parseRecipeVisibilityUpdate({
        recipe_version_id: RECIPE_ID,
        state: "private",
        updated_at: "2026-08-26T12:00:00Z",
      }),
    ).toThrow(RecipeVisibilityApiError);
    expect(() =>
      parseRecipeVisibilityUpdate({
        recipe_version_id: RECIPE_ID,
        state: "published",
        updated_at: "2026-08-26T12:00:00Z",
        moderation_note: "must not cross this boundary",
      }),
    ).toThrow(RecipeVisibilityApiError);
  });

  it("uses stable opaque ownership and moderation conflict errors", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            { error: { code: "recipe_not_found", message: "private backend detail" } },
            { status: 404 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            { error: { code: "moderation_hidden", message: "private moderation detail" } },
            { status: 409 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "visibility_service_unavailable",
                message:
                  "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
              },
            },
            { status: 503 },
          ),
        ),
    );

    await expect(updateRecipeVisibility(RECIPE_ID, "author_withdrawn")).rejects.toMatchObject({
      status: 404,
      message: "This recipe is no longer available in your account.",
    });
    await expect(updateRecipeVisibility(RECIPE_ID, "published")).rejects.toMatchObject({
      status: 409,
      message: "This recipe’s visibility changed. Refresh your recipes and try again.",
    });
    const unavailable = await updateRecipeVisibility(RECIPE_ID, "published").catch(
      (reason: unknown) => reason,
    );
    expect(unavailable).toMatchObject({
      status: 503,
      code: "visibility_service_unavailable",
      message: "Recipe Lab could not change this recipe’s public visibility. Try again.",
    });
    expect(`${String(unavailable)} ${JSON.stringify(unavailable)}`).not.toMatch(
      /99999999|canonical|uuid|operator|policy/i,
    );
  });
});
