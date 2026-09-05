import { describe, expect, it } from "vitest";

import baselineConfig, {
  BASELINE_CHROMIUM_VERSION,
  BASELINE_CLOCK_ISO,
  BASELINE_DESKTOP_VIEWPORT,
  BASELINE_FIXTURE_ORIGIN,
  BASELINE_FRONTEND_ORIGIN,
  BASELINE_OUTPUT_DIRECTORY,
  BASELINE_PHONE_VIEWPORT,
  BASELINE_PLAYWRIGHT_VERSION,
  BASELINE_PROJECTS,
  BASELINE_RESULTS_FILE,
  BASELINE_SNAPSHOT_TEMPLATE,
} from "../../playwright.baseline.config";

describe("RCP-34B deterministic browser baseline configuration", () => {
  it("freezes the public runner contract and diagnostics policy", () => {
    expect(BASELINE_FRONTEND_ORIGIN).toBe("http://127.0.0.1:4317");
    expect(BASELINE_FIXTURE_ORIGIN).toBe("http://127.0.0.1:4318");
    expect(BASELINE_CLOCK_ISO).toBe("2026-08-27T12:00:00.000Z");
    expect(BASELINE_PLAYWRIGHT_VERSION).toBe("1.62.1");
    expect(BASELINE_CHROMIUM_VERSION).toBe("151.0.7922.34");
    expect(BASELINE_OUTPUT_DIRECTORY).toBe("test-results/baseline/artifacts");
    expect(BASELINE_RESULTS_FILE).toBe("test-results/baseline/results.json");
    expect(BASELINE_SNAPSHOT_TEMPLATE).toBe(
      "{testDir}/../baselines/{projectName}/{arg}{ext}",
    );
    expect(baselineConfig.testMatch).toBe("rcp34b-baseline.spec.ts");
    expect(baselineConfig.fullyParallel).toBe(false);
    expect(baselineConfig.forbidOnly).toBe(true);
    expect(baselineConfig.retries).toBe(0);
    expect(baselineConfig.repeatEach).toBe(1);
    expect(baselineConfig.workers).toBe(1);
    expect(baselineConfig.outputDir).toBe(BASELINE_OUTPUT_DIRECTORY);
    expect(baselineConfig.preserveOutput).toBe("failures-only");
    expect(baselineConfig.updateSnapshots).toBe("none");
    expect(baselineConfig.use).toMatchObject({
      baseURL: BASELINE_FRONTEND_ORIGIN,
      browserName: "chromium",
      colorScheme: "light",
      deviceScaleFactor: 1,
      locale: "en-US",
      reducedMotion: "reduce",
      screenshot: "off",
      serviceWorkers: "block",
      timezoneId: "UTC",
      trace: "off",
      video: "off",
    });
    expect(baselineConfig.expect?.toHaveScreenshot).toMatchObject({
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 0,
      scale: "css",
      threshold: 0.1,
    });
    expect(baselineConfig.reporter).toEqual([
      ["line"],
      ["./e2e/rcp34b-baseline-reporter.mjs", { outputFile: BASELINE_RESULTS_FILE }],
    ]);
  });

  it("uses exact desktop and phone projects without mutable device presets", () => {
    expect(BASELINE_DESKTOP_VIEWPORT).toEqual({ width: 1440, height: 900 });
    expect(BASELINE_PHONE_VIEWPORT).toEqual({ width: 390, height: 844 });
    expect(BASELINE_PROJECTS.map((project) => project.name)).toEqual([
      "baseline-desktop-chromium",
      "baseline-phone-chromium",
    ]);
    expect(BASELINE_PROJECTS[0]?.use).toMatchObject({
      browserName: "chromium",
      deviceScaleFactor: 1,
      screen: BASELINE_DESKTOP_VIEWPORT,
      viewport: BASELINE_DESKTOP_VIEWPORT,
    });
    expect(BASELINE_PROJECTS[1]?.use).toMatchObject({
      browserName: "chromium",
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
      screen: BASELINE_PHONE_VIEWPORT,
      viewport: BASELINE_PHONE_VIEWPORT,
    });
  });

  it("starts only non-reused loopback fixture and production frontend servers", () => {
    expect(baselineConfig.webServer).toEqual([
      expect.objectContaining({
        command: "node e2e/rcp34b-baseline-fixture.mjs",
        reuseExistingServer: false,
        url: `${BASELINE_FIXTURE_ORIGIN}/__baseline__/health`,
        env: expect.objectContaining({
          BASELINE_FIXTURE_HOST: "127.0.0.1",
          BASELINE_FIXTURE_PORT: "4318",
          TZ: "UTC",
        }),
      }),
      expect.objectContaining({
        command: "node server.mjs --hostname 127.0.0.1 --port 4317",
        reuseExistingServer: false,
        url: `${BASELINE_FRONTEND_ORIGIN}/healthz`,
        env: expect.objectContaining({
          APP_ENVIRONMENT: "production",
          NEXT_PUBLIC_API_URL: BASELINE_FIXTURE_ORIGIN,
          RECIPE_API_URL: BASELINE_FIXTURE_ORIGIN,
          TZ: "UTC",
        }),
      }),
    ]);
  });
});
