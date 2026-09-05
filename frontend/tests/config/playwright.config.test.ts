import { describe, expect, it } from "vitest";

import {
  CROSS_BROWSER_SANITY_TAG,
  createPlaywrightModeConfig,
  MODE_TEST_MATCH,
  requirePlaywrightMode,
  screenshotModeForRun,
  traceModeForRun,
  validatePlaywrightModeEnvironment,
  type Environment,
  type PlaywrightMode,
} from "../../playwright.mode";

const guardedStack = {
  CI: "1",
  ACCEPTANCE_DATABASE_ISOLATED: "1",
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:43191",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:43192",
  RECIPE_API_URL: "http://127.0.0.1:43192",
  PLAYWRIGHT_WEB_SERVER_COMMAND: "node scripts/playwright-test-server.mjs",
  DATABASE_URL:
    "postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_acceptance",
} as const;

function environmentFor(mode: PlaywrightMode): Environment {
  if (mode === "smoke") {
    return { CI: "1" };
  }
  if (mode === "acceptance") {
    return {
      ...guardedStack,
      MVP_ACCEPTANCE: "1",
      ACCEPTANCE_SESSION_FIXTURE: "acceptance-sessions.json",
    };
  }
  if (mode === "performance") {
    return {
      ...guardedStack,
      MVP_ACCEPTANCE: "1",
      RCP34B_PERFORMANCE: "1",
      RCP34B_PERFORMANCE_MODE: "check",
    };
  }
  return {
    ...guardedStack,
    RCP32_ACCEPTANCE: "1",
    RCP32_MANIFEST_PATH: "rcp32-manifest.json",
    OIDC_ISSUER: "http://127.0.0.1:43193",
    OIDC_CLIENT_ID: "recipe-lab-test",
    OIDC_REDIRECT_URI: "http://127.0.0.1:43191/api/auth/callback",
    DATABASE_URL:
      "postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_rcp32_acceptance",
  };
}

describe("explicit Playwright execution modes", () => {
  it("requires one named functional mode instead of broad default discovery", () => {
    expect(() => requirePlaywrightMode({})).toThrow(/explicit Playwright mode/);
    expect(() => requirePlaywrightMode({ PLAYWRIGHT_MODE: "visual" })).toThrow(
      /explicit Playwright mode/,
    );
    expect(requirePlaywrightMode({ PLAYWRIGHT_MODE: "acceptance" })).toBe(
      "acceptance",
    );
  });

  it.each([
    ["smoke", "smoke/**/*.spec.ts"],
    ["acceptance", "acceptance/**/*.spec.ts"],
    ["performance", "performance/**/*.spec.ts"],
    ["release", "release/**/*.spec.ts"],
  ] as const)("selects only the %s directory", (mode, expectedMatch) => {
    const config = createPlaywrightModeConfig(mode, environmentFor(mode));
    expect(MODE_TEST_MATCH[mode]).toBe(expectedMatch);
    expect(config.testDir).toBe("./e2e");
    expect(config.testMatch).toBe(expectedMatch);
    expect(config.projects?.map((project) => project.name)).toEqual(
      mode === "smoke"
        ? ["chromium", "firefox-sanity", "webkit-sanity"]
        : ["chromium"],
    );
  });

  it("runs all smoke tests in Chromium and only the tagged sanity slice elsewhere", () => {
    const projects = createPlaywrightModeConfig(
      "smoke",
      environmentFor("smoke"),
    ).projects;
    expect(projects?.[0]?.grep).toBeUndefined();
    expect(projects?.[1]?.grep).toEqual(new RegExp(CROSS_BROWSER_SANITY_TAG));
    expect(projects?.[2]?.grep).toEqual(new RegExp(CROSS_BROWSER_SANITY_TAG));
    expect(projects?.[1]?.use).toMatchObject({ defaultBrowserType: "firefox" });
    expect(projects?.[2]?.use).toMatchObject({ defaultBrowserType: "webkit" });
  });

  it("preserves diagnostics only for controlled smoke data", () => {
    expect(traceModeForRun("smoke")).toBe("on-first-retry");
    expect(screenshotModeForRun("smoke")).toBe("only-on-failure");
    for (const mode of ["acceptance", "performance", "release"] as const) {
      expect(traceModeForRun(mode)).toBe("off");
      expect(screenshotModeForRun(mode)).toBe("off");
      const config = createPlaywrightModeConfig(mode, environmentFor(mode));
      expect(config.workers).toBe(1);
      expect(config.webServer).toMatchObject({ reuseExistingServer: false });
    }
  });

  it("bounds CI smoke to one worker and two retries", () => {
    const config = createPlaywrightModeConfig("smoke", environmentFor("smoke"));
    expect(config.workers).toBe(1);
    expect(config.retries).toBe(2);
  });

  it("keeps the release reporter private and disables release retries", () => {
    const config = createPlaywrightModeConfig(
      "release",
      environmentFor("release"),
    );
    expect(config.reporter).toEqual([["github"]]);
    expect(config.retries).toBe(0);
  });

  it("fails guarded modes before discovery when their attestations are missing", () => {
    expect(() =>
      validatePlaywrightModeEnvironment("acceptance", guardedStack),
    ).toThrow(/MVP_ACCEPTANCE=1/);
    expect(() =>
      validatePlaywrightModeEnvironment("performance", {
        ...guardedStack,
        MVP_ACCEPTANCE: "1",
      }),
    ).toThrow(/RCP34B_PERFORMANCE=1/);
    expect(() =>
      validatePlaywrightModeEnvironment("release", {
        ...guardedStack,
        RCP32_ACCEPTANCE: "1",
      }),
    ).toThrow(/RCP32_MANIFEST_PATH/);
  });

  it("rejects mismatched or unsafe guarded service origins", () => {
    expect(() =>
      validatePlaywrightModeEnvironment("acceptance", {
        ...environmentFor("acceptance"),
        RECIPE_API_URL: "http://127.0.0.1:43194",
      }),
    ).toThrow(/must identify the same isolated backend/);
    expect(() =>
      validatePlaywrightModeEnvironment("acceptance", {
        ...environmentFor("acceptance"),
        CI: undefined,
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3000",
      }),
    ).toThrow(/dedicated ports/);
  });
});
