import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchCookFollowState,
  fetchMyCommunityActivity,
  fetchMyFollowers,
  fetchMyFollowStats,
  parseCookFollowState,
  parseMyCommunityActivityPage,
  parseMyFollowersPage,
  parseMyFollowStats,
  setCookFollowing,
} from "./member-follow-api";

const COOK_ID = "11111111-1111-4111-8111-111111111111";
const IDEMPOTENCY_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const COMMUNITY_RECIPE = {
  id: "22222222-2222-4222-8222-222222222222",
  lineage_id: "33333333-3333-4333-8333-333333333333",
  parent_version_id: null,
  version_number: 1,
  title: "Garden Toast",
  description: null,
  servings: "2.00",
  created_at: "2026-08-29T12:00:00Z",
  published_at: "2026-08-30T12:00:00Z",
  author: {
    id: COOK_ID,
    handle: "alice-cook",
    display_name: "Alice Cook",
  },
  parent: null,
  categories: [],
};

beforeEach(() => {
  document.cookie = "recipe_lab_csrf=test-csrf-token; path=/";
});

afterEach(() => {
  document.cookie = "recipe_lab_csrf=; max-age=0; path=/";
  vi.unstubAllGlobals();
});

describe("member follow API client", () => {
  it("validates bounded follow state and private counts", () => {
    expect(
      parseCookFollowState({
        cook_id: COOK_ID,
        following: true,
        follower_count: 12,
      }),
    ).toEqual({
      cook_id: COOK_ID,
      following: true,
      follower_count: 12,
    });
    expect(
      parseMyFollowStats({ follower_count: 12, following_count: 4 }),
    ).toEqual({ follower_count: 12, following_count: 4 });

    expect(() =>
      parseCookFollowState({
        cook_id: COOK_ID,
        following: true,
        follower_count: -1,
      }),
    ).toThrow(/invalid follower response/i);
    expect(() =>
      parseMyFollowStats({
        follower_count: 1,
        following_count: 2,
        private_members: [COOK_ID],
      }),
    ).not.toThrow();
    expect(() =>
      parseMyFollowStats({ follower_count: 1, following_count: 1.5 }),
    ).toThrow(/invalid follower response/i);
  });

  it("validates a bounded page of public follower identities", () => {
    expect(
      parseMyFollowersPage({
        items: [
          {
            follower: {
              id: COOK_ID,
              handle: "alice-cook",
              display_name: "Alice Cook",
            },
            followed_at: "2026-08-30T14:30:00Z",
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
        total_pages: 1,
      }),
    ).toEqual({
      items: [
        {
          follower: {
            id: COOK_ID,
            handle: "alice-cook",
            display_name: "Alice Cook",
          },
          followed_at: "2026-08-30T14:30:00Z",
        },
      ],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });

    expect(() =>
      parseMyFollowersPage({
        items: [
          {
            follower: {
              id: COOK_ID,
              handle: "NOT A HANDLE",
              display_name: "Alice Cook",
            },
            followed_at: "2026-08-30T14:30:00Z",
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
        total_pages: 1,
      }),
    ).toThrow(/invalid follower response/i);
    expect(() =>
      parseMyFollowersPage({
        items: [],
        page: 1,
        page_size: 20,
        total: 21,
        total_pages: 1,
      }),
    ).toThrow(/invalid follower response/i);
  });

  it("loads one cook's private state and the current member's stats", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          cook_id: COOK_ID,
          following: false,
          follower_count: 7,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ follower_count: 3, following_count: 5 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCookFollowState("Alice Cook")).resolves.toMatchObject({
      cook_id: COOK_ID,
      following: false,
      follower_count: 7,
    });
    await expect(fetchMyFollowStats()).resolves.toEqual({
      follower_count: 3,
      following_count: 5,
    });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/cooks/Alice%20Cook/follow");
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
    expect(fetchMock.mock.calls[1][0]).toBe("/api/my/follow-stats");
  });

  it("loads one private follower page with bounded pagination", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [
          {
            follower: {
              id: COOK_ID,
              handle: "alice-cook",
              display_name: "Alice Cook",
            },
            followed_at: "2026-08-30T14:30:00Z",
          },
        ],
        page: 2,
        page_size: 12,
        total: 13,
        total_pages: 2,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMyFollowers({ page: 2, pageSize: 12 })).resolves.toMatchObject({
      page: 2,
      total: 13,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/my/followers?page=2&page_size=12",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
    await expect(fetchMyFollowers({ page: 0 })).rejects.toThrow(/between 1/i);
    await expect(fetchMyFollowers({ pageSize: 101 })).rejects.toThrow(/between 1/i);
  });

  it("loads and validates one private community activity page", async () => {
    const payload = {
      items: [COMMUNITY_RECIPE],
      page: 2,
      page_size: 12,
      total: 13,
      total_pages: 2,
    };
    expect(parseMyCommunityActivityPage(payload)).toEqual(payload);
    expect(() =>
      parseMyCommunityActivityPage({
        ...payload,
        items: [{ ...COMMUNITY_RECIPE, lineage_id: "not-a-uuid" }],
      }),
    ).toThrow(/invalid follower response/i);

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchMyCommunityActivity({ page: 2, pageSize: 12 }),
    ).resolves.toMatchObject({ page: 2, total: 13 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/my/community-activity?page=2&page_size=12",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
    await expect(fetchMyCommunityActivity({ page: 0 })).rejects.toThrow(/between 1/i);
    await expect(fetchMyCommunityActivity({ pageSize: 101 })).rejects.toThrow(/between 1/i);
  });

  it.each([
    [true, "PUT"],
    [false, "DELETE"],
  ] as const)("writes following=%s with %s", async (following, method) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        cook_id: COOK_ID,
        following,
        follower_count: following ? 8 : 7,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      setCookFollowing("alice-cook", following, IDEMPOTENCY_KEY),
    ).resolves.toMatchObject({ following });

    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe("/api/cooks/alice-cook/follow");
    expect(init).toEqual(
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method,
        redirect: "error",
      }),
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toBe(IDEMPOTENCY_KEY);
    expect(headers.get("X-CSRF-Token")).toBe("test-csrf-token");
  });

  it("keeps undocumented service details out of follow errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "internal_operator_policy_failure",
              message:
                "Canonical user UUID 99999999-9999-4999-8999-999999999999 failed an operator policy.",
            },
          },
          { status: 503 },
        ),
      ),
    );

    const error = await fetchCookFollowState("alice-cook").catch(
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({
      code: "member_follow_api_error",
      message: "Recipe Lab could not update this follow right now.",
      status: 503,
    });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /99999999|canonical|uuid|operator|policy|internal_/i,
    );
  });
});
