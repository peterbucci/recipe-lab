import { expect, test } from "@playwright/test";

import {
  REVIEWED_SHELL_VIEWPORTS,
  VARIANT_RECIPE_ID,
  setScenario,
  readAudit,
  gotoMemberHome,
  reloadMemberHome,
  expectNoAccessibilityViolations,
  expectNoHorizontalOverflow,
  expectHomepageDashboardReady,
  expectHomepagePublicDiscoveryReady,
  expectCatalogDiscoveryReady,
  expectNoVisiblePrivateMaterial,
  desktopOnly,
  registerVisualBaselineHooks,
} from "./visual-baseline-support";

registerVisualBaselineHooks();

test("recipe discovery reflows without hiding results at reviewed widths", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);

  const expectedColumns = {
    desktop: 4,
    intermediate: 2,
    phone: 2,
  } as const;

  for (const viewport of REVIEWED_SHELL_VIEWPORTS) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await gotoMemberHome(page);
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

      const columns = await results.evaluate(
        (grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      );
      expect(columns).toBe(expectedColumns[viewport.label]);
      await expect(results.getByText(/^original$/i).first()).toBeVisible();
      await expect(results.getByText(/^version \d+$/i)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/recipes?category=lunch");
      await expect(
        page.getByRole("heading", { name: "Lunch recipes" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "All categories" }),
      ).toHaveAttribute("href", "/recipes?sort=newest");
      const categoryResults = page.getByRole("list", {
        name: "Recipe results",
      });
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

test("anonymous root opens the catalog without requesting private member data", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await setScenario("anonymous-session");
  await page.goto("/");

  await expectCatalogDiscoveryReady(page);
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Create recipe", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".member-home-summary")).toHaveCount(0);

  const audit = await readAudit();
  expect(audit.route_counts["my-recipes"] ?? 0).toBe(0);
  expect(audit.route_counts["saved-recipes"] ?? 0).toBe(0);
  expect(audit.route_counts["member-ingredient-requests"] ?? 0).toBe(0);
  expect(audit.route_counts["community-activity"] ?? 0).toBe(0);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
});

test("community View all opens every followed-cook publication", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await setScenario("normal");
  await gotoMemberHome(page);

  const community = page.getByRole("region", { name: "From your community" });
  await expect(
    community.getByRole("link", {
      name: "Roasted Garden Tomato Soup",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    community.getByRole("link", {
      name: "Garden Cream Tomato Soup",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    community.getByRole("link", { name: "Sunlit Tomato Soup", exact: true }),
  ).toBeVisible();

  await community.getByRole("link", { name: "View all" }).click();
  await expect(page).toHaveURL("/account/community-activity");
  await expect(
    page.getByRole("heading", { name: "Community activity", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Roasted Garden Tomato Soup",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Garden Cream Tomato Soup",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sunlit Tomato Soup", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/published an original recipe/i),
  ).toBeVisible();
  await expect(page.getByText(/published a new version/i).first()).toBeVisible();

  const audit = await readAudit();
  expect(audit.route_counts["community-activity"] ?? 0).toBe(2);
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
});

test("anonymous activity never requests private member data", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await setScenario("anonymous-session");
  await page.goto("/account/activity");

  await expect(
    page.getByRole("heading", {
      name: "Page Unavailable",
      level: 1,
    }),
  ).toBeVisible();
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
    await gotoMemberHome(page);
    await expectHomepagePublicDiscoveryReady(page);
    await expect(page.locator(".member-home-summary")).toHaveCount(0);
    await expect(page.locator('a[href="/recipes/new"]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  await test.step("account error and recovery", async () => {
    await setScenario("auth-error");
    await gotoMemberHome(page);
    await expectHomepagePublicDiscoveryReady(page);
    await expect(
      page.getByRole("button", { name: "Retry account", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".member-home-summary")).toHaveCount(0);
    await expect(page.locator('a[href="/recipes/new"]')).toHaveCount(0);

    await setScenario("normal");
    await page
      .getByRole("button", { name: "Retry account", exact: true })
      .click();
    await expectHomepageDashboardReady(page);
  });

  await test.step("honest empty state", async () => {
    await setScenario("homepage-empty");
    await reloadMemberHome(page);
    await expect(
      page.getByRole("heading", { name: "Continue where you left off" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("No recipes are featured right now."),
    ).toBeVisible();
    await expect(
      page.getByText("There are no active categories yet."),
    ).toBeVisible();
    await expect(
      page.getByText("No updates from cooks you follow yet."),
    ).toBeVisible();
    await expect(
      page.getByText("No recent account activity yet."),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  await test.step("isolated partial errors and recovery", async () => {
    await setScenario("homepage-partial-error");
    await reloadMemberHome(page);
    await expect(
      page.getByLabel("Featured recipes unavailable"),
    ).toHaveText("Unavailable");
    await expect(page.getByRole("link", { name: "Breakfast" })).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "Roasted Garden Tomato Soup",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Latest draft unavailable."),
    ).toBeVisible();
    await expect(page.getByText("Unavailable.", { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Your stats" })
        .getByLabel("Saved recipes unavailable"),
    ).toBeVisible();

    await setScenario("normal");
    await page.getByRole("button", { name: "Try again" }).click();
    await expectHomepageDashboardReady(page);
    await expect(
      page.getByLabel("Featured recipes unavailable"),
    ).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
  });

  await test.step("sign out opens the catalog without private actions", async () => {
    const account = page.locator(
      'summary[aria-label="Account menu for Baseline Cook"]',
    );
    await account.click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator(".member-home-summary")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expectCatalogDiscoveryReady(page);
    await expect(
      page.getByRole("link", { name: "Create recipe", exact: true }),
    ).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
  });
});

test("public recipe context reflows at reviewed widths", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);

  const expectedColumns = {
    desktop: {
      hero: 2,
      reading: 2,
      highlights: 3,
      versions: 2,
      cook: 4,
      rules: 2,
    },
    intermediate: {
      hero: 1,
      reading: 1,
      highlights: 1,
      versions: 2,
      cook: 3,
      rules: 1,
    },
    phone: {
      hero: 1,
      reading: 1,
      highlights: 1,
      versions: 1,
      cook: 2,
      rules: 1,
    },
  } as const;

  for (const viewport of REVIEWED_SHELL_VIEWPORTS) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
      const detailHero = page.locator(".recipe-detail__hero");
      const readingPanels = page.locator(".recipe-detail__body");
      await expect(
        page.getByRole("heading", {
          name: "Garden Cream Tomato Soup",
          level: 1,
        }),
      ).toBeVisible();
      await expect(detailHero).toHaveCount(1);
      await expect(readingPanels).toHaveCount(1);
      expect(
        await detailHero.evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].hero);
      expect(
        await readingPanels.evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].reading);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
      const highlights = page.getByRole("list", {
        name: "Changes at a glance",
      });
      const versions = page
        .getByRole("navigation", { name: "Compared recipes" })
        .locator("ol");
      await expect(highlights).toBeVisible();
      await expect(highlights).toHaveCount(1);
      await expect(versions).toHaveCount(1);
      expect(
        await highlights.evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].highlights);
      expect(
        await versions.evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].versions);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/cooks/baseline-cook");
      const cookRecipes = page.getByRole("list", {
        name: "Public recipes by Baseline Cook",
      });
      await expect(cookRecipes).toBeVisible();
      await expect(cookRecipes).toHaveCount(1);
      expect(
        await cookRecipes.evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
      ).toBe(expectedColumns[viewport.label].cook);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/community-rules");
      const rules = page.locator(".policy-page__sections");
      await expect(
        page.getByRole("heading", { name: "Community rules", level: 1 }),
      ).toBeVisible();
      await expect(rules).toHaveCount(1);
      expect(
        await rules.evaluate(
          (grid) =>
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
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      await setScenario("anonymous-session");
      await page.goto(
        "/sign-in?return_to=%2Faccount%2Frecipes%3Fview%3Ddrafts",
      );
      await expect(
        page.getByRole("heading", { name: "Sign in to Recipe Lab", level: 1 }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("banner")
          .getByRole("link", { name: "Sign in", exact: true }),
      ).toBeVisible();
      await expectNoVisiblePrivateMaterial(page);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await setScenario("normal");
      await page.goto("/account/recipes?view=drafts");
      await expect(
        page.getByRole("list", { name: "Private recipe drafts" }),
      ).toBeVisible();
      const recipeViews = page.getByRole("navigation", {
        name: "My recipe views",
      });
      for (const viewName of ["Drafts", "Published", "Saved", "Withdrawn"]) {
        await expect(
          recipeViews.getByRole("link", { name: viewName }),
        ).toBeVisible();
      }
      await expectNoVisiblePrivateMaterial(page);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/account/recipes?view=saved");
      await expect(
        page.getByRole("list", { name: "Saved recipes" }),
      ).toBeVisible();
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
      await expect(profileTab).toHaveAttribute("aria-selected", "true");
      await expect(dangerTab).toHaveAttribute("aria-selected", "false");
      await expect(
        page.locator("#account-settings-profile-panel"),
      ).toBeVisible();
      await expect(
        page.locator("#account-settings-danger-panel"),
      ).toBeHidden();
      await dangerTab.click();
      await expect(
        page.getByRole("heading", { name: "Delete account", level: 3 }),
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

test("public recipe retry refetches the failed route", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await setScenario("public-context-failure");
  await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
  await expect(
    page.getByRole("heading", {
      name: "We couldn’t load this recipe.",
      level: 1,
    }),
  ).toBeVisible();

  await setScenario("normal");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Garden Cream Tomato Soup", level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Recipe details · Recipe Lab");
  await expectNoAccessibilityViolations(page);
});

