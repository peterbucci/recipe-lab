import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "./auth-api";
import {
  fetchRecipeViewerState,
  InteractionApiError,
  recordRecipeView,
  type RecipeViewerState,
  setRecipeRating,
  setRecipeSaved,
} from "./interaction-api";

const IDEMPOTENCY_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const viewerState: RecipeViewerState = {
  recipe_version_id: "29454eba-3a4e-5380-b48c-c49dc3697b17",
  saved: true,
  rating: 4,
};

beforeEach(() => {
  document.cookie = "recipe_lab_csrf=test-csrf-token; path=/";
});

afterEach(() => {
  document.cookie = "recipe_lab_csrf=; max-age=0; path=/";
  vi.unstubAllGlobals();
});

describe("interaction API client", () => {
  it.each([
    [true, "PUT"],
    [false, "DELETE"],
  ] as const)("writes saved=%s with %s and returns canonical state", async (saved, method) => {
    const responseState = { ...viewerState, saved };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(responseState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      setRecipeSaved(viewerState.recipe_version_id, saved, IDEMPOTENCY_KEY),
    ).resolves.toEqual(
      responseState,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipes/${viewerState.recipe_version_id}/save`,
      {
        method,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Idempotency-Key": IDEMPOTENCY_KEY,
          "X-CSRF-Token": "test-csrf-token",
        },
        credentials: "same-origin",
      },
    );
  });

  it("sends a bounded rating as JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(viewerState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await setRecipeRating(viewerState.recipe_version_id, 4, IDEMPOTENCY_KEY);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipes/${viewerState.recipe_version_id}/rating`,
      {
        method: "PUT",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": IDEMPOTENCY_KEY,
          "X-CSRF-Token": "test-csrf-token",
        },
        body: JSON.stringify({ rating: 4 }),
        credentials: "same-origin",
      },
    );
  });

  it("records a view without sending user or free-form context", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      recordRecipeView(viewerState.recipe_version_id, IDEMPOTENCY_KEY),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipes/${viewerState.recipe_version_id}/view`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Idempotency-Key": IDEMPOTENCY_KEY,
          "X-CSRF-Token": "test-csrf-token",
        },
        credentials: "same-origin",
      },
    );
  });

  it("preserves the API error envelope and uses a stable non-JSON fallback", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "activity_unavailable", message: "Activity is unavailable." },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response("upstream failure", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const documentedError = await setRecipeSaved(
      viewerState.recipe_version_id,
      true,
      IDEMPOTENCY_KEY,
    ).catch((reason: unknown) => reason);
    expect(documentedError).toBeInstanceOf(InteractionApiError);
    expect(documentedError).toMatchObject({
      code: "activity_unavailable",
      message: "Activity is unavailable.",
      status: 503,
    });

    const fallbackError = await setRecipeSaved(
      viewerState.recipe_version_id,
      false,
      IDEMPOTENCY_KEY,
    ).catch((reason: unknown) => reason);
    expect(fallbackError).toMatchObject({
      code: "interaction_api_error",
      message: "The recipe service could not update your recipe activity.",
      status: 502,
    });
  });

  it("fetches nullable private state from the signed-in detail response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ viewer_state: viewerState }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRecipeViewerState(viewerState.recipe_version_id)).resolves.toEqual(
      viewerState,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipes/${viewerState.recipe_version_id}`,
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
  });

  it("rejects member state with an owner field instead of trusting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ viewer_state: { ...viewerState, user: { id: "other" } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(fetchRecipeViewerState(viewerState.recipe_version_id)).rejects.toMatchObject({
      code: "invalid_interaction_response",
      status: 502,
    });
  });

  it("rejects valid-shaped private state for a different recipe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            viewer_state: { ...viewerState, recipe_version_id: "different-recipe" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(fetchRecipeViewerState(viewerState.recipe_version_id)).rejects.toMatchObject({
      code: "invalid_interaction_response",
      status: 502,
    });
  });

  it("notifies the session provider when a member request is unauthorized", async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "authentication_required" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      setRecipeSaved(viewerState.recipe_version_id, true, IDEMPOTENCY_KEY),
    ).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });
});
