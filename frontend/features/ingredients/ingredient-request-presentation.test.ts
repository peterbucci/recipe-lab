import { describe, expect, it } from "vitest";

import {
  formatIngredientRequestDate,
  formatIngredientRequestTime,
} from "./ingredient-request-presentation";

describe("ingredient request date presentation", () => {
  it("formats valid timestamps", () => {
    expect(formatIngredientRequestDate("2026-08-24T18:00:00Z")).not.toBe(
      "2026-08-24T18:00:00Z",
    );
    expect(formatIngredientRequestTime("2026-08-24T18:00:00Z")).not.toBe(
      "2026-08-24T18:00:00Z",
    );
  });

  it("renders an invalid timestamp safely", () => {
    expect(formatIngredientRequestDate("date unavailable")).toBe(
      "date unavailable",
    );
    expect(formatIngredientRequestTime("date unavailable")).toBe(
      "date unavailable",
    );
  });
});
