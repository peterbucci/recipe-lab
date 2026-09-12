import { describe, expect, it } from "vitest";

import {
  firstQueryValue,
  MAX_QUERY_PAGE,
  parseAllowedQueryValue,
  parsePositivePageNumber,
} from "./query-params";

describe("query parameter parsing", () => {
  it("selects only the first value from a query parameter", () => {
    expect(firstQueryValue(undefined)).toBeUndefined();
    expect(firstQueryValue("following")).toBe("following");
    expect(firstQueryValue(["following", "followers"])).toBe("following");
    expect(firstQueryValue([])).toBeUndefined();
  });

  it("parses an allowed value or returns the caller-owned fallback", () => {
    const allowed = ["followers", "following"] as const;

    expect(parseAllowedQueryValue("following", allowed, "followers")).toBe(
      "following",
    );
    expect(
      parseAllowedQueryValue(["following", "followers"], allowed, "followers"),
    ).toBe("following");
    expect(parseAllowedQueryValue("blocked", allowed, "followers")).toBe(
      "followers",
    );
    expect(parseAllowedQueryValue(undefined, allowed, "followers")).toBe(
      "followers",
    );
  });

  it.each([
    { label: "missing", value: undefined },
    { label: "empty", value: "" },
    { label: "whitespace", value: " 2 " },
    { label: "zero", value: "0" },
    { label: "negative", value: "-1" },
    { label: "fractional", value: "1.5" },
    { label: "exponent", value: "1e2" },
    { label: "unsafe", value: "9007199254740992" },
    { label: "above the route bound", value: String(MAX_QUERY_PAGE + 1) },
  ])("defaults a $label page value to page one", ({ value }) => {
    expect(parsePositivePageNumber(value)).toBe(1);
  });

  it("accepts the first safe integer within the inclusive bound", () => {
    expect(parsePositivePageNumber("1")).toBe(1);
    expect(parsePositivePageNumber(["23", "24"])).toBe(23);
    expect(parsePositivePageNumber(String(MAX_QUERY_PAGE))).toBe(MAX_QUERY_PAGE);
    expect(parsePositivePageNumber("4", 3)).toBe(1);
  });
});
