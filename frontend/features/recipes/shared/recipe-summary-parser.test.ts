import { describe, expect, it } from "vitest";

import { fork, original } from "./recipe-test-support";
import { parseRecipeSummary } from "./recipe-summary-parser";

describe("parseRecipeSummary", () => {
  it("retains stable recipe and edition identity", () => {
    const value = original();
    expect(parseRecipeSummary(value)).toMatchObject({
      id: value.id,
      recipe_id: value.recipe_id,
      edition_number: 1,
      relation_kind: "original",
    });
  });

  it("retains an adaptation's exact source", () => {
    const value = fork();
    expect(parseRecipeSummary(value)).toMatchObject({
      id: value.id,
      adaptation_source: { id: value.parent_version_id },
      relation_kind: "adaptation",
    });
  });

  it("retains a revised adaptation's pinned exact source", () => {
    const adaptation = fork();
    const value = {
      ...adaptation,
      declared_change_reason: "update" as const,
      edition_number: 2,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      parent: null,
      parent_version_id: null,
      previous_version_id: adaptation.id,
      relation_kind: "revision" as const,
    };

    expect(parseRecipeSummary(value)).toMatchObject({
      adaptation_source: { id: adaptation.parent_version_id },
      edition_number: 2,
      previous_version_id: adaptation.id,
      relation_kind: "revision",
    });
  });

  it("accepts a revised adaptation when its exact source is unreadable", () => {
    const adaptation = fork();
    const value = {
      ...adaptation,
      adaptation_source: null,
      declared_change_reason: "correction" as const,
      edition_number: 2,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      parent: null,
      parent_version_id: null,
      previous_version_id: adaptation.id,
      relation_kind: "revision" as const,
    };

    expect(parseRecipeSummary(value)).toMatchObject({
      adaptation_source: null,
      edition_number: 2,
      relation_kind: "revision",
    });
  });
});
