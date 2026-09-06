import { describe, expect, it } from "vitest";
import { readCookie } from "./browser-session";

describe("browser session cookie parsing", () => {
  it("decodes cookie values without losing embedded equals signs", () => {
    expect(readCookie("wanted", "other=one; wanted=a%3Db; third=three")).toBe(
      "a=b",
    );
    expect(readCookie("missing", "other=one")).toBeNull();
  });
});
