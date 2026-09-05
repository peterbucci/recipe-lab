import { describe, expect, it } from "vitest";

import { formatMemberRecipeDate } from "./member-recipe-presentation";

describe("member recipe date presentation", () => {
  it("formats a valid timestamp", () => {
    expect(formatMemberRecipeDate("2026-08-24T18:00:00Z")).not.toBe(
      "2026-08-24T18:00:00Z",
    );
  });

  it("renders an invalid timestamp without throwing", () => {
    expect(formatMemberRecipeDate("date unavailable")).toBe("date unavailable");
  });
});
