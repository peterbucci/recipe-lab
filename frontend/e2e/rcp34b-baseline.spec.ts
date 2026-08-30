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
import {
  RCP46F_STAFF_ROUTES,
  RCP46F_STAFF_STATE_MATRIX,
  RCP46F_STAFF_VIEWPORTS,
  type Rcp46fStaffMatrixCase,
  type Rcp46fStaffRole,
} from "./rcp46f-staff-certification-matrix";

const DESKTOP_PROJECT = "baseline-desktop-chromium";
const PHONE_PROJECT = "baseline-phone-chromium";
const REVIEWED_SHELL_VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "intermediate", width: 820, height: 1_000 },
  { label: "phone", width: 390, height: 844 },
] as const;
const DRAFT_ID = "30000000-0000-4000-8000-000000000001";
const GRAM_UNIT_ID = "50000000-0000-4000-8000-000000000001";
const PRIVATE_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const PRIVATE_CURATOR_ID = "10000000-0000-4000-8000-000000000003";
const PRIVATE_MODERATOR_ID = "10000000-0000-4000-8000-000000000004";
const PRIVATE_ONBOARDING_ID = "10000000-0000-4000-8000-000000000005";
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

async function fixtureRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
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
  const response = await fixtureRequest("/__baseline__/reset", {
    method: "POST",
  });
  expect(response.ok).toBe(true);
}

async function readAudit(): Promise<FixtureAudit> {
  const response = await fixtureRequest("/__baseline__/audit");
  expect(response.ok).toBe(true);
  return (await response.json()) as FixtureAudit;
}

