import { defineConfig, type Project } from "@playwright/test";

export const BASELINE_FRONTEND_ORIGIN = "http://127.0.0.1:4317";
export const BASELINE_FIXTURE_ORIGIN = "http://127.0.0.1:4318";
export const BASELINE_CLOCK_ISO = "2026-08-27T12:00:00.000Z";
export const BASELINE_PLAYWRIGHT_VERSION = "1.62.1";
export const BASELINE_CHROMIUM_VERSION = "151.0.7922.34";
export const BASELINE_OUTPUT_DIRECTORY = "test-results/baseline/artifacts";
export const BASELINE_RESULTS_FILE = "test-results/baseline/results.json";
export const BASELINE_TEST_MATCH = "**/*-baseline.spec.ts";
export const BASELINE_SNAPSHOT_TEMPLATE =
  "{testDir}/../../baselines/{projectName}/{arg}{ext}";

export const BASELINE_DESKTOP_VIEWPORT = Object.freeze({
  width: 1440,
  height: 900,
});
export const BASELINE_PHONE_VIEWPORT = Object.freeze({
  width: 390,
  height: 844,
});

const sharedUse = Object.freeze({
  baseURL: BASELINE_FRONTEND_ORIGIN,
  browserName: "chromium" as const,
  colorScheme: "light" as const,
  deviceScaleFactor: 1,
  locale: "en-US",
  reducedMotion: "reduce" as const,
  screenshot: "off" as const,
  serviceWorkers: "block" as const,
  timezoneId: "UTC",
  trace: "off" as const,
  video: "off" as const,
  launchOptions: {
    headless: true,
    args: ["--disable-lcd-text", "--font-render-hinting=none"],
  },
});

export const BASELINE_PROJECTS: Project[] = [
  {
    name: "baseline-desktop-chromium",
    use: {
      ...sharedUse,
      screen: BASELINE_DESKTOP_VIEWPORT,
      viewport: BASELINE_DESKTOP_VIEWPORT,
    },
  },
  {
    name: "baseline-phone-chromium",
    use: {
      ...sharedUse,
      hasTouch: true,
      isMobile: true,
      screen: BASELINE_PHONE_VIEWPORT,
      viewport: BASELINE_PHONE_VIEWPORT,
    },
  },
];

const publicNetworkSignal = "baseline-baseline-baseline-baseline";

export default defineConfig({
  testDir: "./e2e/visual",
  testMatch: BASELINE_TEST_MATCH,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  repeatEach: 1,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 0,
      scale: "css",
      threshold: 0.1,
    },
  },
  outputDir: BASELINE_OUTPUT_DIRECTORY,
  preserveOutput: "failures-only",
  reporter: [
    ["line"],
    ["./e2e/visual/visual-baseline-reporter.mjs", { outputFile: BASELINE_RESULTS_FILE }],
  ],
  snapshotPathTemplate: BASELINE_SNAPSHOT_TEMPLATE,
  updateSnapshots: "none",
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    ...sharedUse,
  },
  projects: BASELINE_PROJECTS,
  webServer: [
    {
      command: "node e2e/visual/visual-baseline-fixture.mjs",
      url: `${BASELINE_FIXTURE_ORIGIN}/__baseline__/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        BASELINE_FIXTURE_HOST: "127.0.0.1",
        BASELINE_FIXTURE_PORT: "4318",
        TZ: "UTC",
      },
    },
    {
      command: "node server.mjs --hostname 127.0.0.1 --port 4317",
      url: `${BASELINE_FRONTEND_ORIGIN}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        APP_ENVIRONMENT: "production",
        INTERNAL_NETWORK_SIGNAL_SECRET: publicNetworkSignal,
        NEXT_PUBLIC_API_URL: BASELINE_FIXTURE_ORIGIN,
        RECIPE_API_URL: BASELINE_FIXTURE_ORIGIN,
        TZ: "UTC",
      },
    },
  ],
});
