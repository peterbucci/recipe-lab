import { describe, expect, it } from "vitest";

import playwrightConfig, {
  screenshotModeForRun,
  traceModeForRun,
} from "../../playwright.config";

describe("Playwright diagnostic security", () => {
  it("disables traces when acceptance sessions are active", () => {
    expect(traceModeForRun(true)).toBe("off");
  });

  it("keeps first-retry traces for anonymous browser runs", () => {
    expect(traceModeForRun(false)).toBe("on-first-retry");
  });

  it("does not capture private acceptance screenshots", () => {
    expect(screenshotModeForRun(true)).toBe("off");
  });

  it("keeps failure screenshots for anonymous browser runs", () => {
    expect(screenshotModeForRun(false)).toBe("only-on-failure");
  });

  it("keeps the dedicated deterministic baseline suite out of ordinary runs", () => {
    expect(playwrightConfig.testIgnore).toBe("rcp34b-baseline.spec.ts");
  });
});
