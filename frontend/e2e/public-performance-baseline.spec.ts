import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  assertPerformanceBaselineDocument,
  assertPrivacySafeAggregate,
  buildPerformanceBaselineCandidate,
  buildPerformanceObservation,
  performanceBudgetViolations,
  type BrowserRouteLabel,
  type BrowserSample,
  type PerformanceBaselineDocument,
  type ServiceRouteLabel,
  type ServiceSample,
} from "../performance/public-performance-baseline";

interface BrowserPerformanceState {
  lcp_ms: number;
  cls: number;
  long_task_total_ms: number;
}

declare global {
  interface Window {
    __recipeLabPublicPerformance?: BrowserPerformanceState;
  }
}

interface BrowserRouteTarget {
  label: BrowserRouteLabel;
  path: string;
  ready: (page: Page) => Locator;
}

interface ServiceRouteTarget {
  label: ServiceRouteLabel;
  path: string;
}

class PrivacySafePerformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacySafePerformanceError";
  }
}

const performanceRequested = process.env.RCP34B_PERFORMANCE === "1";
const performanceEnvironmentReady =
  process.env.MVP_ACCEPTANCE === "1" &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const EXPECTED_NODE_VERSION = "v22.23.2";
const EXPECTED_CHROMIUM_VERSION = "151.0.7922.34";
const frontendRoot = process.cwd();

async function committedBaseline(): Promise<PerformanceBaselineDocument> {
  const value: unknown = JSON.parse(
    await readFile(
      resolve(frontendRoot, "../docs/baselines/rcp-34b-public-performance.json"),
      "utf8",
    ),
  );
  assertPerformanceBaselineDocument(value);
  return value;
}

function performanceMode(): "capture" | "check" {
  const value = process.env.RCP34B_PERFORMANCE_MODE ?? "check";
  if (value !== "capture" && value !== "check") {
    throw new Error("RCP34B_PERFORMANCE_MODE must be capture or check.");
  }
  return value;
}

async function installBrowserObservers(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    const state: BrowserPerformanceState = {
      lcp_ms: 0,
      cls: 0,
      long_task_total_ms: 0,
    };
    Object.defineProperty(window, "__recipeLabPublicPerformance", {
      value: state,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    const observe = (
      type: string,
      consume: (entry: PerformanceEntry) => void,
    ): void => {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            consume(entry);
          }
        });
        observer.observe({ type, buffered: true });
      } catch {
        // Chromium supports these entry types; unsupported engines leave the signal at zero.
      }
    };

    observe("largest-contentful-paint", (entry) => {
      state.lcp_ms = Math.max(state.lcp_ms, entry.startTime);
    });
    observe("layout-shift", (entry) => {
      const shift = entry as PerformanceEntry & {
        value?: number;
        hadRecentInput?: boolean;
      };
      if (!shift.hadRecentInput && typeof shift.value === "number") {
        state.cls += shift.value;
      }
    });
    observe("longtask", (entry) => {
      state.long_task_total_ms += entry.duration;
    });
  });
}

async function navigateWithoutReportedLocation(page: Page, destination: string): Promise<void> {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
  if (!baseUrl) {
    throw new PrivacySafePerformanceError("The guarded frontend origin is required.");
  }
  const absoluteDestination = new URL(destination, baseUrl).toString();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    page.evaluate((nextLocation) => window.location.assign(nextLocation), absoluteDestination),
  ]);
}

async function serviceSamples(
  page: Page,
  targets: ServiceRouteTarget[],
  baseline: PerformanceBaselineDocument,
): Promise<ServiceSample[]> {
  const samples: ServiceSample[] = [];
  const { warmup_runs_per_route: warmups, measured_runs_per_route: measured } =
    baseline.protocol.service;

  for (const target of targets) {
    for (let run = 0; run < warmups + measured; run += 1) {
      const result = await page.evaluate(async (destination) => {
        const started = performance.now();
        const response = await fetch(destination, {
          cache: "no-store",
          credentials: "omit",
        });
        await response.arrayBuffer();
        return {
          status: response.status,
          latency_ms: performance.now() - started,
        };
      }, target.path);
      expect(result.status, `${target.label} proxy status`).toBe(200);
      if (run >= warmups) {
        samples.push({ route: target.label, latency_ms: result.latency_ms });
      }
    }
  }
  return samples;
}

async function browserSample(page: Page, target: BrowserRouteTarget): Promise<BrowserSample> {
  await navigateWithoutReportedLocation(page, target.path);
  await target.ready(page).waitFor({ state: "visible" });

  const measurement = await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const responsivenessDelays: number[] = [];
    for (let probe = 0; probe < 8; probe += 1) {
      const started = performance.now();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      responsivenessDelays.push(performance.now() - started);
    }
    responsivenessDelays.sort((left, right) => left - right);

    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const state = window.__recipeLabPublicPerformance;
    if (!navigation || !state) {
      throw new Error("Browser performance observers were not initialized.");
    }

    const decodedJsBytes = (
      performance.getEntriesByType("resource") as PerformanceResourceTiming[]
    )
      .filter((entry) => entry.initiatorType === "script")
      .reduce((total, entry) => total + entry.decodedBodySize, 0);

    return {
      navigation_ms:
        navigation.loadEventEnd > 0 ? navigation.loadEventEnd : navigation.duration,
      lcp_ms: state.lcp_ms,
      cls: state.cls,
      long_task_total_ms: state.long_task_total_ms,
      responsiveness_ms:
        responsivenessDelays[Math.ceil(responsivenessDelays.length * 0.95) - 1] ?? 0,
      decoded_js_bytes: decodedJsBytes,
    };
  });

  for (const [signal, value] of Object.entries(measurement)) {
    expect(Number.isFinite(value) && value >= 0, `${target.label}.${signal}`).toBe(true);
  }
  expect(measurement.navigation_ms, `${target.label}.navigation_ms`).toBeGreaterThan(0);
  expect(measurement.lcp_ms, `${target.label}.lcp_ms`).toBeGreaterThan(0);
  expect(measurement.responsiveness_ms, `${target.label}.responsiveness_ms`).toBeGreaterThan(0);
  expect(measurement.decoded_js_bytes, `${target.label}.decoded_js_bytes`).toBeGreaterThan(0);
  return { route: target.label, ...measurement };
}

