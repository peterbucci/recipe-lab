import { describe, expect, it } from "vitest";

import { traceModeForRun } from "./playwright.config";

describe("Playwright diagnostic security", () => {
  it("disables traces when acceptance sessions are active", () => {
    expect(traceModeForRun(true)).toBe("off");
  });

  it("keeps first-retry traces for anonymous browser runs", () => {
    expect(traceModeForRun(false)).toBe("on-first-retry");
  });
});