async function installFrozenBrowserState(
  context: BrowserContext,
): Promise<void> {
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

async function stabilizeVisuals(
  page: Page,
  waitForAccount = true,
): Promise<void> {
  if (new URL(page.url()).pathname.startsWith("/account/recipe-drafts/")) {
    await expect(
      page.getByRole("group", { name: "Curated recipe categories" }),
    ).toBeVisible();
  }
  if (waitForAccount) {
    await expect(
      page.locator('summary[aria-label^="Account menu for "]'),
    ).toBeVisible();
  }
  const families = await page.evaluate(() => ({
    display: getComputedStyle(document.documentElement)
      .getPropertyValue("--display")
      .trim(),
    sans: getComputedStyle(document.documentElement)
      .getPropertyValue("--sans")
      .trim(),
  }));
  const frozenFontInstalled =
    families.display.includes("RCP34B Frozen") &&
    families.sans.includes("RCP34B Frozen");
  if (!frozenFontInstalled) {
    expect(families.display).toContain("Inter");
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

async function expectHomepageDashboardReady(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Continue where you left off" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue draft" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Featured recipes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Explore by category" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "From the community" }),
  ).toBeVisible();
  await expect(
    page.locator(".member-home-summary__metrics [role='status']"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Recent account activity" }),
  ).toBeVisible();
}

async function expectHomepagePublicDiscoveryReady(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Featured recipes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Explore by category" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "From the community" }),
  ).toBeVisible();
}

async function expectNoVisiblePrivateMaterial(page: Page): Promise<void> {
  const visibleText = await page.locator("body").innerText();
  for (const identifier of [
    PRIVATE_ACCOUNT_ID,
    PRIVATE_CURATOR_ID,
    PRIVATE_MODERATOR_ID,
    PRIVATE_ONBOARDING_ID,
  ]) {
    expect(visibleText).not.toContain(identifier);
    expect(page.url()).not.toContain(identifier);
  }
  expect(visibleText).not.toContain(SAFE_CSRF);
  expect(visibleText).not.toMatch(/\bBearer\s+[A-Za-z0-9._~-]+/i);
  expect(visibleText).not.toMatch(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  );
  expect(page.url()).not.toContain(SAFE_CSRF);
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
      (
        visibleTextBeforeSanitizing.match(
          /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
        ) ?? []
      ).map((identifier) => identifier.toLowerCase()),
    ),
  ].sort();
  const allowedVisibleTechnicalIdentifiers = [
    ...new Set(
      (options.allowedVisibleTechnicalIdentifiers ?? []).map((identifier) =>
        identifier.toLowerCase(),
      ),
    ),
  ].sort();
  expect(visibleTechnicalIdentifiers).toEqual(
    allowedVisibleTechnicalIdentifiers,
  );

  await page.evaluate(() => {
    const uuidPattern =
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    let node = walker.nextNode();
    while (node) {
      if (node.nodeValue) {
        node.nodeValue = node.nodeValue.replace(
          uuidPattern,
          "Synthetic identifier withheld",
        );
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
  test.skip(
    testInfo.project.name !== DESKTOP_PROJECT,
    "Desktop-only evidence.",
  );
}

function phoneOnly(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== PHONE_PROJECT, "Phone-only evidence.");
}

function otherStaffRole(role: Rcp46fStaffRole): Rcp46fStaffRole {
  return role === "curator" ? "moderator" : "curator";
}

async function expectRoleSpecificStaffNavigation(
  page: Page,
  role: Rcp46fStaffRole,
): Promise<void> {
  const account = page.locator('summary[aria-label^="Account menu for "]');
  await account.click();
  await expect(
    page.getByRole("link", {
      name: RCP46F_STAFF_ROUTES[role].navigationLabel,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: RCP46F_STAFF_ROUTES[otherStaffRole(role)].navigationLabel,
      exact: true,
    }),
  ).toHaveCount(0);
  await account.click();
}

async function certifyStaffState(
  page: Page,
  waitForAccount = true,
): Promise<void> {
  await stabilizeVisuals(page, waitForAccount);
  await expectNoVisiblePrivateMaterial(page);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
}

async function expectNormalStaffWorkspace(
  page: Page,
  role: Rcp46fStaffRole,
): Promise<void> {
  if (role === "curator") {
    await expect(page.locator("main.staff-workspace--curation")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sunberry tomato", level: 2 }),
    ).toBeVisible();
  } else {
    await expect(page.locator("main.staff-workspace--moderation")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sunlit Tomato Soup", level: 2 }),
    ).toBeVisible();
  }
  await expectRoleSpecificStaffNavigation(page, role);
}

async function enterCuratorDecision(page: Page): Promise<void> {
  await page.getByLabel("Reviewed canonical name").fill("Sunberry tomato");
  await page
    .getByLabel("Decision reason")
    .fill("The reviewed catalog evidence supports this synthetic decision.");
  await page
    .getByLabel("Approval provenance")
    .fill("Synthetic RCP-46F curator certification evidence.");
}

async function submitStaleCuratorDecision(page: Page) {
  await enterCuratorDecision(page);
  await page.getByRole("button", { name: "Save approve decision" }).click();
  const alert = page.getByRole("alert").filter({
    hasText:
      "This request or its catalog matches changed while you were reviewing it.",
  });
  await expect(alert).toBeVisible();
  await expect(page.getByLabel("Decision reason")).toHaveValue(
    "The reviewed catalog evidence supports this synthetic decision.",
  );
  await expect(page.getByLabel("Approval provenance")).toHaveValue(
    "Synthetic RCP-46F curator certification evidence.",
  );
  return alert;
}

async function retryStaleCuratorDecision(page: Page): Promise<void> {
  const refresh = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname ===
        "/api/ingredient-requests/70000000-0000-4000-8000-000000000001/review" &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Load current request" }).click();
  await refresh;
  await expect(page.getByLabel("Decision reason")).toHaveValue(
    "The reviewed catalog evidence supports this synthetic decision.",
  );

  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        "/api/ingredient-requests/70000000-0000-4000-8000-000000000001/review",
  );
  await page.getByRole("button", { name: "Save approve decision" }).click();
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByRole("status").filter({ hasText: "Decision saved." }),
  ).toBeVisible();
}

async function exerciseStaffMatrixCase(
  page: Page,
  matrixCase: Rcp46fStaffMatrixCase,
): Promise<void> {
  const route = RCP46F_STAFF_ROUTES[matrixCase.routeRole];
  const auditBefore = await readAudit();
  const deniedRouteCountBefore = auditBefore.route_counts[route.apiRouteLabel] ?? 0;
  const authorizationDeniedCountBefore =
    auditBefore.route_counts[route.authorizationDeniedApiRouteLabel] ?? 0;
  await page.goto(route.path, {
    waitUntil: matrixCase.id === "curator-loading" ? "domcontentloaded" : "load",
  });

  switch (matrixCase.id) {
    case "curator-normal":
    case "moderator-normal":
      await expectNormalStaffWorkspace(page, matrixCase.sessionRole);
      await certifyStaffState(page);
      return;
    case "curator-loading":
      await expect(
        page.getByRole("status").filter({ hasText: "Checking review access…" }),
      ).toBeVisible();
      await certifyStaffState(page, false);
      return;
    case "moderator-error-retry":
      await expect(
        page.getByRole("alert").filter({
          hasText: "The recipe-report queue could not be loaded.",
        }),
      ).toBeVisible();
      await certifyStaffState(page);
      await page.getByRole("button", { name: "Retry queue" }).click();
      await expect(
        page.getByRole("heading", { name: "Sunlit Tomato Soup", level: 2 }),
      ).toBeVisible();
      await certifyStaffState(page);
      return;
    case "curator-empty":
      await expect(page.getByText("No pending requests.", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Choose a request", level: 2 }),
      ).toBeVisible();
      await certifyStaffState(page);
      return;
    case "moderator-detail-not-found":
      await expect(
        page.getByRole("alert").filter({
          hasText: "This moderation case could not be loaded.",
        }),
      ).toBeVisible();
      await certifyStaffState(page);
      return;
    case "curator-cannot-open-moderation":
    case "moderator-cannot-open-curation": {
      await expect(
        page.getByRole("heading", { name: "We couldn’t find that page.", level: 1 }),
      ).toBeVisible();
      await expect(page.getByText("Sunberry tomato", { exact: true })).toHaveCount(0);
      await expect(
        page.getByText("Repeated promotional links in the public description.", {
          exact: true,
        }),
      ).toHaveCount(0);
      const auditAfter = await readAudit();
      const deniedRouteCountAfter = auditAfter.route_counts[route.apiRouteLabel] ?? 0;
      const authorizationDeniedCountAfter =
        auditAfter.route_counts[route.authorizationDeniedApiRouteLabel] ?? 0;
      expect(deniedRouteCountAfter).toBe(deniedRouteCountBefore);
      expect(authorizationDeniedCountAfter).toBe(
        authorizationDeniedCountBefore,
      );
      await certifyStaffState(page);
      return;
    }
    case "curator-stale-retry":
      await expectNormalStaffWorkspace(page, "curator");
      await submitStaleCuratorDecision(page);
      await certifyStaffState(page);
      await retryStaleCuratorDecision(page);
      await certifyStaffState(page);
      return;
    default:
      throw new Error(`Unhandled RCP-46F staff matrix case: ${matrixCase.id}`);
  }
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

test.describe("RCP-46F staff route and state width sweep", () => {
  for (const matrixCase of RCP46F_STAFF_STATE_MATRIX) {
    test(matrixCase.id, async ({ page }, testInfo) => {
      desktopOnly(testInfo);
      for (const viewport of RCP46F_STAFF_VIEWPORTS) {
        await test.step(viewport.label, async () => {
          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          });
          await setScenario(matrixCase.scenario);
          await exerciseStaffMatrixCase(page, matrixCase);
        });
      }
    });
  }
});

test("staff fixture APIs enforce the separate role capabilities", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);

  await setScenario("curator-session");
  const moderatorDenied = await page.request.get(
    "/api/moderation/recipe-reports?status=open&page=1&page_size=20",
  );
  expect(moderatorDenied.status()).toBe(403);
  const moderatorDeniedBody = await moderatorDenied.text();
  expect(moderatorDeniedBody).toContain("baseline_staff_authorization_required");
  expect(moderatorDeniedBody).not.toContain("Repeated promotional links");

  await setScenario("moderator-session");
  const curatorDenied = await page.request.get(
    "/api/ingredient-requests?status=pending&page=1&page_size=20",
  );
  expect(curatorDenied.status()).toBe(403);
  const curatorDeniedBody = await curatorDenied.text();
  expect(curatorDeniedBody).toContain("baseline_staff_authorization_required");
  expect(curatorDeniedBody).not.toContain("Sunberry tomato");
});

