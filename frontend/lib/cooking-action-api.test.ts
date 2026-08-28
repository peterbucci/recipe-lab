import { afterEach, describe, expect, it, vi } from "vitest";

import {
  catalogActionTypeSummary,
  CookingActionApiError,
  fetchCookingActionTypes,
  parseCookingActionTypeResponse,
  type CatalogActionType,
} from "./cooking-action-api";

const mix: CatalogActionType = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  key: "mix",
  canonical_verb: "mix",
  active: true,
  provenance: "Reviewed cooking-action seed data.",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cooking action API", () => {
  it("fetches the bounded catalog without caching and strictly parses it", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test/");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [mix] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCookingActionTypes()).resolves.toEqual([mix]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://api.example.test/api/cooking-action-types?limit=100"),
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
  });

  it("rejects malformed and duplicate catalog identities", () => {
    expect(() =>
      parseCookingActionTypeResponse({
        items: [{ ...mix, key: "Mix things" }],
      }),
    ).toThrow("invalid cooking action response");
    expect(() =>
      parseCookingActionTypeResponse({ items: [mix, { ...mix, key: "fold" }] }),
    ).toThrow("invalid cooking action response");
    expect(() =>
      parseCookingActionTypeResponse({
        items: [mix, { ...mix, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
      }),
    ).toThrow("invalid cooking action response");
  });

  it("keeps provenance out of recipe-facing summaries", () => {
    expect(catalogActionTypeSummary(mix)).toEqual({
      id: mix.id,
      key: "mix",
      canonical_verb: "mix",
      active: true,
    });
  });

  it("preserves documented errors and hides non-JSON upstream bodies", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: "catalog_unavailable",
                message: "Try again shortly.",
              },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response("private gateway details", { status: 502 }),
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "internal_operator_policy_failure",
                message:
                  "Canonical action UUID 99999999-9999-4999-8999-999999999999 failed an operator policy.",
              },
            },
            { status: 503 },
          ),
        ),
    );

    await expect(fetchCookingActionTypes()).rejects.toMatchObject({
      code: "catalog_unavailable",
      message: "The cooking action service could not complete this request.",
      status: 503,
    });
    const error = await fetchCookingActionTypes().catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(CookingActionApiError);
    expect(error).toMatchObject({
      code: "cooking_action_api_error",
      message: "The cooking action service could not complete this request.",
      status: 502,
    });
    expect(String(error)).not.toContain("private gateway details");

    const hostileError = await fetchCookingActionTypes().catch(
      (reason: unknown) => reason,
    );
    expect(hostileError).toMatchObject({
      code: "cooking_action_api_error",
      message: "The cooking action service could not complete this request.",
      status: 503,
    });
    expect(
      `${String(hostileError)} ${JSON.stringify(hostileError)}`,
    ).not.toMatch(/99999999|canonical|uuid|operator|policy|internal_/i);
  });
});
