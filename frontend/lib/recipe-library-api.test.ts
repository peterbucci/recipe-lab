import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "./auth-api";
import {
  fetchMyRecipeLibrary,
  fetchPublicCookProfile,
  fetchSavedRecipeLibrary,
  parsePublicCookProfilePage,
  parsePublicUserReference,
  RecipeLibraryApiError,
} from "./recipe-library-api";

const COOK_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_COOK_ID = "22222222-2222-4222-8222-222222222222";
const RECIPE_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_ID = "44444444-4444-4444-8444-444444444444";
const LINEAGE_ID = "55555555-5555-4555-8555-555555555555";
const DRAFT_ID = "66666666-6666-4666-8666-666666666666";
const DEMO_COOK_ID = "1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9";

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
  created_at: "2026-08-25T12:00:00Z",
  author: cook,
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

describe("recipe library API", () => {
  it("fetches a public cook page from the server endpoint without caching", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ cook, items: [recipe], ...envelope }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchPublicCookProfile({ handle: "Alice_Cook", page: 2, pageSize: 6 }),
    ).resolves.toMatchObject({ cook, items: [recipe] });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://api.example.test/api/cooks/Alice_Cook?page=2&page_size=6"),
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
  });

  it("returns null only for a missing public cook", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(fetchPublicCookProfile({ handle: "missing-cook" })).resolves.toBeNull();
  });

  it("projects only the bounded public identity and recipe fields", () => {
    const result = parsePublicCookProfilePage({
      cook: { ...cook, email: "private@example.test", provider_subject: "private-subject" },
      items: [{ ...recipe, private_events: ["save"], author: { ...cook, email: "hidden" } }],
      ...envelope,
    });

    expect(result.cook).toEqual(cook);
    expect(result.items[0].author).toEqual(cook);
    expect(result.cook).not.toHaveProperty("email");
    expect(result.items[0]).not.toHaveProperty("private_events");
  });

  it("keeps a fork label without exposing an unreadable direct parent", () => {
    const result = parsePublicCookProfilePage({
      cook,
      items: [{ ...recipe, parent: null }],
      ...envelope,
    });

    expect(result.items[0]).toMatchObject({
      parent_version_id: PARENT_ID,
      parent: null,
    });
  });

  it("reads discriminated private drafts and published recipes from the current actor route", async () => {
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [
          { kind: "draft", draft },
          { kind: "published", recipe, visibility_state: "published" },
        ],
        ...envelope,
        total: 2,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMyRecipeLibrary({ page: 3, pageSize: 8 })).resolves.toMatchObject({
      items: [
        { kind: "draft", draft },
        { kind: "published", recipe, visibility_state: "published" },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/my/recipes?page=3&page_size=8",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("allows only the bounded Deleted cook tombstone and validates private visibility", async () => {
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

    await expect(fetchMyRecipeLibrary()).resolves.toMatchObject({
      items: [
        {
          kind: "published",
          recipe: { author: deletedCook },
          visibility_state: "author_withdrawn",
        },
      ],
    });
    await expect(fetchMyRecipeLibrary()).rejects.toMatchObject({
      code: "invalid_recipe_library_response",
      status: 502,
    });

    expect(() =>
      parsePublicCookProfilePage({
        cook: deletedCook,
        items: [],
        ...envelope,
        total: 0,
        total_pages: 0,
      }),
    ).toThrow(RecipeLibraryApiError);
  });

  it("allows only the fixed handleless Demo Cook compatibility identity", () => {
    const demoCook = {
      id: DEMO_COOK_ID,
      handle: null,
      display_name: "Demo Cook",
    };

    expect(parsePublicUserReference(demoCook)).toEqual(demoCook);
    expect(parsePublicUserReference({ ...demoCook, id: COOK_ID })).toBeNull();
    expect(parsePublicUserReference({ ...demoCook, display_name: "Another demo" })).toBeNull();
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
      items: [{ recipe, saved_at: "2026-08-25T13:00:00Z" }],
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

    const unauthorized = await fetchMyRecipeLibrary().catch((reason: unknown) => reason);
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
    await expect(fetchMyRecipeLibrary()).rejects.toMatchObject({
      code: "invalid_recipe_library_response",
      status: 502,
    });
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });
});