test("application shell preserves real navigation at reviewed widths", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);

  for (const viewport of REVIEWED_SHELL_VIEWPORTS) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.goto("/");
      await expect(
        page.getByRole("heading", {
          name: "Recipes change. Recipe Lab keeps track.",
        }),
      ).toBeVisible();
      await stabilizeVisuals(page);

      const header = page.getByRole("banner");
      const brand = header.getByRole("link", { name: "Recipe Lab home" });
      const catalog = page.locator('a[href="/recipes"]').filter({ visible: true }).first();
      const account = header.locator('summary[aria-label^="Account menu for "]');

      await expect(header).toBeVisible();
      await expect(brand).toBeVisible();
      await expect(catalog).toBeVisible();
      await expect(account).toBeVisible();

      const shellBoxes = await Promise.all([
        header.boundingBox(),
        brand.boundingBox(),
        catalog.boundingBox(),
        account.boundingBox(),
      ]);
      for (const box of shellBoxes) {
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.height).toBeGreaterThan(0);
        expect(box!.x).toBeGreaterThanOrEqual(-0.5);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
      }

      await expect(
        header.getByRole("button", { name: "Notifications", exact: true }),
      ).toHaveCount(0);
      await expect(
        header.getByLabel("Search recipes, ingredients, or members", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

    });
  }
});

test("recipe discovery reflows without hiding results at reviewed widths", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);

  const expectedColumns = {
    desktop: 4,
    intermediate: 3,
    phone: 2,
  } as const;

  for (const viewport of REVIEWED_SHELL_VIEWPORTS) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await expect(
        page
          .getByRole("search", { name: "Search recipes from the home page" })
          .getByRole("searchbox", { name: "Search by recipe name" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/recipes");
      const results = page.getByRole("list", { name: "Recipe results" });
      await expect(results).toHaveCount(1);
      const cards = results.getByRole("article");
      await expect(cards.first()).toBeVisible();
      const cardCount = await cards.count();
      expect(cardCount).toBe(3);
      for (let index = 0; index < cardCount; index += 1) {
        await expect(cards.nth(index)).toBeVisible();
      }

      const columns = await results.evaluate((grid) =>
        getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      );
      expect(columns).toBe(expectedColumns[viewport.label]);
      await expect(page.getByText(/^original$/i)).toHaveCount(0);
      await expect(page.getByText(/^version \d+$/i)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/recipes?category=lunch");
      await expect(
        page.getByRole("heading", { name: "Lunch recipes" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Clear category" }),
      ).toHaveAttribute("href", "/recipes");
      const categoryResults = page.getByRole("list", { name: "Recipe results" });
      await expect(categoryResults).toBeVisible();
      await expect(
        categoryResults.getByRole("link", { name: "Sunlit Tomato Soup" }),
      ).toBeVisible();
      await expect(
        categoryResults.getByRole("link", { name: "Garden Cream Tomato Soup" }),
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);
    });
  }
});

test("anonymous homepage discovery never requests private member data", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await setScenario("anonymous-session");
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Featured recipes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Explore by category" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "From the community" }),
  ).toBeVisible();
  await expect(page.locator(".member-home-summary")).toHaveCount(0);

  const audit = await readAudit();
  expect(audit.route_counts["my-recipes"] ?? 0).toBe(0);
  expect(audit.route_counts["saved-recipes"] ?? 0).toBe(0);
  expect(audit.route_counts["member-ingredient-requests"] ?? 0).toBe(0);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
});

