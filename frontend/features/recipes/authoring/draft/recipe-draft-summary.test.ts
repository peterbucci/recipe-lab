import { describe, expect, it } from "vitest";

import { parseRecipeDraftListItem } from "./recipe-draft-summary";

const VALID_SUMMARY = {
  id: "11111111-1111-4111-8111-111111111111",
  source_version_id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  revision: 3,
  title: "Private version",
  ingredient_count: 4,
  instruction_count: 2,
  created_at: "2026-08-25T12:00:00Z",
  updated_at: "2026-08-25T13:00:00Z",
};

describe("recipe draft summary parser", () => {
  it("returns the validated input object, including unmodeled fields", () => {
    const value = { ...VALID_SUMMARY, future_server_field: "preserved" };

    const parsed = parseRecipeDraftListItem(value);

    expect(parsed).toBe(value);
    expect(parsed).toHaveProperty("future_server_field", "preserved");
  });

  it("accepts blank titles and a required nullable source", () => {
    expect(
      parseRecipeDraftListItem({
        ...VALID_SUMMARY,
        source_version_id: null,
        title: "",
      }),
    ).not.toBeNull();
  });

  it.each([
    ["missing source", { source_version_id: undefined }],
    ["invalid source", { source_version_id: "not-a-uuid" }],
    ["inactive status", { status: "published" }],
    ["zero revision", { revision: 0 }],
    ["fractional revision", { revision: 1.5 }],
    ["long title", { title: "x".repeat(201) }],
    ["negative ingredient count", { ingredient_count: -1 }],
    ["fractional instruction count", { instruction_count: 1.5 }],
    ["invalid created timestamp", { created_at: "not-a-date" }],
    ["invalid updated timestamp", { updated_at: "not-a-date" }],
  ])("rejects %s", (_label, replacement) => {
    expect(
      parseRecipeDraftListItem({ ...VALID_SUMMARY, ...replacement }),
    ).toBeNull();
  });
});
