import { describe, expect, it } from "vitest";

import { parseRecipeHistory } from "./recipe-history";

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const FIRST = "22222222-2222-4222-8222-222222222222";
const SECOND = "33333333-3333-4333-8333-333333333333";
const ADAPTATION_RECIPE = "44444444-4444-4444-8444-444444444444";
const ADAPTATION = "55555555-5555-4555-8555-555555555555";
const ADAPTATION_FIRST = "66666666-6666-4666-8666-666666666666";
const AUTHOR = {
  id: "77777777-7777-4777-8777-777777777777",
  display_name: "Maya Chen",
  handle: "maya-chen",
};

function validHistory() {
  return {
    adaptations: [{
      adaptation_source_version_id: FIRST,
      author: AUTHOR,
      declared_change_reason: "update",
      edition_number: 2,
      id: ADAPTATION,
      is_current: true,
      previous_version_id: ADAPTATION_FIRST,
      published_at: "2026-09-14T12:00:00Z",
      recipe_id: ADAPTATION_RECIPE,
      relation_kind: "revision",
      title: "Maya's version",
    }],
    adaptations_truncated: false,
    current_version_id: SECOND,
    editions: [
      {
        adaptation_source_version_id: null,
        author: AUTHOR,
        declared_change_reason: null,
        edition_number: 1,
        id: FIRST,
        is_current: false,
        previous_version_id: null,
        published_at: "2026-09-12T12:00:00Z",
        recipe_id: RECIPE_ID,
        relation_kind: "original",
        title: "Tomato soup",
      },
      {
        adaptation_source_version_id: null,
        author: AUTHOR,
        declared_change_reason: "correction",
        edition_number: 2,
        id: SECOND,
        is_current: true,
        previous_version_id: FIRST,
        published_at: "2026-09-13T12:00:00Z",
        recipe_id: RECIPE_ID,
        relation_kind: "revision",
        title: "Tomato soup, corrected",
      },
    ],
    editions_truncated: false,
    recipe_id: RECIPE_ID,
    selected_version_id: FIRST,
  };
}

describe("parseRecipeHistory", () => {
  it("retains exact edition, revision-reason, and adaptation topology", () => {
    expect(parseRecipeHistory(validHistory())).toEqual(validHistory());
  });

  it("accepts a bounded page that omits the selected and current exact editions", () => {
    const value = {
      ...validHistory(),
      adaptations: [],
      current_version_id: SECOND,
      editions: [],
      editions_truncated: true,
    };
    expect(parseRecipeHistory(value)).toMatchObject({
      current_version_id: SECOND,
      editions: [],
      selected_version_id: FIRST,
    });
  });

  it("rejects a visible current flag when the readable current reference is absent", () => {
    const value = validHistory();
    expect(() =>
      parseRecipeHistory({ ...value, current_version_id: null }),
    ).toThrow("invalid recipe history response");
  });

  it("rejects duplicate adaptation stable recipes", () => {
    const value = validHistory();
    expect(() =>
      parseRecipeHistory({
        ...value,
        adaptations: [value.adaptations[0], { ...value.adaptations[0], id: ADAPTATION_FIRST }],
      }),
    ).toThrow("invalid recipe history response");
  });
});