test("homepage keeps public discovery usable through account and section recovery states", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);

  await test.step("account loading", async () => {
    await setScenario("slow-session");
    await page.goto("/");
    await expectHomepagePublicDiscoveryReady(page);
    await expect(page.locator(".member-home-summary")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  await test.step("account error and recovery", async () => {
    await setScenario("auth-error");
    await page.goto("/");
    await expectHomepagePublicDiscoveryReady(page);
    await expect(page.getByRole("button", { name: "Retry account" })).toBeVisible();
    await expect(page.locator(".member-home-summary")).toHaveCount(0);

    await setScenario("normal");
    await page.getByRole("button", { name: "Retry account" }).click();
    await expectHomepageDashboardReady(page);
  });

  await test.step("honest empty state", async () => {
    await setScenario("homepage-empty");
    await page.reload();
    await expect(page.getByText("You have no active drafts right now.")).toBeVisible();
    await expect(page.getByText("No recipes are featured right now.")).toBeVisible();
    await expect(page.getByText("There are no active categories yet.")).toBeVisible();
    await expect(page.getByText("Nothing has been published yet.")).toBeVisible();
    await expect(page.getByText("No recent account activity yet.")).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  await test.step("isolated partial errors and recovery", async () => {
    await setScenario("homepage-partial-error");
    await page.reload();
    await expect(
      page.getByText("Featured recipes are unavailable right now."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Breakfast" })).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "Roasted Garden Tomato Soup",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Your stats" })
        .getByText(/Unavailable\./),
    ).toBeVisible();

    await setScenario("normal");
    await page.getByRole("link", { name: "Retry featured recipes" }).click();
    await expectHomepageDashboardReady(page);
    await expect(page.getByText("Featured recipes are unavailable right now.")).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
  });

  await test.step("sign out removes private summary without affecting discovery", async () => {
    const account = page.locator(
      'summary[aria-label="Account menu for Baseline Cook"]',
    );
    await account.click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator(".member-home-summary")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expectHomepagePublicDiscoveryReady(page);
    await expectNoAccessibilityViolations(page);
  });
});

test("public recipe context reflows at reviewed widths", async ({ page }, testInfo) => {
  desktopOnly(testInfo);

  const expectedColumns = {
    desktop: { hero: 2, reading: 2, highlights: 3, versions: 2, cook: 4, rules: 2 },
    intermediate: { hero: 1, reading: 1, highlights: 1, versions: 2, cook: 3, rules: 1 },
    phone: { hero: 1, reading: 1, highlights: 1, versions: 1, cook: 2, rules: 1 },
  } as const;

  for (const viewport of REVIEWED_SHELL_VIEWPORTS) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
      const detailHero = page.locator(".recipe-detail__hero");
      const readingPanels = page.locator(".recipe-detail__body");
      await expect(
        page.getByRole("heading", { name: "Garden Cream Tomato Soup", level: 1 }),
      ).toBeVisible();
      await expect(detailHero).toHaveCount(1);
      await expect(readingPanels).toHaveCount(1);
      expect(
        await detailHero.evaluate((grid) =>
          getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].hero);
      expect(
        await readingPanels.evaluate((grid) =>
          getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].reading);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
      const highlights = page.getByRole("list", { name: "Changes at a glance" });
      const versions = page.getByRole("navigation", { name: "Compared recipes" }).locator("ol");
      await expect(highlights).toBeVisible();
      await expect(highlights).toHaveCount(1);
      await expect(versions).toHaveCount(1);
      expect(
        await highlights.evaluate((grid) =>
          getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].highlights);
      expect(
        await versions.evaluate((grid) =>
          getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].versions);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/cooks/baseline-cook");
      const cookRecipes = page.getByRole("list", { name: "Public recipes by Baseline Cook" });
      await expect(cookRecipes).toBeVisible();
      await expect(cookRecipes).toHaveCount(1);
      expect(
        await cookRecipes.evaluate((grid) =>
          getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].cook);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/community-rules");
      const rules = page.locator(".policy-page__sections");
      await expect(page.getByRole("heading", { name: "Community rules", level: 1 })).toBeVisible();
      await expect(rules).toHaveCount(1);
      expect(
        await rules.evaluate((grid) =>
          getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].rules);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);
    });
  }
});

test("account and private library surfaces stay usable and private at reviewed widths", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);

  for (const viewport of REVIEWED_SHELL_VIEWPORTS) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await setScenario("anonymous-session");
      await page.goto("/sign-in?return_to=%2Faccount%2Frecipes%3Fview%3Ddrafts");
      await expect(
        page.getByRole("heading", { name: "Sign in to Recipe Lab", level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await expectNoVisiblePrivateMaterial(page);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await setScenario("normal");
      await page.goto("/account/recipes?view=drafts");
      await expect(
        page.getByRole("list", { name: "Private recipe drafts" }),
      ).toBeVisible();
      const recipeViews = page.getByRole("navigation", { name: "My recipe views" });
      for (const viewName of ["Drafts", "Published", "Withdrawn"]) {
        await expect(recipeViews.getByRole("link", { name: viewName })).toBeVisible();
      }
      await expectNoVisiblePrivateMaterial(page);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/account/saved-recipes");
      await expect(page.getByRole("list", { name: "Saved recipes" })).toBeVisible();
      await expectNoVisiblePrivateMaterial(page);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/account/ingredient-requests");
      const requestHistory = page.getByRole("region", {
        name: "My ingredient requests",
      });
      await expect(requestHistory).toBeVisible();
      await expect(
        requestHistory.getByRole("article", {
          name: "Ingredient request: Sunberry tomato",
        }),
      ).toBeVisible();
      await expectNoVisiblePrivateMaterial(page);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/account/settings");
      await expect(
        page.getByRole("heading", { name: "Account settings", level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Delete account", level: 2 }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Permanently delete account" }),
      ).toBeDisabled();
      await expectNoVisiblePrivateMaterial(page);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);
    });
  }
});

test("public recipe retry refetches the failed route", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await setScenario("public-context-failure");
  await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
  await expect(
    page.getByRole("heading", { name: "We couldn’t load this recipe.", level: 1 }),
  ).toBeVisible();

  await setScenario("normal");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Garden Cream Tomato Soup", level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Recipe details · Recipe Lab");
  await expectNoAccessibilityViolations(page);
});

test("home intermediate normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Recipes change. Recipe Lab keeps track.",
    }),
  ).toBeVisible();
  await expectHomepageDashboardReady(page);
  await stabilizeVisuals(page);
  await captureBaseline(page, "home-intermediate-normal");
});

test("catalog intermediate normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await page.goto("/recipes");
  await expect(page.getByRole("list", { name: "Recipe results" })).toBeVisible();
  await stabilizeVisuals(page);
  await captureBaseline(page, "catalog-intermediate-normal");
});

test("recipe detail intermediate normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
  await expect(
    page.getByRole("heading", { name: "Garden Cream Tomato Soup", level: 1 }),
  ).toBeVisible();
  await stabilizeVisuals(page);
  await captureBaseline(page, "recipe-detail-intermediate-normal");
});

test("recipe comparison intermediate normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
  await expect(page.getByRole("list", { name: "Changes at a glance" })).toBeVisible();
  await stabilizeVisuals(page);
  await captureBaseline(page, "recipe-comparison-intermediate-normal");
});

test("account access intermediate normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await setScenario("anonymous-session");
  await page.setViewportSize({ width: 820, height: 1_000 });
  await page.goto("/sign-in?return_to=%2Faccount%2Frecipes%3Fview%3Ddrafts");
  await expect(
    page.getByRole("heading", { name: "Sign in to Recipe Lab", level: 1 }),
  ).toBeVisible();
  await stabilizeVisuals(page, false);
  await expectNoVisiblePrivateMaterial(page);
  await captureBaseline(page, "account-access-intermediate-normal");
});

