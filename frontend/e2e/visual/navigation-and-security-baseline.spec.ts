import { expect, test } from "@playwright/test";

import {
  blockedNetworkRequests,
  resetFixture,
  readAudit,
  gotoMemberHome,
  stabilizeVisuals,
  expectNoAccessibilityViolations,
  expectNoHorizontalOverflow,
  expectNoVisiblePrivateMaterial,
  desktopOnly,
  BASELINE_FRONTEND_ORIGIN,
  registerVisualBaselineHooks,
} from "./visual-baseline-support";

registerVisualBaselineHooks();

test("intermediate account navigation reaches a private library by keyboard", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await gotoMemberHome(page);
  await stabilizeVisuals(page);

  const account = page.locator(
    'summary[aria-label="Account menu for Baseline Cook"]',
  );
  await account.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "View profile", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const accountPanel = page.locator(".account-menu__panel");
  await expect(
    accountPanel.getByRole("link", { name: "My recipes", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    `${BASELINE_FRONTEND_ORIGIN}/account/recipes?view=drafts`,
  );
  const savedView = page.getByRole("link", { name: "Saved", exact: true });
  await savedView.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    `${BASELINE_FRONTEND_ORIGIN}/account/recipes?view=saved`,
  );
  await expect(page.getByRole("list", { name: "Saved recipes" })).toBeVisible();
  await expectNoVisiblePrivateMaterial(page);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
});

test("keyboard account-to-private-workspace journey", async ({ page }) => {
  await gotoMemberHome(page);
  await expect(
    page.getByRole("heading", {
      name: "Featured recipes",
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
    page.getByRole("link", { name: "View profile", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const accountPanel = page.locator(".account-menu__panel");
  await expect(
    accountPanel.getByRole("link", { name: "My recipes", exact: true }),
  ).toBeFocused();
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
