import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "../../../shared/api/browser-session";
import { fetchMyRecipeLibrary, fetchSavedRecipeLibrary } from "./recipe-library-api";
import { RecipeLibraryApiError } from "../shared/recipe-library-error";

const COOK_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_COOK_ID = "22222222-2222-4222-8222-222222222222";
const RECIPE_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_ID = "44444444-4444-4444-8444-444444444444";
const LINEAGE_ID = "55555555-5555-4555-8555-555555555555";
const DRAFT_ID = "66666666-6666-4666-8666-666666666666";
const CATEGORY_ID = "77777777-7777-4777-8777-777777777777";
const ORIGINAL_DRAFT_ID = "88888888-8888-4888-8888-888888888888";

const cook = {
  id: COOK_ID,
  handle: "alice_cook",
  display_name: "Alice Cook",
};

const recipe = {
  id: RECIPE_ID,
  lineage_id: LINEAGE_ID,
  parent_version_id: PARENT_ID,
  version_number: 2,
  title: "Alice’s carrot cake",
  description: "A public fork.",
  servings: "8.00",
  categories: [
    { id: CATEGORY_ID, name: "Baking", slug: "baking" },
  ],
  created_at: "2026-08-25T12:00:00Z",
  published_at: "2026-08-25T12:30:00Z",
  author: cook,
  average_rating: 4.25,
  rating_count: 4,
  save_count: 11,
  parent: {
    id: PARENT_ID,
    version_number: 1,
    title: "Catalog carrot cake",
    author: {
      id: PARENT_COOK_ID,
      handle: "recipe-lab",
      display_name: "Recipe Lab catalog",
    },
  },
};

const envelope = {
  page: 1,
  page_size: 12,
  total: 1,
  total_pages: 1,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("private recipe library API", () => {
  it("requests one server-filtered My Recipes view with independent pagination", async () => {
    const draft = {
      id: DRAFT_ID,
      source_version_id: PARENT_ID,
      status: "active",
      revision: 2,
      title: "Weeknight soup",
      ingredient_count: 4,
      instruction_count: 3,
      created_at: "2026-08-25T10:00:00Z",
      updated_at: "2026-08-25T12:00:00Z",
    };
    const originalDraft = {
      ...draft,
      id: ORIGINAL_DRAFT_ID,
      source_version_id: null,
      title: "Original weeknight soup",
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [
          {
            kind: "draft",
            draft,
            source_recipe_title: "Catalog carrot cake",
            description: "A weeknight soup with a silky finish.",
          },
          {
            kind: "draft",
            draft: originalDraft,
            source_recipe_title: null,
            description: null,
          },
        ],
        ...envelope,
        total: 2,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchMyRecipeLibrary({ view: "drafts", page: 3, pageSize: 8 }),
    ).resolves.toMatchObject({
      items: [
        {
          kind: "draft",
          draft,
          source_recipe_title: "Catalog carrot cake",
          description: "A weeknight soup with a silky finish.",
        },
        {
          kind: "draft",
          draft: originalDraft,
          source_recipe_title: null,
          description: null,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/my/recipes?view=drafts&page=3&page_size=8",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("allows the bounded Deleted cook tombstone and validates private visibility", async () => {
    const deletedCook = {
      id: COOK_ID,
      handle: null,
      display_name: "Deleted cook",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              kind: "published",
              recipe: { ...recipe, author: deletedCook },
              visibility_state: "author_withdrawn",
            },
          ],
          ...envelope,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              kind: "published",
              recipe,
              visibility_state: "private-secret-state",
            },
          ],
          ...envelope,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMyRecipeLibrary({ view: "withdrawn" })).resolves.toMatchObject({
      items: [
        {
          kind: "published",
          recipe: { author: deletedCook },
          visibility_state: "author_withdrawn",
        },
      ],
    });
    await expect(fetchMyRecipeLibrary({ view: "published" })).rejects.toMatchObject({
      code: "invalid_recipe_library_response",
      status: 502,
    });

  });

  it("rejects items that do not belong to the requested server-filtered view", async () => {
    const draft = {
      id: DRAFT_ID,
      source_version_id: null,
      status: "active",
      revision: 2,
      title: "Weeknight soup",
      ingredient_count: 4,
      instruction_count: 3,
      created_at: "2026-08-25T10:00:00Z",
      updated_at: "2026-08-25T12:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ items: [{ kind: "draft", draft }], ...envelope }),
        )
        .mockResolvedValueOnce(
          Response.json({
            items: [{ kind: "published", recipe, visibility_state: "author_withdrawn" }],
            ...envelope,
          }),
        ),
    );

    await expect(fetchMyRecipeLibrary({ view: "published" })).rejects.toMatchObject({
      code: "invalid_recipe_library_response",
      status: 502,
    });
    await expect(fetchMyRecipeLibrary({ view: "published" })).rejects.toMatchObject({
      code: "invalid_recipe_library_response",
      status: 502,
    });
  });

  it("reads only saved public recipes from the current actor route", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [{ recipe, saved_at: "2026-08-25T13:00:00Z" }],
        ...envelope,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSavedRecipeLibrary()).resolves.toMatchObject({
      items: [
        {
          recipe: {
            id: RECIPE_ID,
            title: "Alice’s carrot cake",
            author: cook,
          },
          saved_at: "2026-08-25T13:00:00Z",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/my/saved-recipes?page=1&page_size=12",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("announces an expired session and rejects malformed library responses", async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "authentication_required",
                message:
                  "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
              },
            },
            { status: 401 },
          ),
        )
        .mockResolvedValueOnce(Response.json({ items: [{ kind: "draft", draft: {} }], ...envelope })),
    );

    const unauthorized = await fetchMyRecipeLibrary({ view: "drafts" }).catch(
      (reason: unknown) => reason,
    );
    expect(unauthorized).toBeInstanceOf(RecipeLibraryApiError);
    expect(unauthorized).toMatchObject({
      status: 401,
      code: "authentication_required",
      message: "Your session expired. Sign in again to load your recipes.",
    });
    expect(`${String(unauthorized)} ${JSON.stringify(unauthorized)}`).not.toMatch(
      /99999999|canonical|uuid|operator|policy/i,
    );
    expect(expired).toHaveBeenCalledOnce();
    await expect(fetchMyRecipeLibrary({ view: "drafts" })).rejects.toMatchObject({
      code: "invalid_recipe_library_response",
      status: 502,
    });
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });
});
