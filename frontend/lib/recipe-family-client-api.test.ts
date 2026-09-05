import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRecipeCardSummary } from "../tests/support/builders/recipe";
import type { RecipeDetail } from "./recipe-api";
import { fetchRecipeFamily } from "./recipe-family-client-api";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const LINEAGE_ID = "22222222-2222-4222-8222-222222222222";

const sourceRecipe: RecipeDetail = {
  active_time_minutes: null,
  author: {
    display_name: "Source Cook",
    handle: "source-cook",
    id: "33333333-3333-4333-8333-333333333333",
  },
  average_rating: null,
  categories: [],
  children: [],
  created_at: "2026-08-20T12:00:00Z",
  description: "The immutable public source.",
  difficulty: null,
  id: SOURCE_ID,
  ingredients: [],
  instructions: [],
  lineage_id: LINEAGE_ID,
  notes: null,
  parent: null,
  parent_version_id: null,
  published_at: "2026-08-20T12:00:00Z",
  rating_count: 0,
  save_count: 0,
  servings: "4.00",
  title: "Source recipe",
  total_time_minutes: null,
  version_number: 1,
  viewer_state: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recipe family client API", () => {
  it("loads the encoded source and its bounded lineage page in order", async () => {
    const familyRecipe = buildRecipeCardSummary({
      id: "44444444-4444-4444-8444-444444444444",
      lineage_id: LINEAGE_ID,
      title: "Another family recipe",
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(sourceRecipe))
      .mockResolvedValueOnce(
        Response.json({
          items: [familyRecipe],
          page: 1,
          page_size: 100,
          total: 1,
          total_pages: 1,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRecipeFamily(`${SOURCE_ID}/encoded`, new AbortController().signal),
    ).resolves.toEqual({
      recipe: sourceRecipe,
      sourceVersionId: `${SOURCE_ID}/encoded`,
      versions: [familyRecipe],
    });

    expect(fetchMock.mock.calls.map(([target]) => String(target))).toEqual([
      `/api/recipes/${SOURCE_ID}%2Fencoded`,
      `/api/recipes?lineage_id=${LINEAGE_ID}&page=1&page_size=100&sort=title`,
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
        redirect: "error",
      });
      expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
    }
  });

  it("keeps the source usable when the optional family list is unavailable", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(sourceRecipe))
      .mockResolvedValueOnce(
        new Response("private upstream detail", { status: 503 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRecipeFamily(SOURCE_ID, new AbortController().signal),
    ).resolves.toEqual({
      recipe: sourceRecipe,
      sourceVersionId: SOURCE_ID,
      versions: [],
    });
  });

  it("replaces a required-source failure with stable feature copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("private upstream detail", { status: 503 }),
        ),
    );

    await expect(
      fetchRecipeFamily(SOURCE_ID, new AbortController().signal),
    ).rejects.toThrow("Recipe family unavailable");
  });

  it("preserves caller cancellation instead of converting it to a feature failure", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException("aborted", "AbortError")),
    );

    const error = await fetchRecipeFamily(SOURCE_ID, controller.signal).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: "AbortError" });
  });
});
