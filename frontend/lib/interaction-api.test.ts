import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InteractionApiError,
  type RecipeViewerState,
  setRecipeRating,
  setRecipeSaved,
} from "./interaction-api";

const viewerState: RecipeViewerState = {
  recipe_version_id: "29454eba-3a4e-5380-b48c-c49dc3697b17",
  user: {
    id: "1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9",
    display_name: "Demo Cook",
    identity_mode: "shared_demo",
  },
  saved: true,
  rating: 4,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("interaction API client", () => {
  it.each([
    [true, "PUT"],
    [false, "DELETE"],
  ] as const)("writes saved=%s with %s and returns canonical state", async (saved, method) => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.example.test/");
    const responseState = { ...viewerState, saved };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(responseState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(setRecipeSaved(viewerState.recipe_version_id, saved)).resolves.toEqual(
      responseState,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        `http://api.example.test/api/recipes/${viewerState.recipe_version_id}/save`,
      ),
      {
        method,
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("sends a bounded rating as JSON", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.example.test");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(viewerState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await setRecipeRating(viewerState.recipe_version_id, 4);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        `http://api.example.test/api/recipes/${viewerState.recipe_version_id}/rating`,
      ),
      {
        method: "PUT",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rating: 4 }),
      },
    );
  });

  it("preserves the API error envelope and uses a stable non-JSON fallback", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.example.test");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "demo_user_unavailable", message: "Demo mode is unavailable." },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response("upstream failure", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const documentedError = await setRecipeSaved(viewerState.recipe_version_id, true).catch(
      (reason: unknown) => reason,
    );
    expect(documentedError).toBeInstanceOf(InteractionApiError);
    expect(documentedError).toMatchObject({
      code: "demo_user_unavailable",
      message: "Demo mode is unavailable.",
      status: 503,
    });

    const fallbackError = await setRecipeSaved(viewerState.recipe_version_id, false).catch(
      (reason: unknown) => reason,
    );
    expect(fallbackError).toMatchObject({
      code: "interaction_api_error",
      message: "The recipe service could not update your demo activity.",
      status: 502,
    });
  });
});
