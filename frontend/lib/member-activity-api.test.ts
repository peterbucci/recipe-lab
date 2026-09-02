import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchMemberActivity,
  fetchMemberDashboard,
  parseMemberActivityPage,
  parseMemberDashboard,
} from "./member-activity-api";

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const RECIPE_ID = "22222222-2222-4222-8222-222222222222";

const DRAFT = {
  created_at: "2026-08-29T12:00:00Z",
  id: DRAFT_ID,
  ingredient_count: 3,
  instruction_count: 2,
  revision: 4,
  source_version_id: null,
  status: "active",
  title: "Garden Toast",
  updated_at: "2026-09-02T12:00:00Z",
};

const ACTIVITY_RESPONSE = {
  counts: { all: 2, recipes: 2, requests: 0, saved: 0 },
  items: [
    {
      id: DRAFT_ID,
      kind: "draft",
      occurred_at: "2026-09-02T12:00:00Z",
      state: null,
      title: "Garden Toast",
    },
    {
      id: RECIPE_ID,
      kind: "published",
      occurred_at: "2026-09-01T12:00:00Z",
      state: "moderation_hidden",
      title: "Tomato Toast",
    },
  ],
  next_cursor: "eyJhdCI6InRlc3QifQ",
  selected_filter: "all",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("member activity API", () => {
  it("validates and maps the bounded activity contract", () => {
    expect(parseMemberActivityPage(ACTIVITY_RESPONSE)).toEqual({
      counts: { all: 2, recipes: 2, requests: 0, saved: 0 },
      items: [
        expect.objectContaining({
          href: `/recipes/drafts/${DRAFT_ID}`,
          id: `draft:${DRAFT_ID}`,
          kind: "draft",
          label: "Updated draft",
        }),
        expect.objectContaining({
          detail: "Currently hidden by moderation",
          id: `published:${RECIPE_ID}`,
          kind: "published",
        }),
      ],
      nextCursor: "eyJhdCI6InRlc3QifQ",
      selectedFilter: "all",
    });
  });

  it("rejects impossible states, inconsistent counts, and unbounded pages", () => {
    expect(() =>
      parseMemberActivityPage({
        ...ACTIVITY_RESPONSE,
        items: [{ ...ACTIVITY_RESPONSE.items[0], state: "approved" }],
      }),
    ).toThrow(/could not load your activity/i);
    expect(() =>
      parseMemberActivityPage({
        ...ACTIVITY_RESPONSE,
        counts: { all: 99, recipes: 2, requests: 0, saved: 0 },
      }),
    ).toThrow(/could not load your activity/i);
    expect(() =>
      parseMemberActivityPage({
        ...ACTIVITY_RESPONSE,
        items: Array.from({ length: 101 }, () => ACTIVITY_RESPONSE.items[0]),
      }),
    ).toThrow(/could not load your activity/i);
  });

  it("validates the purpose-built dashboard response", () => {
    expect(
      parseMemberDashboard({
        latest_draft: DRAFT,
        recent_activity: [ACTIVITY_RESPONSE.items[0]],
        stats: {
          active_drafts: 1,
          followers: 5,
          saved_recipes: 6,
          versions_published: 7,
        },
      }),
    ).toEqual({
      latestDraft: DRAFT,
      recentActivity: [
        expect.objectContaining({ id: `draft:${DRAFT_ID}`, kind: "draft" }),
      ],
      stats: {
        activeDrafts: 1,
        followers: 5,
        savedRecipes: 6,
        versionsPublished: 7,
      },
    });
    expect(() =>
      parseMemberDashboard({
        latest_draft: DRAFT,
        recent_activity: [],
        stats: {
          active_drafts: -1,
          followers: 0,
          saved_recipes: 0,
          versions_published: 0,
        },
      }),
    ).toThrow(/could not load your activity/i);
  });

  it("loads activity and dashboard through the shared browser transport", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...ACTIVITY_RESPONSE, selected_filter: "recipes" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          latest_draft: null,
          recent_activity: [],
          stats: {
            active_drafts: 0,
            followers: 0,
            saved_recipes: 0,
            versions_published: 0,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchMemberActivity({ filter: "recipes", pageSize: 12, q: "toast" }),
    ).resolves.toMatchObject({ selectedFilter: "recipes" });
    await expect(fetchMemberDashboard()).resolves.toMatchObject({
      latestDraft: null,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/my/activity?filter=recipes&page_size=12&q=toast",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/my/dashboard");
  });
});
