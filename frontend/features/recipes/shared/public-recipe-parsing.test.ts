import { describe, expect, it } from "vitest";

import { parsePublicCookProfilePage } from "./public-cook-profile";
import { RecipeLibraryApiError } from "./recipe-library-error";
import { parsePublicUserReference } from "./recipe-summary-parser";

const COOK_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_COOK_ID = "22222222-2222-4222-8222-222222222222";
const RECIPE_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_ID = "44444444-4444-4444-8444-444444444444";
const LINEAGE_ID = "55555555-5555-4555-8555-555555555555";
const CATEGORY_ID = "77777777-7777-4777-8777-777777777777";
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

describe("public recipe parsing", () => {
  it("projects only the bounded public identity and recipe fields", () => {
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
    });

    expect(result.cook).toEqual(cook);
    expect(result.follower_count).toBe(4);
    expect(result.description).toBe("  A public profile description.  ");
    expect(result.items[0].author).toEqual(cook);
    expect(result.items[0].categories).toEqual(recipe.categories);
    expect(result.items[0]).toMatchObject({
      average_rating: 4.25,
      rating_count: 4,
      save_count: 11,
    });
    expect(result.cook).not.toHaveProperty("email");
    expect(result.items[0]).not.toHaveProperty("private_events");
  });

  it("rejects missing or malformed public-profile engagement totals", () => {
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
      ).toThrow(RecipeLibraryApiError);
    }
  });

  it("accepts a missing legacy description as empty and rejects malformed descriptions", () => {
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
    ).toThrow(RecipeLibraryApiError);
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

  it("allows only the fixed handleless Demo Cook compatibility identity", () => {
    const demoCook = {
      id: DEMO_COOK_ID,
      handle: null,
      display_name: "Demo Cook",
    };
    const deletedCook = {
      id: COOK_ID,
      handle: null,
      display_name: "Deleted cook",
    };

    expect(parsePublicUserReference(demoCook)).toEqual(demoCook);
    expect(parsePublicUserReference({ ...demoCook, id: COOK_ID })).toBeNull();
    expect(
      parsePublicUserReference({ ...demoCook, display_name: "Another demo" }),
    ).toBeNull();
    expect(() =>
      parsePublicCookProfilePage({
        cook: deletedCook,
        follower_count: 0,
        items: [],
        ...envelope,
        total: 0,
        total_pages: 0,
      }),
    ).toThrow(RecipeLibraryApiError);
  });
});
