import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  BASELINE_CHROMIUM_VERSION,
  BASELINE_CLOCK_ISO,
  BASELINE_FIXTURE_ORIGIN,
  BASELINE_FRONTEND_ORIGIN,
} from "../playwright.baseline.config";

const DESKTOP_PROJECT = "baseline-desktop-chromium";
const PHONE_PROJECT = "baseline-phone-chromium";
const DRAFT_ID = "30000000-0000-4000-8000-000000000001";
const VARIANT_RECIPE_ID = "20000000-0000-4000-8000-000000000002";
const SAFE_CSRF = "rcp34b-public-csrf";
const REVIEWED_LOOPBACK_PORTS = new Set(["4317", "4318"]);
const blockedNetworkRequests = new WeakMap<BrowserContext, number>();
const BASELINE_FONT = readFileSync(
  resolve(
    process.cwd(),
    "node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  ),
).toString("base64");

interface FixtureAudit {
  accepted_api_requests: number;
  unknown_api_requests: number;
  privacy_rejections: number;
  route_counts: Record<string, number>;
}

async function fixtureRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASELINE_FIXTURE_ORIGIN}${path}`, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

async function setScenario(name: string): Promise<void> {
  const response = await fixtureRequest("/__baseline__/scenario", {
    method: "POST",
    body: name,
  });
  expect(response.ok).toBe(true);
}

async function resetFixture(): Promise<void> {
  const response = await fixtureRequest("/__baseline__/reset", { method: "POST" });
  expect(response.ok).toBe(true);
}

async function readAudit(): Promise<FixtureAudit> {
  const response = await fixtureRequest("/__baseline__/audit");
  expect(response.ok).toBe(true);
  return (await response.json()) as FixtureAudit;
}

async function installFrozenBrowserState(context: BrowserContext): Promise<void> {
  blockedNetworkRequests.set(context, 0);
  await context.route("**/*", async (route) => {
    const destination = new URL(route.request().url());
    const reviewedLoopbackRequest =
      destination.protocol === "http:" &&
      destination.hostname === "127.0.0.1" &&
      REVIEWED_LOOPBACK_PORTS.has(destination.port);
    if (!reviewedLoopbackRequest) {
      blockedNetworkRequests.set(
        context,
        (blockedNetworkRequests.get(context) ?? 0) + 1,
      );
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket(/.*/, async (route) => {
    const destination = new URL(route.url());
    const reviewedLoopbackSocket =
      destination.protocol === "ws:" &&
      destination.hostname === "127.0.0.1" &&
      REVIEWED_LOOPBACK_PORTS.has(destination.port);
    if (!reviewedLoopbackSocket) {
      blockedNetworkRequests.set(
        context,
        (blockedNetworkRequests.get(context) ?? 0) + 1,
      );
      await route.close({ code: 1008, reason: "Blocked by baseline policy" });
      return;
    }
    route.connectToServer();
  });
  await context.addCookies([
    {
      name: "recipe_lab_csrf",
      value: SAFE_CSRF,
      url: BASELINE_FRONTEND_ORIGIN,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(
    ({ fixedTime }) => {
      const NativeDate = Date;
      const timestamp = NativeDate.parse(fixedTime);
      class FrozenDate extends NativeDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) {
            super(timestamp);
          } else {
            super(args[0] as string);
          }
        }

        static now() {
          return timestamp;
        }
      }
      Object.defineProperty(globalThis, "Date", {
        configurable: true,
        value: FrozenDate,
      });
      let uuidSequence = 1;
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: () => {
          const tail = String(uuidSequence).padStart(12, "0");
          uuidSequence += 1;
          return `b0000000-0000-4000-8000-${tail}`;
        },
      });
      Object.defineProperty(Math, "random", {
        configurable: true,
        value: () => 0.343434343434,
      });
    },
    { fixedTime: BASELINE_CLOCK_ISO },
  );
}

async function stabilizeVisuals(page: Page, waitForAccount = true): Promise<void> {
  if (waitForAccount) {
    await expect(
      page.locator('summary[aria-label="Account menu for Baseline Cook"]'),
    ).toBeVisible();
  }
  const families = await page.evaluate(() => ({
    display: getComputedStyle(document.documentElement)
      .getPropertyValue("--display")
      .trim(),
    sans: getComputedStyle(document.documentElement).getPropertyValue("--sans").trim(),
  }));
  const frozenFontInstalled =
    families.display.includes("RCP34B Frozen") && families.sans.includes("RCP34B Frozen");
  if (!frozenFontInstalled) {
    expect(families.display).toContain("Georgia");
    expect(families.sans).toContain("Inter");
    await page.addStyleTag({
      content: `
      @font-face {
        font-family: "RCP34B Frozen";
        src: url(data:font/woff2;base64,${BASELINE_FONT}) format("woff2");
        font-style: normal;
        font-weight: 100 900;
      }
      :root {
        --display: "RCP34B Frozen", sans-serif !important;
        --sans: "RCP34B Frozen", sans-serif !important;
      }
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `,
    });
  }
  await page.evaluate(async () => {
    await document.fonts.load('16px "RCP34B Frozen"');
    await document.fonts.ready;
  });
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
  }));
  expect(result.violations, JSON.stringify(summary, null, 2)).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

type BaselineCaptureOptions = {
  allowedVisibleTechnicalIdentifiers?: readonly string[];
};

async function sanitizeVisibleTechnicalIdentifiers(
  page: Page,
  options: BaselineCaptureOptions = {},
): Promise<void> {
  const visibleTextBeforeSanitizing = await page.locator("body").innerText();
  const visibleTechnicalIdentifiers = [
    ...new Set(
      (visibleTextBeforeSanitizing.match(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      ) ?? []).map((identifier) => identifier.toLowerCase()),
    ),
  ].sort();
  const allowedVisibleTechnicalIdentifiers = [
    ...new Set(
      (options.allowedVisibleTechnicalIdentifiers ?? []).map((identifier) =>
        identifier.toLowerCase(),
      ),
    ),
  ].sort();
  expect(visibleTechnicalIdentifiers).toEqual(allowedVisibleTechnicalIdentifiers);

  await page.evaluate(() => {
    const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeValue) {
        node.nodeValue = node.nodeValue.replace(uuidPattern, "Synthetic identifier withheld");
      }
      node = walker.nextNode();
    }
  });
  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  );
}

async function captureBaseline(
  page: Page,
  name: string,
  options: BaselineCaptureOptions = {},
): Promise<void> {
  await sanitizeVisibleTechnicalIdentifiers(page, options);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
  await expect(page).toHaveScreenshot(`${name}.png`);
}

function desktopOnly(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, "Desktop-only evidence.");
}

function phoneOnly(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== PHONE_PROJECT, "Phone-only evidence.");
}

test.beforeEach(async ({ browser, context }) => {
  expect(browser.version()).toBe(BASELINE_CHROMIUM_VERSION);
  await resetFixture();
  await installFrozenBrowserState(context);
});

test.afterEach(async ({ context }) => {
  const audit = await readAudit();
  try {
    expect(
      blockedNetworkRequests.get(context) ?? 0,
      "The sanitized baseline browser attempted a non-loopback network request.",
    ).toBe(0);
    expect(audit.unknown_api_requests, JSON.stringify(audit)).toBe(0);
    expect(audit.privacy_rejections, JSON.stringify(audit)).toBe(0);
  } finally {
    await resetFixture();
  }
});

test.describe("desktop visual state matrix", () => {
  test.beforeEach(async ({}, testInfo) => desktopOnly(testInfo));

  test("home normal", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Recipes change. Recipe Lab keeps track." })).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "home-normal");
  });

  test("home and account navigation normal", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Recipes change. Recipe Lab keeps track." })).toBeVisible();
    await stabilizeVisuals(page);
    const account = page.locator('summary[aria-label="Account menu for Baseline Cook"]');
    await account.focus();
    await expect(account).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "My recipes" })).toBeVisible();
    await captureBaseline(page, "home-account-navigation");
  });

  test("catalog normal", async ({ page }) => {
    await page.goto("/recipes");
    await expect(page.getByRole("heading", { name: /Find something to cook/i })).toBeVisible();
    await expect(page.getByRole("article", { name: "Garden Cream Tomato Soup" })).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "catalog-normal");
  });

  test("catalog empty", async ({ page }) => {
    await page.goto("/recipes?q=No%20baseline%20matches");
    await expect(page.getByRole("heading", { name: /No recipes matched/i })).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "catalog-empty");
  });

  test("recipe detail normal", async ({ page }) => {
    await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
    await expect(page.getByRole("heading", { name: "Garden Cream Tomato Soup", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Save and rate this recipe" })).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-detail-normal");

    const history = page.getByRole("heading", { name: "Recipe history", level: 2 });
    await history.evaluate((heading) => heading.scrollIntoView({ block: "start" }));
    await expect(history).toBeInViewport();
    await captureBaseline(page, "recipe-detail-history");
  });

  test("recipe comparison normal", async ({ page }) => {
    await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
    await expect(
      page.getByRole("heading", { name: "What changed in Garden Cream Tomato Soup", level: 1 }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-comparison-normal");
  });

  test("my recipes normal", async ({ page }) => {
    await page.goto("/account/recipes");
    await expect(page.getByRole("list", { name: "My recipes" })).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "my-recipes-normal");
  });

  test("draft editor validation", async ({ page }) => {
    await setScenario("incomplete-draft");
    await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
    await expect(page.getByLabel("Title")).toBeVisible();
    await stabilizeVisuals(page);
    await page.getByRole("checkbox", { name: /agree to the community rules/i }).check();
    await page.getByRole("checkbox", { name: /right to share it/i }).check();
    const review = page.getByRole("button", { name: "Review and publish", exact: true });
    await review.focus();
    await page.keyboard.press("Enter");
    const alert = page.getByRole("alert").filter({ hasText: /Your draft was not saved/i });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await alert.scrollIntoViewIfNeeded();
    await captureBaseline(page, "draft-editor-validation");
  });

  test("draft similarity and publication review", async ({ page }) => {
    await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
    await expect(page.getByLabel("Title")).toHaveValue("Late-Summer Tomato Pot");
    await stabilizeVisuals(page);
    await page.getByRole("checkbox", { name: /agree to the community rules/i }).check();
    await page.getByRole("checkbox", { name: /right to share it/i }).check();
    await page.getByRole("button", { name: "Review and publish", exact: true }).click();
    const publishAnyway = page.getByRole("button", { name: "Publish recipe anyway" });
    await expect(publishAnyway).toBeVisible();
    await publishAnyway.scrollIntoViewIfNeeded();
    await captureBaseline(page, "draft-similarity-publication-review");
  });

  test("ingredient request staff review", async ({ page }) => {
    await page.goto("/catalog/ingredient-requests");
    await expect(page.getByRole("heading", { name: "Sunberry tomato", level: 2 })).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "ingredient-request-staff-review", {
      allowedVisibleTechnicalIdentifiers: ["70000000-0000-4000-8000-000000000001"],
    });
  });

  test("recipe moderation staff review", async ({ page }) => {
    await page.goto("/moderation/recipes");
    await expect(page.getByRole("heading", { name: "Sunlit Tomato Soup", level: 2 })).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-moderation-staff-review");
  });

  test("private workspace loading", async ({ page }) => {
    await setScenario("slow-session");
    await page.goto("/account/recipes", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Checking your account…" })).toBeVisible();
    await stabilizeVisuals(page, false);
    await captureBaseline(page, "private-workspace-loading");
  });

  test("private workspace failure", async ({ page }) => {
    await setScenario("library-failure");
    await page.goto("/account/recipes");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Recipe Lab could not load your recipes. Please try again." }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "private-workspace-failure");
  });

  test("private workspace expired session", async ({ page }) => {
    await setScenario("expired-library");
    await page.goto("/account/recipes");
    await expect(
      page.getByRole("alert", { name: "Your session expired. Your work is still here." }),
    ).toBeVisible();
    await stabilizeVisuals(page, false);
    await captureBaseline(page, "private-workspace-expired-session");
  });
});

test.describe("phone visual state matrix", () => {
  test.beforeEach(async ({}, testInfo) => phoneOnly(testInfo));

  test("home normal", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Recipes change. Recipe Lab keeps track." })).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "home-normal");
  });

  test("home and account navigation normal", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Recipes change. Recipe Lab keeps track." })).toBeVisible();
    await stabilizeVisuals(page);
    const account = page.locator('summary[aria-label="Account menu for Baseline Cook"]');
    await account.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "My recipes" })).toBeVisible();
    await captureBaseline(page, "home-account-navigation");
  });

  test("catalog normal", async ({ page }) => {
    await page.goto("/recipes");
    await expect(page.getByRole("article", { name: "Garden Cream Tomato Soup" })).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "catalog-normal");
  });

  test("recipe detail normal", async ({ page }) => {
    await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
    await expect(page.getByRole("heading", { name: "Garden Cream Tomato Soup", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Save and rate this recipe" })).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-detail-normal");

    const history = page.getByRole("heading", { name: "Recipe history", level: 2 });
    await history.evaluate((heading) => heading.scrollIntoView({ block: "start" }));
    await expect(history).toBeInViewport();
    await captureBaseline(page, "recipe-detail-history");
  });

  test("draft editor validation", async ({ page }) => {
    await setScenario("incomplete-draft");
    await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
    await expect(page.getByLabel("Title")).toBeVisible();
    await stabilizeVisuals(page);
    await page.getByRole("checkbox", { name: /agree to the community rules/i }).check();
    await page.getByRole("checkbox", { name: /right to share it/i }).check();
    const review = page.getByRole("button", { name: "Review and publish", exact: true });
    await review.focus();
    await page.keyboard.press("Enter");
    const alert = page.getByRole("alert").filter({ hasText: /Your draft was not saved/i });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await alert.scrollIntoViewIfNeeded();
    await captureBaseline(page, "draft-editor-validation");
  });
});

test("keyboard account-to-private-workspace journey", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Recipes change. Recipe Lab keeps track." })).toBeVisible();
  await stabilizeVisuals(page);
  const account = page.locator('summary[aria-label="Account menu for Baseline Cook"]');
  await account.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Public profile" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "My recipes" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${BASELINE_FRONTEND_ORIGIN}/account/recipes`);
  await expect(page.getByRole("list", { name: "My recipes" })).toBeVisible();
  await stabilizeVisuals(page);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
});

