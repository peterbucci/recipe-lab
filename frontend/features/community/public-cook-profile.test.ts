import { describe, expect, it } from "vitest";

import {
  PublicCookProfileApiError,
} from "./public-cook-profile-error";
import { parsePublicCookProfilePage } from "./public-cook-profile";

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
  categories: [{ id: CATEGORY_ID, name: "Baking", slug: "baking" }],
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

describe("public cook profile parsing", () => {
  it("accepts extra input while projecting only public profile and recipe fields", () => {
    const result = parsePublicCookProfilePage({
      cook: {
        ...cook,
        email: "private@example.test",
        provider_subject: "private-subject",
      },
      follower_count: 4,
      description: "  A public profile description.  ",
      items: [
        {
          ...recipe,
          private_events: ["save"],
          author: { ...cook, email: "hidden" },
        },
      ],
      ...envelope,
      internal_profile_state: "hidden",
    });

    expect(result).toEqual({
      cook,
      follower_count: 4,
      description: "  A public profile description.  ",
      items: [recipe],
      ...envelope,
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        "cook",
        "description",
        "follower_count",
        "items",
        "page",
        "page_size",
        "total",
        "total_pages",
      ].sort(),
    );
    expect(result.cook).not.toHaveProperty("email");
    expect(result.items[0]).not.toHaveProperty("private_events");
    expect(result).not.toHaveProperty("internal_profile_state");
  });

  it("validates every profile pagination field with the profile error identity", () => {
    const invalidPages = [
      { items: null },
      { page: 0 },
      { page_size: 0 },
      { page_size: 101 },
      { total: -1 },
      { total_pages: -1 },
    ];

    for (const invalid of invalidPages) {
      expect(() =>
        parsePublicCookProfilePage({
          cook,
          follower_count: 4,
          items: [recipe],
          ...envelope,
          ...invalid,
        }),
      ).toThrow(PublicCookProfileApiError);
    }
  });

  it("rejects malformed engagement totals with the profile error identity", () => {
    const invalidItems = [
      { ...recipe, average_rating: 0 },
      { ...recipe, average_rating: 5.1 },
      { ...recipe, rating_count: -1 },
      { ...recipe, save_count: 1.5 },
    ];

    for (const item of invalidItems) {
      expect(() =>
        parsePublicCookProfilePage({
          cook,
          follower_count: 4,
          items: [item],
          ...envelope,
        }),
      ).toThrow(PublicCookProfileApiError);
    }

    const error = (() => {
      try {
        parsePublicCookProfilePage({
          cook,
          follower_count: 4,
          items: [invalidItems[0]],
          ...envelope,
        });
      } catch (reason) {
        return reason;
      }
      return null;
    })();
    expect(error).toMatchObject({
      code: "invalid_public_cook_profile_response",
      name: "PublicCookProfileApiError",
      status: 502,
    });
  });

  it("accepts a missing legacy description and rejects malformed descriptions", () => {
    expect(
      parsePublicCookProfilePage({
        cook,
        follower_count: 4,
        items: [recipe],
        ...envelope,
      }).description,
    ).toBeNull();

    expect(() =>
      parsePublicCookProfilePage({
        cook,
        follower_count: 4,
        description: "x".repeat(501),
        items: [recipe],
        ...envelope,
      }),
    ).toThrow(PublicCookProfileApiError);
  });

  it("keeps a fork label without exposing an unreadable direct parent", () => {
    const result = parsePublicCookProfilePage({
      cook,
      follower_count: 4,
      items: [{ ...recipe, parent: null }],
      ...envelope,
    });

    expect(result.items[0]).toMatchObject({
      parent_version_id: PARENT_ID,
      parent: null,
    });
  });

  it("requires the profile owner to have an active public handle", () => {
    expect(() =>
      parsePublicCookProfilePage({
        cook: {
          id: COOK_ID,
          handle: null,
          display_name: "Deleted cook",
        },
        follower_count: 0,
        items: [],
        ...envelope,
        total: 0,
        total_pages: 0,
      }),
    ).toThrow(PublicCookProfileApiError);
  });
});