test("my recipes intermediate normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await page.goto("/account/recipes?view=drafts");
  await expect(
    page.getByRole("list", { name: "Private recipe drafts" }),
  ).toBeVisible();
  await stabilizeVisuals(page);
  await expectNoVisiblePrivateMaterial(page);
  await captureBaseline(page, "my-recipes-intermediate-normal");
});

test("authoring entry desktop normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await setScenario("slow-draft-creation");
  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.goto("/recipes/new");
  await expect(
    page.getByRole("heading", {
      name: "Opening your private draft…",
      level: 1,
    }),
  ).toBeVisible();
  await stabilizeVisuals(page);
  await captureBaseline(page, "authoring-entry-desktop-normal");

  const forkPage = await page.context().newPage();
  await forkPage.goto(`/recipes/${VARIANT_RECIPE_ID}/fork`);
  const forkEntry = forkPage.locator(".recipe-authoring-entry__card");
  await expect(forkEntry.getByRole("status")).toHaveText(
    "Copying this recipe into a private workspace. The public recipe stays unchanged.",
  );
  await expectNoHorizontalOverflow(forkPage);
  await expectNoAccessibilityViolations(forkPage);
  await forkPage.close();
});

test("draft editor intermediate normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
  const editor = page.getByRole("form", {
    name: "Private recipe draft editor",
  });
  await expect(editor).toBeVisible();
  const ingredient = page.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  await expect(
    ingredient.getByRole("combobox", { name: "Ingredient" }),
  ).toHaveValue("plum tomatoes");
  await expect(
    page.getByRole("button", { name: "Review and publish" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft saved" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to drafts" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Discard draft…" }),
  ).toBeVisible();
  await ingredient.evaluate((section) => {
    section.scrollIntoView({ block: "start" });
    window.scrollBy(0, -72);
  });
  await stabilizeVisuals(page);
  await captureBaseline(page, "draft-editor-intermediate-normal");
});

test("unresolved ingredient validation phone", async ({ page }, testInfo) => {
  phoneOnly(testInfo);
  await setScenario("unresolved-draft");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
  const unresolved = page.getByRole("complementary", {
    name: "Unresolved selection for Ingredient 1",
  });
  await expect(unresolved).toContainText("Sunberry tomato");
  await expect(unresolved).toContainText("Awaiting curator review");
  await page
    .getByRole("checkbox", { name: /agree to the community rules/i })
    .check();
  await page.getByRole("checkbox", { name: /right to share it/i }).check();
  const review = page.getByRole("button", {
    name: "Review and publish",
    exact: true,
  });
  await review.focus();
  await page.keyboard.press("Enter");
  const alert = page
    .getByRole("alert")
    .filter({ hasText: /Your draft needs attention/i });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(
    page.getByText(
      "Choose the request’s approved catalog ingredient before publication.",
    ),
  ).toBeVisible();
  await unresolved.evaluate((section) => {
    section.scrollIntoView({ block: "start" });
    window.scrollBy(0, -64);
  });
  await stabilizeVisuals(page);
  await captureBaseline(page, "draft-unresolved-ingredient-validation");
});

test("draft discard confirmation is keyboard reachable", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
  const requestDiscard = page.getByRole("button", { name: "Discard draft…" });
  await requestDiscard.scrollIntoViewIfNeeded();
  await stabilizeVisuals(page);
  await requestDiscard.focus();
  await page.keyboard.press("Enter");
  const confirmDiscard = page.getByRole("button", {
    name: "Discard permanently",
  });
  const keepDraft = page.getByRole("button", { name: "Keep draft" });
  await expect(confirmDiscard).toBeVisible();
  await expect(keepDraft).toBeVisible();
  await confirmDiscard.focus();
  await expect(confirmDiscard).toBeFocused();
  await captureBaseline(page, "draft-discard-confirmation");
  await page.keyboard.press("Tab");
  await expect(keepDraft).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirmDiscard).toBeHidden();
  await expect(requestDiscard).toBeVisible();
});

test("curator intermediate visual evidence", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await setScenario("curator-session");
  await page.goto(RCP46F_STAFF_ROUTES.curator.path);
  await expectNormalStaffWorkspace(page, "curator");
  await stabilizeVisuals(page);
  await captureBaseline(page, "ingredient-request-staff-review-intermediate", {
    allowedVisibleTechnicalIdentifiers: [
      "70000000-0000-4000-8000-000000000001",
    ],
  });
});

test("moderator intermediate visual evidence", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await setScenario("moderator-session");
  await page.goto(RCP46F_STAFF_ROUTES.moderator.path);
  await expectNormalStaffWorkspace(page, "moderator");
  await stabilizeVisuals(page);
  await captureBaseline(page, "recipe-moderation-staff-review-intermediate");
});

test("onboarding form desktop visual evidence", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 1_440, height: 900 });
  await setScenario("onboarding-session");
  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: "Finish account setup", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue("Baseline New Cook");
  await expect(page.getByLabel("Handle")).toHaveValue("");
  await stabilizeVisuals(page);
  await captureBaseline(page, "onboarding-form-normal");
});

test("auth callback intermediate error visual evidence", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await setScenario("anonymous-session");
  await page.goto("/auth/callback?error=provider_unavailable");
  await expect(
    page.getByRole("heading", { name: "Connecting your account", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "We couldn’t sign you in." }),
  ).toContainText("The identity provider is temporarily unavailable.");
  await stabilizeVisuals(page, false);
  await captureBaseline(page, "auth-callback-error-intermediate");
});

test("global not-found phone visual evidence", async ({ page }, testInfo) => {
  phoneOnly(testInfo);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/baseline-route-that-does-not-exist");
  await expect(
    page.getByRole("heading", { name: "We couldn’t find that page.", level: 1 }),
  ).toBeVisible();
  await stabilizeVisuals(page);
  await captureBaseline(page, "global-not-found");
});

