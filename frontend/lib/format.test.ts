import { describe, expect, it } from "vitest";

import { formatDecimal, formatIngredientMeasure, formatServings } from "./format";

describe("recipe value formatting", () => {
  it("removes only insignificant fractional zeroes", () => {
    expect(formatDecimal("140.0000")).toBe("140");
    expect(formatDecimal("0.5000")).toBe("0.5");
    expect(formatDecimal("1000")).toBe("1000");
  });

  it("formats yields and uses reviewed structured-measure display text", () => {
    expect(formatServings("1.00")).toBe("1 serving");
    expect(formatServings("8.00")).toBe("8 servings");
    expect(
      formatIngredientMeasure({
        kind: "qualitative",
        value: "to_taste",
        unit: null,
        display_unit: null,
        display: "To taste",
      }),
    ).toBe("To taste");
    expect(
      formatIngredientMeasure({
        kind: "range",
        minimum: "1.0000",
        maximum: "2.0000",
        unit: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          key: "count",
          dimension: "count",
          canonical_label: "count",
          plural_label: "count",
          symbol: null,
          display_style: "hidden",
          active: true,
        },
        display_unit: null,
        display: "1–2",
      }),
    ).toBe("1–2");
  });
});
