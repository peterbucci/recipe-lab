import { expect, test } from "@playwright/test";

import {
  REVIEWED_SHELL_VIEWPORTS,
  setScenario,
  gotoMemberHome,
  stabilizeVisuals,
  expectNoAccessibilityViolations,
  expectNoHorizontalOverflow,
  desktopOnly,
  exerciseStaffMatrixCase,
  RCP46F_STAFF_STATE_MATRIX,
  RCP46F_STAFF_VIEWPORTS,
  registerVisualBaselineHooks,
} from "./visual-baseline-support";

registerVisualBaselineHooks();

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
  expect(moderatorDeniedBody).toContain(
    "baseline_staff_authorization_required",
  );
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
      await gotoMemberHome(page);
      await expect(
        page.getByRole("heading", {
          name: "Featured recipes",
        }),
      ).toBeVisible();
      await stabilizeVisuals(page);

      const header = page.getByRole("banner");
      const brand = header.getByRole("link", { name: "Recipe Lab home" });
      const catalog = page
        .locator('a[href="/recipes"]')
        .filter({ visible: true })
        .first();
      const account = header.locator(
        'summary[aria-label^="Account menu for "]',
      );

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