test("fixture API routes and private headers fail closed", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  const unknown = await page.request.get("/api/private-route-canary");
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()["cache-control"]).toBe("no-store");
  expect(await unknown.json()).toEqual({
    error: {
      code: "baseline_route_not_reviewed",
      message: "The fixture route is not available.",
      issues: [],
      correlation_id: "a0000000-0000-4000-8000-000000000001",
    },
  });

  const privateHeaderCanary = "Bearer private-header-canary";
  const rejected = await page.request.get("/api/auth/session", {
    headers: { Authorization: privateHeaderCanary },
  });
  expect(rejected.status()).toBe(400);
  const rejectedBody = await rejected.text();
  expect(rejectedBody).not.toContain(privateHeaderCanary);
  expect(rejectedBody).toContain("baseline_private_material_rejected");

  const audit = await readAudit();
  expect(audit.unknown_api_requests).toBe(1);
  expect(audit.privacy_rejections).toBe(1);
  expect(audit.route_counts).toEqual({});
  await resetFixture();
});

test("browser HTTP and WebSocket egress fail closed", async ({ context, page }, testInfo) => {
  desktopOnly(testInfo);
  const blocked = await page.evaluate(async () => {
    const http = await fetch("https://baseline.invalid/http-canary")
      .then(() => false)
      .catch(() => true);
    const websocket = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket("wss://baseline.invalid/websocket-canary");
      const timeout = setTimeout(() => {
        socket.close();
        resolve(false);
      }, 2_000);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        socket.close();
        resolve(false);
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        resolve(true);
      });
      socket.addEventListener("close", () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
    return { http, websocket };
  });

  expect(blocked).toEqual({ http: true, websocket: true });
  expect(blockedNetworkRequests.get(context)).toBe(2);
  blockedNetworkRequests.set(context, 0);
});
