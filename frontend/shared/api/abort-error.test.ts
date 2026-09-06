import { describe, expect, it } from "vitest";

import { isAbortError } from "./abort-error";

describe("isAbortError", () => {
  it("accepts platform and compatible named abort errors", () => {
    const compatibleError = new Error("cancelled");
    compatibleError.name = "AbortError";

    expect(isAbortError(new DOMException("cancelled", "AbortError"))).toBe(true);
    expect(isAbortError(compatibleError)).toBe(true);
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("does not confuse timeouts or unrelated values with cancellation", () => {
    expect(isAbortError(new DOMException("timed out", "TimeoutError"))).toBe(false);
    expect(isAbortError(new Error("failed"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
