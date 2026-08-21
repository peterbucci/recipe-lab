import { describe, expect, it } from "vitest";

import { formatDecimal, formatIngredientAmount, formatServings } from "./format";

describe("recipe value formatting", () => {
  it("removes only insignificant fractional zeroes", () => {
    expect(formatDecimal("140.0000")).toBe("140");
    expect(formatDecimal("0.5000")).toBe("0.5");
    expect(formatDecimal("1000")).toBe("1000");
  });

  it("formats yields and ingredient amounts without floating-point conversion", () => {
    expect(formatServings("1.00")).toBe("1 serving");
    expect(formatServings("8.00")).toBe("8 servings");
    expect(formatIngredientAmount("2.0000", "count")).toBe("2");
    expect(formatIngredientAmount("3.0000", "clove")).toBe("3 cloves");
    expect(formatIngredientAmount(null, null)).toBe("Amount not specified");
  });
});
