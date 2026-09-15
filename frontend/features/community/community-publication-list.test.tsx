import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { CommunityPublicationList } from "./community-publication-list";

const STABLE_RECIPE_ID = "99999999-9999-4999-8999-999999999999";
const recipe: ComponentProps<typeof CommunityPublicationList>["items"][number] = {
  adaptation_source: null,
  author: {
    display_name: "Alice Cook",
    handle: "alice",
    id: "11111111-1111-4111-8111-111111111111",
  },
  categories: [],
  created_at: "2026-08-25T10:00:00Z",
  current_version: null,
  declared_change_reason: null,
  description: "A bright soup.",
  edition_number: 1,
  id: "33333333-3333-4333-8333-333333333333",
  is_current: true,
  lineage_id: "55555555-5555-4555-8555-555555555555",
  parent: null,
  parent_version_id: null,
  previous_version_id: null,
  published_at: "2026-08-25T11:00:00Z",
  recipe_id: STABLE_RECIPE_ID,
  relation_kind: "original",
  servings: "4.00",
  title: "Alice’s tomato soup",
  version_number: 1,
};

describe("CommunityPublicationList", () => {
  it("uses stable recipe destinations for ordinary community browsing", () => {
    render(
      <CommunityPublicationList
        items={[recipe]}
        recipeHref={(item) => `/recipes/current/${item.recipe_id}`}
      />,
    );
    const href = `/recipes/current/${STABLE_RECIPE_ID}`;
    expect(screen.getByRole("link", { name: "Alice’s tomato soup" })).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: "View Alice’s tomato soup" })).toHaveAttribute("href", href);
  });
});