async function browserSamples(
  page: Page,
  targets: BrowserRouteTarget[],
  baseline: PerformanceBaselineDocument,
): Promise<BrowserSample[]> {
  const samples: BrowserSample[] = [];
  const {
    warmup_navigations_per_route: warmups,
    measured_navigations_per_route: measured,
  } = baseline.protocol.browser;

  for (const target of targets) {
    for (let run = 0; run < warmups + measured; run += 1) {
      const sample = await browserSample(page, target);
      if (run >= warmups) {
        samples.push(sample);
      }
    }
  }
  return samples;
}

async function writeAggregateFile(name: string, value: unknown): Promise<string> {
  const outputDirectory = resolve(frontendRoot, "test-results");
  const outputPath = resolve(outputDirectory, name);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return outputPath;
}

test.describe("RCP-34B public performance baseline", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    !performanceRequested,
    "Public performance checks require an explicit RCP34B_PERFORMANCE request.",
  );

  test("captures privacy-safe aggregates and checks headroom budgets", async ({ browser, page }, testInfo) => {
    test.setTimeout(180_000);
    let stage = "initialize";
    try {
      if (!performanceEnvironmentReady) {
        throw new PrivacySafePerformanceError(
          "The explicitly requested performance check requires the isolated MVP stack.",
        );
      }
      expect(process.version, "pinned Node.js runtime").toBe(EXPECTED_NODE_VERSION);
      expect(browser.version(), "pinned Chromium runtime").toBe(
        EXPECTED_CHROMIUM_VERSION,
      );
      const baseline = await committedBaseline();
      const mode = performanceMode();
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.context().clearCookies();
      await installBrowserObservers(page);

      stage = "discover_public_detail";
      await navigateWithoutReportedLocation(page, "/recipes?q=carrot");
      const recipeLink = page
        .getByRole("article", { name: "Carrot Walnut Snack Cake", exact: true })
        .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true });
      const recipePath = await recipeLink.getAttribute("href");
      if (!recipePath || !/^\/recipes\/[0-9a-f-]{36}$/i.test(recipePath)) {
        throw new Error("The deterministic public recipe detail route was unavailable.");
      }

      stage = "measure_public_proxies";
      const measuredServiceSamples = await serviceSamples(
        page,
        [
          {
            label: "public_recipe_catalog_proxy",
            path: "/api/recipes?page=1&page_size=12&q=carrot",
          },
          {
            label: "public_recipe_detail_proxy",
            path: `/api${recipePath}`,
          },
        ],
        baseline,
      );
      stage = "measure_public_browser_routes";
      const measuredBrowserSamples = await browserSamples(
        page,
        [
          {
            label: "public_home",
            path: "/",
            ready: (currentPage) =>
              currentPage.getByRole("heading", {
                name: "Recipes change. Recipe Lab keeps track.",
                level: 1,
              }),
          },
          {
            label: "public_recipe_catalog",
            path: "/recipes?q=carrot",
            ready: (currentPage) =>
              currentPage.getByRole("heading", { name: /results for “carrot”/i }),
          },
          {
            label: "public_recipe_detail",
            path: recipePath,
            ready: (currentPage) =>
              currentPage.getByRole("heading", {
                name: "Carrot Walnut Snack Cake",
                level: 1,
              }),
          },
        ],
        baseline,
      );

      stage = "aggregate_public_metrics";
      const observation = buildPerformanceObservation(
        baseline,
        measuredServiceSamples,
        measuredBrowserSamples,
      );
      assertPrivacySafeAggregate(observation);

      const outputName =
        mode === "capture"
          ? "rcp-34b-public-performance-baseline-candidate.json"
          : "rcp-34b-public-performance-observation.json";
      const output =
        mode === "capture"
          ? buildPerformanceBaselineCandidate(observation, baseline.database_routes)
          : observation;
      stage = "write_privacy_safe_aggregate";
      const outputPath = await writeAggregateFile(outputName, output);
      await testInfo.attach(outputName, {
        path: outputPath,
        contentType: "application/json",
      });

      if (mode === "check") {
        stage = "check_public_budgets";
        const violations = performanceBudgetViolations(observation, baseline);
        if (violations.length > 0) {
          throw new PrivacySafePerformanceError(
            `Performance budgets exceeded:\n${violations.join("\n")}`,
          );
        }
      }
    } catch (reason) {
      if (!page.isClosed()) {
        await page.close().catch(() => undefined);
      }
      if (reason instanceof PrivacySafePerformanceError) {
        throw reason;
      }
      throw new PrivacySafePerformanceError(
        `Public performance measurement failed at ${stage}.`,
      );
    }
  });
});
