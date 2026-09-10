import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicCookProfileApiError } from "./public-cook-profile-error";
import { fetchPublicCookProfile } from "./public-cook-profile-server-api";

const COOK_ID = "11111111-1111-4111-8111-111111111111";

const PARENT_COOK_ID = "22222222-2222-4222-8222-222222222222";

const RECIPE_ID = "33333333-3333-4333-8333-333333333333";

const PARENT_ID = "44444444-4444-4444-8444-444444444444";

const LINEAGE_ID = "55555555-5555-4555-8555-555555555555";

const CATEGORY_ID = "77777777-7777-4777-8777-777777777777";

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

describe("public cook server API", () => {
  it("fetches a public cook page from the server endpoint without caching", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        cook,
        follower_count: 4,
        description: "Weeknight baking and family recipes.",
        items: [recipe],
        ...envelope,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchPublicCookProfile({ handle: "Alice_Cook", page: 2, pageSize: 6 }),
    ).resolves.toMatchObject({
      cook,
      description: "Weeknight baking and family recipes.",
      items: [recipe],
    });
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe(
      "http://api.example.test/api/cooks/Alice_Cook?page=2&page_size=6",
    );
    expect(init).toMatchObject({ cache: "no-store", method: "GET", redirect: "error" });
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
  });

  it("returns null only for a missing public cook", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(fetchPublicCookProfile({ handle: "missing-cook" })).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "validation_error",
              message: "Private validation detail.",
            },
          },
          { status: 422 },
        ),
      ),
    );
    await expect(fetchPublicCookProfile({ handle: "missing-cook" })).rejects.toBeInstanceOf(
      PublicCookProfileApiError,
    );
  });

  it("uses profile errors and copy for malformed parser and transport responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ items: [] }))
        .mockResolvedValueOnce(
          new Response("private upstream body", {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "recipe_library_unavailable",
                message: "Private recipe library detail.",
              },
            },
            { status: 503 },
          ),
        ),
    );

    const malformedProfile = await fetchPublicCookProfile({
      handle: "alice",
    }).catch((reason: unknown) => reason);
    expect(malformedProfile).toBeInstanceOf(PublicCookProfileApiError);
    expect(malformedProfile).toMatchObject({
      code: "invalid_public_cook_profile_response",
      message: "Recipe Lab could not load this cook profile. Please try again.",
      status: 502,
    });

    const malformedTransport = await fetchPublicCookProfile({
      handle: "alice",
    }).catch((reason: unknown) => reason);
    expect(malformedTransport).toBeInstanceOf(PublicCookProfileApiError);
    expect(malformedTransport).toMatchObject({
      code: "invalid_public_cook_profile_response",
      message: "Recipe Lab could not load this cook profile. Please try again.",
      status: 502,
    });
    expect(`${String(malformedTransport)} ${JSON.stringify(malformedTransport)}`).not.toMatch(
      /library|private upstream/i,
    );

    const unavailableProfile = await fetchPublicCookProfile({
      handle: "alice",
    }).catch((reason: unknown) => reason);
    expect(unavailableProfile).toBeInstanceOf(PublicCookProfileApiError);
    expect(unavailableProfile).toMatchObject({
      code: "public_cook_profile_api_error",
      message: "Recipe Lab could not load this cook profile. Please try again.",
      status: 503,
    });
    expect(`${String(unavailableProfile)} ${JSON.stringify(unavailableProfile)}`).not.toMatch(
      /library|private recipe/i,
    );
  });
});
