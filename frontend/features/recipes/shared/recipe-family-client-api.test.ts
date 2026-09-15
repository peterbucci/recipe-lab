import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RecipeDetail,
} from "./recipe-contracts";
import { fetchRecipeFamily } from "./recipe-family-client-api";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const LINEAGE_ID = "22222222-2222-4222-8222-222222222222";
const RECIPE_ID = "55555555-5555-4555-8555-555555555555";

const sourceRecipe: RecipeDetail = {
  adaptation_source: null,
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
  current_version: null,
  declared_change_reason: null,
  description: "The immutable public source.",
  difficulty: null,
  edition_number: 1,
  id: SOURCE_ID,
  is_current: true,
  ingredients: [],
  instructions: [],
  lineage_id: LINEAGE_ID,
  notes: null,
  parent: null,
  parent_version_id: null,
  previous_version_id: null,
  published_at: "2026-08-20T12:00:00Z",
  recipe_id: RECIPE_ID,
  relation_kind: "original",
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
  it("loads the exact source and its bounded history in order", async () => {
    const history = {
      adaptations: [],
      adaptations_truncated: false,
      current_version_id: SOURCE_ID,
      editions: [{
        adaptation_source_version_id: null,
        author: sourceRecipe.author,
        declared_change_reason: null,
        edition_number: 1,
        id: SOURCE_ID,
        is_current: true,
        previous_version_id: null,
        published_at: sourceRecipe.published_at,
        recipe_id: RECIPE_ID,
        relation_kind: "original",
        title: sourceRecipe.title,
      }],
      editions_truncated: false,
      recipe_id: RECIPE_ID,
      selected_version_id: SOURCE_ID,
    } as const;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(sourceRecipe))
      .mockResolvedValueOnce(
        Response.json(history),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRecipeFamily(SOURCE_ID, new AbortController().signal),
    ).resolves.toEqual({
      recipe: sourceRecipe,
      history,
      sourceVersionId: SOURCE_ID,
    });

    expect(fetchMock.mock.calls.map(([target]) => String(target))).toEqual([
      `/api/recipes/${SOURCE_ID}`,
      `/api/recipes/${SOURCE_ID}/history`,
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
      history: null,
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
