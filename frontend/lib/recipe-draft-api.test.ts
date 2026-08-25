import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRecipeDraft,
  parseRecipeDraftDetail,
  parseRecipeDraftPage,
  RecipeDraftApiError,
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
});
