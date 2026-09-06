import { expect, test } from "@playwright/test";

import {
  DRAFT_ID,
  GRAM_UNIT_ID,
  VARIANT_RECIPE_ID,
  setScenario,
  gotoMemberHome,
  stabilizeVisuals,
  expectHomepageDashboardReady,
  captureBaseline,
  desktopOnly,
  captureStaffToolsSelections,
  captureAccountSettingsTabs,
  expectAccountActivityReady,
  selectActivityFilter,
  registerVisualBaselineHooks,
} from "./visual-baseline-support";

registerVisualBaselineHooks();

test.describe("desktop visual state matrix", () => {
  test.beforeEach(async ({}, testInfo) => desktopOnly(testInfo));

  test("home normal", async ({ page }) => {
    await gotoMemberHome(page);
    await expect(
      page.getByRole("heading", {
        name: "Featured recipes",
      }),
    ).toBeVisible();
    await expectHomepageDashboardReady(page);
    await stabilizeVisuals(page);
    await captureBaseline(page, "home-normal");
  });

  test("staff tools normal", async ({ page }) => {
    await setScenario("normal");
    await page.goto("/staff");
    await captureStaffToolsSelections(
      page,
      "staff-tools-normal",
      "staff-tools-moderator-selected",
    );
  });

  test("account activity normal", async ({ page }) => {
    await setScenario("activity-normal");
    await page.goto("/account/activity");
    await expectAccountActivityReady(page);
    await stabilizeVisuals(page);
    await captureBaseline(page, "account-activity-normal");

    await selectActivityFilter(page, "Saved");
    const activity = page.getByRole("region", { name: "Account activity" });
    await expect(
      activity.getByRole("link", {
        name: /Garlic Butter Shrimp Pasta/,
      }),
    ).toBeVisible();
    await expect(
      activity.getByRole("link", { name: /Sourdough Bread/ }),
    ).toBeVisible();
    await expect(
      activity.getByRole("link", { name: /Sumac/ }),
    ).toHaveCount(0);
    await expect(
      activity.getByRole("heading", { name: "Today", level: 2 }),
    ).toHaveCount(0);
    await captureBaseline(page, "account-activity-saved-filtered");

    await selectActivityFilter(page, "All");
    await activity
      .getByRole("searchbox", { name: "Search activity", exact: true })
      .fill("No baseline matches");
    await expect(
      activity.getByRole("heading", {
        name: "No activity matches your search.",
        level: 3,
      }),
    ).toBeVisible();
    await expect(
      activity.getByRole("heading", { name: "Yesterday", level: 2 }),
    ).toHaveCount(0);
    await captureBaseline(page, "account-activity-no-matches");
  });

  test("account settings normal", async ({ page }) => {
    await setScenario("normal");
    await page.goto("/account/settings");
    await captureAccountSettingsTabs(
      page,
      "account-settings-profile-normal",
      "account-settings-danger-normal",
    );
  });

  test("home and account navigation normal", async ({ page }) => {
    await gotoMemberHome(page);
    await expect(
      page.getByRole("heading", {
        name: "Featured recipes",
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
    const accountPanel = page.locator(".account-menu__panel");
    await expect(
      accountPanel.getByRole("link", { name: "My recipes" }),
    ).toBeVisible();
    await expect(
      accountPanel.getByRole("link", { name: "Requests", exact: true }),
    ).toHaveAttribute("href", "/account/ingredient-requests");
    await captureBaseline(page, "home-account-navigation");
  });

  test("catalog normal", async ({ page }) => {
    await page.goto("/recipes");
    await expect(
      page.getByRole("heading", { name: "All recipes", level: 1 }),
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

    await page.getByRole("tab", { name: "Family" }).click();
    const history = page.getByRole("heading", {
      name: "Recipe family",
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
    await expect(
      page.getByRole("heading", { name: "Recipes", exact: true, level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByText("Only publicly readable versions appear here."),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "← All recipes", exact: true }),
    ).toHaveCount(0);
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
      page.getByRole("heading", {
        name: "We couldn’t load this recipe.",
        level: 1,
      }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-detail-error");
  });

  test("public recipe unavailable", async ({ page }) => {
    await page.goto("/recipes/20000000-0000-4000-8000-000000000099");
    await expect(
      page.getByRole("heading", {
        name: "This recipe isn’t available.",
        level: 1,
      }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "recipe-detail-unavailable");
  });

  test("my recipes normal", async ({ page }) => {
    await page.goto("/account/recipes?view=drafts");
    await expect(
      page.getByRole("list", { name: "Private recipe drafts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ingredient requests", exact: true }),
    ).toHaveCount(0);
    await stabilizeVisuals(page);
    await captureBaseline(page, "my-recipes-normal");
  });

  test("draft ingredient editor normal", async ({ page }) => {
    await page.goto(`/recipes/drafts/${DRAFT_ID}`);
    const ingredient = page.getByRole("group", {
      name: "Ingredient 1",
      exact: true,
    });
    await ingredient
      .getByRole("button", {
        name: "Edit amount for ingredient 1",
        exact: true,
      })
      .click();
    const amountEditor = ingredient.getByRole("dialog", {
      name: "Amount for ingredient 1",
      exact: true,
    });
    await expect(
      amountEditor.getByRole("textbox", { name: "Amount", exact: true }),
    ).toHaveValue("800");
    await expect(
      amountEditor.getByRole("combobox", { name: "Unit", exact: true }),
    ).toHaveValue(GRAM_UNIT_ID);
    await amountEditor
      .getByRole("button", { name: "Done", exact: true })
      .click();
    await expect(
      ingredient.getByRole("combobox", { name: "Ingredient" }),
    ).toHaveValue("plum tomatoes");
    await expect(
      ingredient.getByLabel("Note for ingredient 1 (optional)", {
        exact: true,
      }),
    ).toHaveValue("roughly chopped");
    await ingredient.evaluate((section) => {
      section.scrollIntoView({ block: "start" });
      window.scrollBy(0, -80);
    });
    await stabilizeVisuals(page);
    await captureBaseline(page, "draft-ingredient-editor-normal");

    const step = page.getByRole("group", { name: "Step 1", exact: true });
    await expect(step.getByLabel("Instruction", { exact: true })).toBeVisible();
    await step.evaluate((section) => {
      section.scrollIntoView({ block: "start" });
      window.scrollBy(0, -80);
    });
    await captureBaseline(page, "draft-instruction-editor-normal");
    await page.getByRole("tab", { name: "Cooking breakdown" }).click();
    const cookingDetails = page.getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
    });
    await cookingDetails.click();
    await expect(
      page.getByRole("dialog", { name: "Cooking detail 1 for Step 1" }),
    ).toBeVisible();
    await captureBaseline(page, "draft-instruction-editor-expanded");
  });

  test("draft editor validation", async ({ page }) => {
    await setScenario("incomplete-draft");
    await page.goto(`/recipes/drafts/${DRAFT_ID}`);
    await expect(
      page.getByRole("textbox", { name: "Title", exact: true }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await page
      .getByRole("button", { name: /^(?:Finish recipe|Publish draft)$/ })
      .click();
    await page
      .getByRole("checkbox", {
        name: /right to share this recipe.*community rules/i,
      })
      .check();
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
    await page.goto(`/recipes/drafts/${DRAFT_ID}`);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
      "Late-Summer Tomato Pot",
    );
    await stabilizeVisuals(page);
    await page
      .getByRole("button", { name: /^(?:Finish recipe|Publish draft)$/ })
      .click();
    await page
      .getByRole("checkbox", {
        name: /right to share this recipe.*community rules/i,
      })
      .check();
    await page
      .getByRole("button", { name: "Review and publish", exact: true })
      .click();
    const publishAnyway = page.getByRole("button", {
      name: "Publish recipe",
      exact: true,
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
    await captureBaseline(page, "ingredient-request-staff-review");
  });

  test("member ingredient requests", async ({ page }) => {
    await setScenario("normal");
    await page.goto("/account/ingredient-requests");
    await expect(
      page.getByRole("heading", { name: "Ingredient Requests", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Ingredient request: Sunberry tomato" }),
    ).toBeVisible();
    await stabilizeVisuals(page);
    await captureBaseline(page, "my-ingredient-requests");
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
      page.getByRole("status").filter({ hasText: "Checking your account…" }),
    ).toContainText("Checking your account…");
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

