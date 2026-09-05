import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "./auth-api";
import {
  clearRecipeRating,
  fetchRecipeViewerState,
  fetchRecipeViewerStates,
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
  ] as const)(
    "writes saved=%s with %s and returns canonical state",
    async (saved, method) => {
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
      ).resolves.toEqual(responseState);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [target, init] = fetchMock.mock.calls[0];
      expect(target).toBe(
        `/api/recipes/${viewerState.recipe_version_id}/save`,
      );
      expect(init).toMatchObject({
        cache: "no-store",
        credentials: "same-origin",
        method,
        redirect: "error",
      });
      const headers = new Headers(init?.headers);
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("Idempotency-Key")).toBe(IDEMPOTENCY_KEY);
      expect(headers.get("X-CSRF-Token")).toBe("test-csrf-token");
    },
  );

  it("sends a bounded rating as JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(viewerState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await setRecipeRating(viewerState.recipe_version_id, 4, IDEMPOTENCY_KEY);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe(
      `/api/recipes/${viewerState.recipe_version_id}/rating`,
    );
    expect(init).toMatchObject({
      body: JSON.stringify({ rating: 4 }),
      cache: "no-store",
      credentials: "same-origin",
      method: "PUT",
      redirect: "error",
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe(IDEMPOTENCY_KEY);
    expect(headers.get("X-CSRF-Token")).toBe("test-csrf-token");
  });

  it("removes a rating with the same protected interaction contract", async () => {
    const clearedState = { ...viewerState, rating: null };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(clearedState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      clearRecipeRating(viewerState.recipe_version_id, IDEMPOTENCY_KEY),
    ).resolves.toEqual(clearedState);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe(
      `/api/recipes/${viewerState.recipe_version_id}/rating`,
    );
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      method: "DELETE",
      redirect: "error",
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe(IDEMPOTENCY_KEY);
    expect(headers.get("X-CSRF-Token")).toBe("test-csrf-token");
  });

  it("records a view without sending user or free-form context", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      recordRecipeView(viewerState.recipe_version_id, IDEMPOTENCY_KEY),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe(
      `/api/recipes/${viewerState.recipe_version_id}/view`,
    );
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      method: "POST",
      redirect: "error",
    });
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe(IDEMPOTENCY_KEY);
    expect(headers.get("X-CSRF-Token")).toBe("test-csrf-token");
  });

  it("preserves the API error envelope and uses a stable non-JSON fallback", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "activity_unavailable",
              message: "Activity is unavailable.",
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response("upstream failure", { status: 502 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "internal_operator_policy_failure",
              message:
                "Canonical recipe UUID 99999999-9999-4999-8999-999999999999 failed an operator policy.",
            },
          },
          { status: 503 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const documentedError = await setRecipeSaved(
      viewerState.recipe_version_id,
      true,
      IDEMPOTENCY_KEY,
    ).catch((reason: unknown) => reason);
    expect(documentedError).toBeInstanceOf(InteractionApiError);
    expect(documentedError).toMatchObject({
      code: "activity_unavailable",
      message: "The recipe service could not update your recipe activity.",
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

    const hostileError = await setRecipeSaved(
      viewerState.recipe_version_id,
      true,
      IDEMPOTENCY_KEY,
    ).catch((reason: unknown) => reason);
    expect(hostileError).toMatchObject({
      code: "interaction_api_error",
      message: "The recipe service could not update your recipe activity.",
      status: 503,
    });
    expect(
      `${String(hostileError)} ${JSON.stringify(hostileError)}`,
    ).not.toMatch(/99999999|canonical|uuid|operator|policy|internal_/i);
  });

  it("fetches nullable private state from the signed-in detail response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ viewer_state: viewerState }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRecipeViewerState(viewerState.recipe_version_id),
    ).resolves.toEqual(viewerState);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipes/${viewerState.recipe_version_id}`,
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
  });

  it("leaves transient viewer-state recovery to the calling UI", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "activity_unavailable" } },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ viewer_state: viewerState }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRecipeViewerState(viewerState.recipe_version_id),
    ).rejects.toMatchObject({
      code: "activity_unavailable",
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves caller aborts for viewer-state effects", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_target, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchRecipeViewerState(
      viewerState.recipe_version_id,
      controller.signal,
    );
    controller.abort(new DOMException("Unmounted", "AbortError"));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("loads ordered private state for multiple recipe cards in one request", async () => {
    const secondState: RecipeViewerState = {
      recipe_version_id: "39454eba-3a4e-5380-b48c-c49dc3697b17",
      saved: false,
      rating: null,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [viewerState, secondState] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRecipeViewerStates([
        viewerState.recipe_version_id,
        secondState.recipe_version_id,
        viewerState.recipe_version_id,
      ]),
    ).resolves.toEqual([viewerState, secondState]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipes/viewer-states?recipe_version_id=${viewerState.recipe_version_id}&recipe_version_id=${secondState.recipe_version_id}`,
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
  });

  it("rejects a card-state batch that does not match the requested order", async () => {
    const secondState: RecipeViewerState = {
      recipe_version_id: "39454eba-3a4e-5380-b48c-c49dc3697b17",
      saved: false,
      rating: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ items: [secondState, viewerState] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      fetchRecipeViewerStates([
        viewerState.recipe_version_id,
        secondState.recipe_version_id,
      ]),
    ).rejects.toMatchObject({
      code: "invalid_interaction_response",
      status: 502,
    });
  });

  it("rejects member state with an owner field instead of trusting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            viewer_state: { ...viewerState, user: { id: "other" } },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      fetchRecipeViewerState(viewerState.recipe_version_id),
    ).rejects.toMatchObject({
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
            viewer_state: {
              ...viewerState,
              recipe_version_id: "different-recipe",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      fetchRecipeViewerState(viewerState.recipe_version_id),
    ).rejects.toMatchObject({
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
        new Response(
          JSON.stringify({ error: { code: "authentication_required" } }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      setRecipeSaved(viewerState.recipe_version_id, true, IDEMPOTENCY_KEY),
    ).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });
});
