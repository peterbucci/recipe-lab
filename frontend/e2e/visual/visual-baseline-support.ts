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
} from "../../playwright.baseline.config";
import {
  RCP46F_STAFF_ROUTES,
  RCP46F_STAFF_STATE_MATRIX,
  RCP46F_STAFF_VIEWPORTS,
  type Rcp46fStaffMatrixCase,
  type Rcp46fStaffRole,
} from "./staff-certification-matrix";

export const DESKTOP_PROJECT = "baseline-desktop-chromium";
export const PHONE_PROJECT = "baseline-phone-chromium";
export const REVIEWED_SHELL_VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "intermediate", width: 820, height: 1_000 },
  { label: "phone", width: 390, height: 844 },
] as const;
export const DRAFT_ID = "30000000-0000-4000-8000-000000000001";
export const GRAM_UNIT_ID = "50000000-0000-4000-8000-000000000001";
export const PRIVATE_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
export const PRIVATE_CURATOR_ID = "10000000-0000-4000-8000-000000000003";
export const PRIVATE_MODERATOR_ID = "10000000-0000-4000-8000-000000000004";
export const PRIVATE_ONBOARDING_ID = "10000000-0000-4000-8000-000000000005";
export const ROOT_RECIPE_ID = "20000000-0000-4000-8000-000000000001";
export const VARIANT_RECIPE_ID = "20000000-0000-4000-8000-000000000002";
export const SAFE_CSRF = "rcp34b-public-csrf";
export const BASELINE_MEMBER_SESSION = "rcp34b-member-session";
export const REVIEWED_LOOPBACK_PORTS = new Set(["4317", "4318"]);
export const blockedNetworkRequests = new WeakMap<BrowserContext, number>();
export const BASELINE_FONT = readFileSync(
  resolve(
    process.cwd(),
    "node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  ),
).toString("base64");

export interface FixtureAudit {
  accepted_api_requests: number;
  unknown_api_requests: number;
  unknown_api_routes: string[];
  privacy_rejections: number;
  route_counts: Record<string, number>;
}

export async function fixtureRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${BASELINE_FIXTURE_ORIGIN}${path}`, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

export async function setScenario(name: string): Promise<void> {
  const response = await fixtureRequest("/__baseline__/scenario", {
    method: "POST",
    body: name,
  });
  expect(response.ok).toBe(true);
}

export async function resetFixture(): Promise<void> {
  const response = await fixtureRequest("/__baseline__/reset", {
    method: "POST",
  });
  expect(response.ok).toBe(true);
}

export async function readAudit(): Promise<FixtureAudit> {
  const response = await fixtureRequest("/__baseline__/audit");
  expect(response.ok).toBe(true);
  return (await response.json()) as FixtureAudit;
}

export async function installFrozenBrowserState(
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

        static override now() {
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

export async function installMemberSession(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "recipe_lab_session",
      value: BASELINE_MEMBER_SESSION,
      url: BASELINE_FRONTEND_ORIGIN,
      sameSite: "Lax",
    },
  ]);
}

export async function gotoMemberHome(page: Page): Promise<void> {
  await installMemberSession(page.context());
  await page.goto("/");
}

export async function reloadMemberHome(page: Page): Promise<void> {
  await installMemberSession(page.context());
  await page.reload();
}

export async function stabilizeVisuals(
  page: Page,
  waitForAccount = true,
): Promise<void> {
  if (new URL(page.url()).pathname.startsWith("/recipes/drafts/")) {
    await expect(
      page.getByRole("form", { name: "Private recipe draft editor" }),
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

export async function expectNoAccessibilityViolations(page: Page): Promise<void> {
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

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

export async function expectHomepageDashboardReady(page: Page): Promise<void> {
  await expect(page).toHaveURL("/");
  await expect(page).toHaveTitle("Recipe Lab");
  await expect(
    page.locator('a[href="/recipes/new"]').filter({ visible: true }),
  ).toHaveCount(1);
  if ((page.viewportSize()?.width ?? 0) >= 1_200) {
    await expect(
      page.getByRole("heading", { name: "Continue where you left off" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Open draft" })).toBeVisible();
    await expect(
      page.locator(".member-home-summary__metrics [role='status']"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("list", { name: "Recent account activity" }),
    ).toBeVisible();
  } else {
    await expect(page.locator(".home-member-layout__summary")).toBeHidden();
  }
  await expect(
    page.getByRole("heading", { name: "Featured recipes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Explore by category" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "From your community" }),
  ).toBeVisible();
}

export async function expectHomepagePublicDiscoveryReady(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Featured recipes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Explore by category" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "From your community" }),
  ).toBeVisible();
}

export async function expectCatalogDiscoveryReady(page: Page): Promise<void> {
  await expect(page).toHaveURL("/recipes");
  await expect(
    page.getByRole("heading", { name: "All recipes", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Recipe results" }),
  ).toBeVisible();
}

export async function expectNoVisiblePrivateMaterial(page: Page): Promise<void> {
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
  expect(visibleText).not.toMatch(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  expect(page.url()).not.toContain(SAFE_CSRF);
}

export type BaselineCaptureOptions = {
  allowedVisibleTechnicalIdentifiers?: readonly string[];
};

export async function sanitizeVisibleTechnicalIdentifiers(
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

export async function captureBaseline(
  page: Page,
  name: string,
  options: BaselineCaptureOptions = {},
): Promise<void> {
  await sanitizeVisibleTechnicalIdentifiers(page, options);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
  await expect(page).toHaveScreenshot(`${name}.png`);
}

export function desktopOnly(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== DESKTOP_PROJECT,
    "Desktop-only evidence.",
  );
}

export function phoneOnly(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== PHONE_PROJECT, "Phone-only evidence.");
}

export function otherStaffRole(role: Rcp46fStaffRole): Rcp46fStaffRole {
  return role === "curator" ? "moderator" : "curator";
}

export async function expectRoleSpecificStaffNavigation(
  page: Page,
  role: Rcp46fStaffRole,
): Promise<void> {
  const workspaceUrl = page.url();
  const account = page.locator('summary[aria-label^="Account menu for "]');
  await account.click();
  await page.getByRole("link", { name: "Staff tools", exact: true }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(
    page.getByRole("heading", { name: "Staff Tools", level: 1 }),
  ).toBeVisible();
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
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
  await page.goBack();
  await expect(page).toHaveURL(workspaceUrl);
}

export async function captureStaffToolsSelections(
  page: Page,
  defaultBaselineName: string,
  moderatorBaselineName: string,
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Staff Tools", level: 1 }),
  ).toBeVisible();

  const curatorTab = page.getByRole("tab", { name: "Curator tools", exact: true });
  const moderatorTab = page.getByRole("tab", {
    name: "Moderator tools",
    exact: true,
  });

  await expect(curatorTab).toHaveAttribute("aria-selected", "true");
  await expect(moderatorTab).toHaveAttribute("aria-selected", "false");
  await expect(
    page.getByRole("link", { name: "Open ingredient catalog", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open recipe reports", exact: true }),
  ).toHaveCount(0);

  await stabilizeVisuals(page);
  await captureBaseline(page, defaultBaselineName);

  await moderatorTab.click();
  await expect(moderatorTab).toHaveAttribute("aria-selected", "true");
  await expect(curatorTab).toHaveAttribute("aria-selected", "false");
  await expect(
    page.getByRole("link", { name: "Open recipe reports", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open ingredient catalog", exact: true }),
  ).toHaveCount(0);
  await captureBaseline(page, moderatorBaselineName);
}

export async function captureAccountSettingsTabs(
  page: Page,
  profileBaselineName: string,
  dangerBaselineName: string,
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();

  const settingsTabs = page.getByRole("tablist", {
    name: "Settings categories",
  });
  const profileTab = settingsTabs.getByRole("tab", {
    name: "Profile",
    exact: true,
  });
  const dangerTab = settingsTabs.getByRole("tab", {
    name: "Danger zone",
    exact: true,
  });
  const profilePanel = page.locator("#account-settings-profile-panel");
  const dangerPanel = page.locator("#account-settings-danger-panel");

  await expect(profileTab).toHaveAttribute("aria-selected", "true");
  await expect(dangerTab).toHaveAttribute("aria-selected", "false");
  await expect(profilePanel).toBeVisible();
  await expect(dangerPanel).toBeHidden();

  const description = profilePanel.getByRole("textbox", {
    name: "About you",
    exact: true,
  });
  const preview = profilePanel.locator(".account-settings__profile-preview");
  await expect(description).toHaveValue("");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Baseline Cook");
  await expect(preview).toContainText("@baseline-cook");
  await expect(preview).toContainText("Your description will appear here.");
  await expect(
    profilePanel.getByRole("link", {
      name: "View public profile",
      exact: true,
    }),
  ).toHaveAttribute("href", "/cooks/baseline-cook");

  await stabilizeVisuals(page);
  await captureBaseline(page, profileBaselineName);

  const livePreviewDescription =
    "Weeknight recipes with small seasonal experiments.";
  await description.fill(livePreviewDescription);
  await expect(preview).toContainText(livePreviewDescription);
  await expect(
    profilePanel.getByText(`${livePreviewDescription.length} / 500`, {
      exact: true,
    }),
  ).toBeVisible();
  await description.fill("");
  await expect(preview).toContainText("Your description will appear here.");

  await dangerTab.click();
  await expect(profileTab).toHaveAttribute("aria-selected", "false");
  await expect(dangerTab).toHaveAttribute("aria-selected", "true");
  await expect(profilePanel).toBeHidden();
  await expect(dangerPanel).toBeVisible();

  const deleteButton = dangerPanel.getByRole("button", {
    name: "Permanently delete account",
    exact: true,
  });
  const acknowledgement = dangerPanel.getByRole("checkbox", {
    name: /account deletion is permanent/i,
  });
  const confirmation = dangerPanel.getByLabel(
    /Type baseline-cook to confirm/i,
  );
  await expect(deleteButton).toBeDisabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await captureBaseline(page, dangerBaselineName);

  await acknowledgement.check();
  await expect(deleteButton).toBeDisabled();
  await confirmation.fill("Baseline-Cook");
  await expect(deleteButton).toBeDisabled();
  await confirmation.fill("baseline-cook");
  await expect(deleteButton).toBeEnabled();

  await dangerTab.focus();
  await page.keyboard.press("Home");
  await expect(profileTab).toBeFocused();
  await expect(profileTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(dangerTab).toBeFocused();
  await expect(dangerTab).toHaveAttribute("aria-selected", "true");
}

export async function expectAccountActivityReady(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Activity", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "A history of the recipes, saves, and ingredient requests you've worked with recently.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to home", exact: true }),
  ).toHaveCount(0);

  const activity = page.getByRole("region", { name: "Account activity" });
  const filters = activity.getByRole("group", { name: "Activity filters" });
  await expect(
    filters.getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    filters.getByRole("button", { name: "Recipes", exact: true }),
  ).toContainText("5");
  await expect(
    filters.getByRole("button", { name: "Saved", exact: true }),
  ).toContainText("2");
  await expect(
    filters.getByRole("button", {
      name: "Ingredient requests",
      exact: true,
    }),
  ).toContainText("2");
  await expect(
    activity.getByRole("searchbox", { name: "Search activity", exact: true }),
  ).toBeVisible();
  await expect(
    activity.getByRole("heading", { name: "Today", level: 2 }),
  ).toBeVisible();
  await expect(
    activity.getByRole("heading", { name: "Yesterday", level: 2 }),
  ).toBeVisible();
  await expect(
    activity.getByRole("heading", { name: "Earlier", level: 2 }),
  ).toBeVisible();
  await expect(
    activity.getByRole("link", {
      name: /^Updated draft Banana Oat Pancakes\b/,
    }),
  ).toHaveAttribute("href", `/recipes/drafts/${DRAFT_ID}`);
  await expect(
    activity.getByRole("link", {
      name: /Red Lentil Coconut Stew/,
    }),
  ).toHaveAttribute("href", "/account/recipes?view=published");
  await expect(
    activity.getByRole("link", {
      name: /Garlic Butter Shrimp Pasta/,
    }),
  ).toHaveAttribute("href", "/account/recipes?view=saved");
  await expect(
    activity.getByRole("link", { name: /Sumac/ }),
  ).toHaveAttribute("href", "/account/ingredient-requests");

  const audit = await readAudit();
  expect(audit.route_counts["member-activity"] ?? 0).toBe(1);
  expect(audit.route_counts["my-recipes"] ?? 0).toBe(0);
  expect(audit.route_counts["saved-recipes"] ?? 0).toBe(0);
  expect(audit.route_counts["member-ingredient-requests"] ?? 0).toBe(0);
}

export async function selectActivityFilter(
  page: Page,
  name: "All" | "Ingredient requests" | "Saved",
): Promise<void> {
  const filters = page.getByRole("group", { name: "Activity filters" });
  const selected = filters.getByRole("button", { name, exact: true });
  await selected.click();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
}

export async function certifyStaffState(
  page: Page,
  waitForAccount = true,
): Promise<void> {
  await stabilizeVisuals(page, waitForAccount);
  await expectNoVisiblePrivateMaterial(page);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
}

export async function expectNormalStaffWorkspace(
  page: Page,
  role: Rcp46fStaffRole,
): Promise<void> {
  if (role === "curator") {
    await expect(page.locator("main.staff-workspace--curation")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sunberry tomato", level: 2 }),
    ).toBeVisible();
  } else {
    await expect(
      page.locator("main.staff-workspace--moderation"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sunlit Tomato Soup", level: 2 }),
    ).toBeVisible();
  }
  await expectRoleSpecificStaffNavigation(page, role);
}

export async function enterCuratorDecision(page: Page): Promise<void> {
  await page.getByLabel("Canonical ingredient name").fill("Sunberry tomato");
  await page
    .getByLabel("Decision reason")
    .fill("The reviewed catalog evidence supports this synthetic decision.");
  await page
    .getByLabel("Approval provenance")
    .fill("Synthetic RCP-46F curator certification evidence.");
}

export async function submitStaleCuratorDecision(page: Page) {
  await enterCuratorDecision(page);
  await page.getByRole("button", { name: "Approve request" }).click();
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

export async function retryStaleCuratorDecision(page: Page): Promise<void> {
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
  await page.getByRole("button", { name: "Approve request" }).click();
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByRole("status").filter({ hasText: "Decision saved." }),
  ).toBeVisible();
}

export async function exerciseStaffMatrixCase(
  page: Page,
  matrixCase: Rcp46fStaffMatrixCase,
): Promise<void> {
  const route = RCP46F_STAFF_ROUTES[matrixCase.routeRole];
  const auditBefore = await readAudit();
  const deniedRouteCountBefore =
    auditBefore.route_counts[route.apiRouteLabel] ?? 0;
  const authorizationDeniedCountBefore =
    auditBefore.route_counts[route.authorizationDeniedApiRouteLabel] ?? 0;
  await page.goto(route.path, {
    waitUntil:
      matrixCase.id === "curator-loading" ? "domcontentloaded" : "load",
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
      await expect(
        page.getByRole("heading", {
          name: "There are no pending ingredient requests.",
          level: 3,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Choose a request", level: 2 }),
      ).toHaveCount(0);
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
        page.getByRole("heading", {
          name: "We couldn’t find that page.",
          level: 1,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("Sunberry tomato", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          "Repeated promotional links in the public description.",
          {
            exact: true,
          },
        ),
      ).toHaveCount(0);
      const auditAfter = await readAudit();
      const deniedRouteCountAfter =
        auditAfter.route_counts[route.apiRouteLabel] ?? 0;
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

export {
  BASELINE_FRONTEND_ORIGIN,
  RCP46F_STAFF_ROUTES,
  RCP46F_STAFF_STATE_MATRIX,
  RCP46F_STAFF_VIEWPORTS,
};

export function registerVisualBaselineHooks(): void {
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
}