test("stale curator decision desktop visual evidence", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 1_440, height: 900 });
  await setScenario("curation-stale-once");
  await page.goto(RCP46F_STAFF_ROUTES.curator.path);
  await expectNormalStaffWorkspace(page, "curator");
  const alert = await submitStaleCuratorDecision(page);
  await alert.scrollIntoViewIfNeeded();
  await stabilizeVisuals(page);
  await captureBaseline(page, "stale-curation-decision", {
    allowedVisibleTechnicalIdentifiers: [
      "70000000-0000-4000-8000-000000000001",
    ],
  });
});

test.describe("desktop visual state matrix", () => {
  test.beforeEach(async ({}, testInfo) => desktopOnly(testInfo));

  test("home normal", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Recipes change. Recipe Lab keeps track.",
      }),
    ).toBeVisible();
    await expectHomepageDashboardReady(page);
    await stabilizeVisuals(page);
    await captureBaseline(page, "home-normal");
  });

  test("home and account navigation normal", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Recipes change. Recipe Lab keeps track.",
      }),
    ).toBeVisible();
    await expectHomepageDashboardReady(page);
    await stabilizeVisuals(page);
    const account = page.locator(
      'summary[aria-label="Account menu for Baseline Cook"]',
    );
    await account.focus();
    await expect(account).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "My recipes" })).toBeVisible();
    await captureBaseline(page, "home-account-navigation");
  });

  test("catalog normal", async ({ page }) => {
    await page.goto("/recipes");
    await expect(
      page.getByRole("heading", { name: /Find something to cook/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Garden Cream Tomato Soup" }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "catalog-normal");
  });

  test("catalog empty", async ({ page }) => {
    await page.goto("/recipes?q=No%20baseline%20matches");
    await expect(
      page.getByRole("heading", { name: /No recipes matched/i }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "catalog-empty");
  });

  test("recipe detail normal", async ({ page }) => {
    await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
    await expect(
      page.getByRole("heading", { name: "Garden Cream Tomato Soup", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Save and rate this recipe" }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-detail-normal");

    const instructions = page.getByRole("heading", {
      name: "Instructions",
      level: 2,
    });
    await instructions.evaluate((heading) => {
      heading.scrollIntoView({ block: "start" });
      window.scrollBy(0, -80);
    });
    await expect(instructions).toBeInViewport();
    await captureBaseline(page, "recipe-instructions-normal");

    const history = page.getByRole("heading", {
      name: "Recipe history",
      level: 2,
    });
    await history.evaluate((heading) =>
      heading.scrollIntoView({ block: "start" }),
    );
    await expect(history).toBeInViewport();
    await captureBaseline(page, "recipe-detail-history");
  });

  test("recipe comparison normal", async ({ page }) => {
    await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
    await expect(
      page.getByRole("heading", {
        name: "How Garden Cream Tomato Soup changed",
        level: 1,
      }),
    ).toBeVisible();
    const summary = page.getByRole("list", { name: "Changes at a glance" });
    await expect(summary).toBeVisible();
    await summary.scrollIntoViewIfNeeded();
    await expect(summary).toBeInViewport();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-comparison-normal");
  });

  test("cook profile normal", async ({ page }) => {
    await page.goto("/cooks/baseline-cook");
    await expect(
      page.getByRole("heading", { name: "Baseline Cook", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Public recipes by Baseline Cook" }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "cook-profile-normal");
  });

  test("community rules normal", async ({ page }) => {
    await page.goto("/community-rules");
    await expect(
      page.getByRole("heading", { name: "Community rules", level: 1 }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "community-rules-normal");
  });

  test("public recipe failure", async ({ page }) => {
    await setScenario("public-context-failure");
    await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
    await expect(
      page.getByRole("heading", { name: "We couldn’t load this recipe.", level: 1 }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-detail-error");
  });

  test("public recipe unavailable", async ({ page }) => {
    await page.goto("/recipes/20000000-0000-4000-8000-000000000099");
    await expect(
      page.getByRole("heading", { name: "This recipe isn’t available.", level: 1 }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-detail-unavailable");
  });

  test("my recipes normal", async ({ page }) => {
    await page.goto("/account/recipes?view=drafts");
    await expect(
      page.getByRole("list", { name: "Private recipe drafts" }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "my-recipes-normal");
  });

  test("draft ingredient editor normal", async ({ page }) => {
    await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
    const ingredient = page.getByRole("group", {
      name: "Ingredient 1",
      exact: true,
    });
    await expect(
      ingredient.getByRole("textbox", { name: "Amount", exact: true }),
    ).toHaveValue("800");
    await expect(
      ingredient.getByRole("combobox", { name: "Unit", exact: true }),
    ).toHaveValue(GRAM_UNIT_ID);
    await expect(ingredient.getByRole("combobox", { name: "Ingredient" })).toHaveValue(
      "plum tomatoes",
    );
    await expect(ingredient.getByLabel("Note (optional)")).toHaveValue(
      "roughly chopped",
    );
    await ingredient.evaluate((section) => {
      section.scrollIntoView({ block: "start" });
      window.scrollBy(0, -80);
    });
    await stabilizeVisuals(page);
    await captureBaseline(page, "draft-ingredient-editor-normal");

    const step = page.getByRole("group", { name: "Step 1", exact: true });
    await expect(step.getByLabel("Instruction", { exact: true })).toBeVisible();
    const cookingDetails = step.getByRole("button", {
      name: "Edit cooking details for Step 1",
    });
    await expect(cookingDetails).toHaveAttribute("aria-expanded", "false");
    await step.evaluate((section) => {
      section.scrollIntoView({ block: "start" });
      window.scrollBy(0, -80);
    });
    await captureBaseline(page, "draft-instruction-editor-normal");
    await cookingDetails.click();
    await expect(
      step.getByRole("group", { name: "Author-added cooking details" }),
    ).toBeVisible();
    await captureBaseline(page, "draft-instruction-editor-expanded");
  });

  test("draft editor validation", async ({ page }) => {
    await setScenario("incomplete-draft");
    await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
    await expect(page.getByLabel("Title")).toBeVisible();
    await stabilizeVisuals(page);
    await page
      .getByRole("checkbox", { name: /agree to the community rules/i })
      .check();
    await page.getByRole("checkbox", { name: /right to share it/i }).check();
    const review = page.getByRole("button", {
      name: "Review and publish",
      exact: true,
    });
    await review.focus();
    await page.keyboard.press("Enter");
    const alert = page
      .getByRole("alert")
      .filter({ hasText: /Your draft needs attention/i });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await alert.scrollIntoViewIfNeeded();
    await captureBaseline(page, "draft-editor-validation");
  });

  test("draft similarity and publication review", async ({ page }) => {
    await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
    await expect(page.getByLabel("Title")).toHaveValue(
      "Late-Summer Tomato Pot",
    );
    await stabilizeVisuals(page);
    await page
      .getByRole("checkbox", { name: /agree to the community rules/i })
      .check();
    await page.getByRole("checkbox", { name: /right to share it/i }).check();
    await page
      .getByRole("button", { name: "Review and publish", exact: true })
      .click();
    const publishAnyway = page.getByRole("button", {
      name: "Publish recipe anyway",
    });
    await expect(publishAnyway).toBeVisible();
    await publishAnyway.scrollIntoViewIfNeeded();
    await captureBaseline(page, "draft-similarity-publication-review");
  });

  test("ingredient request staff review", async ({ page }) => {
    await setScenario("curator-session");
    await page.goto("/catalog/ingredient-requests");
    await expect(
      page.getByRole("heading", { name: "Sunberry tomato", level: 2 }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "ingredient-request-staff-review", {
      allowedVisibleTechnicalIdentifiers: [
        "70000000-0000-4000-8000-000000000001",
      ],
    });
  });

  test("recipe moderation staff review", async ({ page }) => {
    await setScenario("moderator-session");
    await page.goto("/moderation/recipes");
    await expect(
      page.getByRole("heading", { name: "Sunlit Tomato Soup", level: 2 }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-moderation-staff-review");
  });

  test("private workspace loading", async ({ page }) => {
    await setScenario("slow-session");
    await page.goto("/account/recipes?view=drafts", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Checking your account…" }),
    ).toBeVisible();
    await stabilizeVisuals(page, false);
    await captureBaseline(page, "private-workspace-loading");
  });

  test("private workspace failure", async ({ page }) => {
    await setScenario("library-failure");
    await page.goto("/account/recipes?view=drafts");
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "Recipe Lab could not load your private drafts. Please try again.",
      }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "private-workspace-failure");
  });

  test("private workspace expired session", async ({ page }) => {
    await setScenario("expired-library");
    await page.goto("/account/recipes?view=drafts");
    await expect(
      page.getByRole("alert", {
        name: "Your session expired. Your work is still here.",
      }),
    ).toBeVisible();
    await stabilizeVisuals(page, false);
    await captureBaseline(page, "private-workspace-expired-session");
  });
});

test.describe("phone visual state matrix", () => {
  test.beforeEach(async ({}, testInfo) => phoneOnly(testInfo));

  test("home normal", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Recipes change. Recipe Lab keeps track.",
      }),
    ).toBeVisible();
    await expectHomepageDashboardReady(page);
    await stabilizeVisuals(page);
    await captureBaseline(page, "home-normal");
  });

  test("my recipes normal", async ({ page }) => {
    await page.goto("/account/recipes?view=drafts");
    await expect(
      page.getByRole("list", { name: "Private recipe drafts" }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "my-recipes-normal");
    const resumeDraft = page.getByRole("link", { name: "Resume draft" });
    const draftCard = page.getByRole("article").filter({ has: resumeDraft });
    await resumeDraft.scrollIntoViewIfNeeded();
    const [buttonBox, cardBox] = await Promise.all([
      resumeDraft.boundingBox(),
      draftCard.boundingBox(),
    ]);
    expect(buttonBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(buttonBox!.width).toBeLessThan(cardBox!.width * 0.7);
  });

  test("home and account navigation normal", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Recipes change. Recipe Lab keeps track.",
      }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    const account = page.locator(
      'summary[aria-label="Account menu for Baseline Cook"]',
    );
    await account.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "My recipes" })).toBeVisible();
    await captureBaseline(page, "home-account-navigation");
  });

  test("catalog normal", async ({ page }) => {
    await page.goto("/recipes");
    await expect(
      page.getByRole("article", { name: "Garden Cream Tomato Soup" }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "catalog-normal");
  });

  test("recipe detail normal", async ({ page }) => {
    await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
    await expect(
      page.getByRole("heading", { name: "Garden Cream Tomato Soup", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Save and rate this recipe" }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-detail-normal");

    const instructions = page.getByRole("heading", {
      name: "Instructions",
      level: 2,
    });
    await instructions.evaluate((heading) => {
      heading.scrollIntoView({ block: "start" });
      window.scrollBy(0, -64);
    });
    await expect(instructions).toBeInViewport();
    await captureBaseline(page, "recipe-instructions-normal");

    const history = page.getByRole("heading", {
      name: "Recipe history",
      level: 2,
    });
    await history.evaluate((heading) =>
      heading.scrollIntoView({ block: "start" }),
    );
    await expect(history).toBeInViewport();
    await captureBaseline(page, "recipe-detail-history");
  });

  test("recipe comparison normal", async ({ page }) => {
    await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
    await expect(
      page.getByRole("heading", {
        name: "How Garden Cream Tomato Soup changed",
        level: 1,
      }),
    ).toBeVisible();
    const overview = page.getByRole("region", { name: "Changes at a glance" });
    const summary = overview.getByRole("list", { name: "Changes at a glance" });
    await expect(summary).toBeVisible();
    await overview.evaluate((section) => {
      section.scrollIntoView({ block: "start" });
      window.scrollBy(0, -80);
    });
    await expect(overview).toBeInViewport();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-comparison-normal");
  });

  test("cook profile normal", async ({ page }) => {
    await page.goto("/cooks/baseline-cook");
    await expect(
      page.getByRole("heading", { name: "Baseline Cook", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Public recipes by Baseline Cook" }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "cook-profile-normal");
  });

  test("community rules normal", async ({ page }) => {
    await page.goto("/community-rules");
    await expect(
      page.getByRole("heading", { name: "Community rules", level: 1 }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "community-rules-normal");
  });

  test("draft ingredient editor normal", async ({ page }) => {
    await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
    const ingredient = page.getByRole("group", {
      name: "Ingredient 1",
      exact: true,
    });
    await expect(
      ingredient.getByRole("textbox", { name: "Amount", exact: true }),
    ).toHaveValue("800");
    await expect(
      ingredient.getByRole("combobox", { name: "Unit", exact: true }),
    ).toHaveValue(GRAM_UNIT_ID);
    await expect(ingredient.getByRole("combobox", { name: "Ingredient" })).toHaveValue(
      "plum tomatoes",
    );
    await expect(ingredient.getByLabel("Note (optional)")).toHaveValue(
      "roughly chopped",
    );
    await ingredient.evaluate((section) => {
      section.scrollIntoView({ block: "start" });
      window.scrollBy(0, -64);
    });
    await stabilizeVisuals(page);
    await captureBaseline(page, "draft-ingredient-editor-normal");

    const step = page.getByRole("group", { name: "Step 1", exact: true });
    await expect(step.getByLabel("Instruction", { exact: true })).toBeVisible();
    const cookingDetails = step.getByRole("button", {
      name: "Edit cooking details for Step 1",
    });
    await expect(cookingDetails).toHaveAttribute("aria-expanded", "false");
    await step.evaluate((section) => {
      section.scrollIntoView({ block: "start" });
      window.scrollBy(0, -64);
    });
    await captureBaseline(page, "draft-instruction-editor-normal");
    await cookingDetails.click();
    await expect(
      step.getByRole("group", { name: "Author-added cooking details" }),
    ).toBeVisible();
    await captureBaseline(page, "draft-instruction-editor-expanded");
  });

  test("draft editor validation", async ({ page }) => {
    await setScenario("incomplete-draft");
    await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
    await expect(page.getByLabel("Title")).toBeVisible();
    await stabilizeVisuals(page);
    await page
      .getByRole("checkbox", { name: /agree to the community rules/i })
      .check();
    await page.getByRole("checkbox", { name: /right to share it/i }).check();
    const review = page.getByRole("button", {
      name: "Review and publish",
      exact: true,
    });
    await review.focus();
    await page.keyboard.press("Enter");
    const alert = page
      .getByRole("alert")
      .filter({ hasText: /Your draft needs attention/i });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await alert.scrollIntoViewIfNeeded();
    await captureBaseline(page, "draft-editor-validation");
  });

  test("draft similarity and publication review", async ({ page }) => {
    await page.goto(`/account/recipe-drafts/${DRAFT_ID}`);
    await expect(page.getByLabel("Title")).toHaveValue(
      "Late-Summer Tomato Pot",
    );
    await stabilizeVisuals(page);
    await page
      .getByRole("checkbox", { name: /agree to the community rules/i })
      .check();
    await page.getByRole("checkbox", { name: /right to share it/i }).check();
    await page
      .getByRole("button", { name: "Review and publish", exact: true })
      .click();
    const publishAnyway = page.getByRole("button", {
      name: "Publish recipe anyway",
    });
    await expect(publishAnyway).toBeVisible();
    await publishAnyway.scrollIntoViewIfNeeded();
    await captureBaseline(page, "draft-similarity-publication-review");
  });

  test("ingredient request staff review", async ({ page }) => {
    await setScenario("curator-session");
    await page.goto("/catalog/ingredient-requests");
    await expect(
      page.getByRole("heading", { name: "Sunberry tomato", level: 2 }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "ingredient-request-staff-review", {
      allowedVisibleTechnicalIdentifiers: [
        "70000000-0000-4000-8000-000000000001",
      ],
    });
  });

  test("recipe moderation staff review", async ({ page }) => {
    await setScenario("moderator-session");
    await page.goto("/moderation/recipes");
    await expect(
      page.getByRole("heading", { name: "Sunlit Tomato Soup", level: 2 }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-moderation-staff-review");
  });
});

test("intermediate account navigation reaches a private library by keyboard", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await page.goto("/");
  await stabilizeVisuals(page);

  const account = page.locator(
    'summary[aria-label="Account menu for Baseline Cook"]',
  );
  await account.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Public profile" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "My recipes" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saved recipes" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(`${BASELINE_FRONTEND_ORIGIN}/account/saved-recipes`);
  await expect(page.getByRole("list", { name: "Saved recipes" })).toBeVisible();
  await expectNoVisiblePrivateMaterial(page);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
});

test("keyboard account-to-private-workspace journey", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Recipes change. Recipe Lab keeps track.",
    }),
  ).toBeVisible();
  await stabilizeVisuals(page);
  const account = page.locator(
    'summary[aria-label="Account menu for Baseline Cook"]',
  );
  await account.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Public profile" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "My recipes" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    `${BASELINE_FRONTEND_ORIGIN}/account/recipes?view=drafts`,
  );
  await expect(
    page.getByRole("list", { name: "Private recipe drafts" }),
  ).toBeVisible();
  await stabilizeVisuals(page);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
});

test("fixture API routes and private headers fail closed", async ({
  page,
}, testInfo) => {
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

test("browser HTTP and WebSocket egress fail closed", async ({
  context,
  page,
}, testInfo) => {
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
