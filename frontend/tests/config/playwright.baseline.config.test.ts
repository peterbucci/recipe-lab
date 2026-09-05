import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

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
  BASELINE_TEST_MATCH,
} from "../../playwright.baseline.config";

const moduleRequire = createRequire(import.meta.url);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

describe("deterministic browser baseline configuration", () => {
  it("pins the installed browser runtime and keeps diagnostics deterministic", () => {
    const playwrightPackage = readJson(
      moduleRequire.resolve("@playwright/test/package.json"),
    ) as { version: string };
    const playwrightCoreRoot = dirname(
      moduleRequire.resolve("playwright-core/package.json"),
    );
    const browserManifest = readJson(
      join(playwrightCoreRoot, "browsers.json"),
    ) as {
      browsers: Array<{ browserVersion?: string; name: string }>;
    };
    const installedChromium = browserManifest.browsers.find(
      ({ name }) => name === "chromium",
    );

    expect(BASELINE_PLAYWRIGHT_VERSION).toBe(playwrightPackage.version);
    expect(BASELINE_CHROMIUM_VERSION).toBe(installedChromium?.browserVersion);
    expect(new Date(BASELINE_CLOCK_ISO).toISOString()).toBe(BASELINE_CLOCK_ISO);
    expect(BASELINE_FRONTEND_ORIGIN).not.toBe(BASELINE_FIXTURE_ORIGIN);
    for (const origin of [BASELINE_FRONTEND_ORIGIN, BASELINE_FIXTURE_ORIGIN]) {
      const url = new URL(origin);
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.protocol).toBe("http:");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
    }

    expect(BASELINE_OUTPUT_DIRECTORY).toMatch(/^test-results\//);
    expect(BASELINE_RESULTS_FILE).toMatch(/^test-results\/.*\.json$/);
    expect(BASELINE_TEST_MATCH).toBe("**/*-baseline.spec.ts");
    expect(BASELINE_SNAPSHOT_TEMPLATE).toContain("/baselines/");
    expect(BASELINE_SNAPSHOT_TEMPLATE).toContain("{projectName}");
    expect(baselineConfig.testDir).toBe("./e2e/visual");
    expect(baselineConfig.testMatch).toBe(BASELINE_TEST_MATCH);
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
    });
    expect(baselineConfig.reporter).toEqual([
      ["line"],
      [
        "./e2e/visual/visual-baseline-reporter.mjs",
        { outputFile: BASELINE_RESULTS_FILE },
      ],
    ]);
  });

  it("covers desktop and touch-phone layouts without mutable device presets", () => {
    const [desktop, phone] = BASELINE_PROJECTS;

    expect(BASELINE_PROJECTS).toHaveLength(2);
    expect(new Set(BASELINE_PROJECTS.map(({ name }) => name)).size).toBe(2);
    expect(BASELINE_DESKTOP_VIEWPORT.width).toBeGreaterThanOrEqual(1_024);
    expect(BASELINE_PHONE_VIEWPORT.width).toBeLessThanOrEqual(480);
    expect(BASELINE_DESKTOP_VIEWPORT.width).toBeGreaterThan(
      BASELINE_PHONE_VIEWPORT.width,
    );
    expect(desktop?.name).toContain("desktop");
    expect(phone?.name).toContain("phone");
    expect(desktop?.use).toMatchObject({
      browserName: "chromium",
      deviceScaleFactor: 1,
      screen: BASELINE_DESKTOP_VIEWPORT,
      viewport: BASELINE_DESKTOP_VIEWPORT,
    });
    expect(phone?.use).toMatchObject({
      browserName: "chromium",
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
      screen: BASELINE_PHONE_VIEWPORT,
      viewport: BASELINE_PHONE_VIEWPORT,
    });
  });

  it("starts only isolated loopback fixture and production frontend servers", () => {
    const servers = Array.isArray(baselineConfig.webServer)
      ? baselineConfig.webServer
      : [baselineConfig.webServer];

    expect(servers).toHaveLength(2);
    for (const server of servers) {
      expect(server?.reuseExistingServer).toBe(false);
      expect(new URL(server?.url ?? "").hostname).toBe("127.0.0.1");
      expect(server?.env).toMatchObject({ TZ: "UTC" });
    }

    expect(servers[0]).toMatchObject({
      command: "node e2e/visual/visual-baseline-fixture.mjs",
      url: `${BASELINE_FIXTURE_ORIGIN}/__baseline__/health`,
      env: {
        BASELINE_FIXTURE_HOST: "127.0.0.1",
        BASELINE_FIXTURE_PORT: new URL(BASELINE_FIXTURE_ORIGIN).port,
        TZ: "UTC",
      },
    });
    expect(servers[1]).toMatchObject({
      command: expect.stringContaining("node server.mjs"),
      url: `${BASELINE_FRONTEND_ORIGIN}/healthz`,
      env: expect.objectContaining({
        APP_ENVIRONMENT: "production",
        NEXT_PUBLIC_API_URL: BASELINE_FIXTURE_ORIGIN,
        RECIPE_API_URL: BASELINE_FIXTURE_ORIGIN,
        TZ: "UTC",
      }),
    });
  });
});
