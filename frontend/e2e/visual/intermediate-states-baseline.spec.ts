import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  PHONE_PROJECT,
  DRAFT_ID,
  ROOT_RECIPE_ID,
  VARIANT_RECIPE_ID,
  setScenario,
  installMemberSession,
  gotoMemberHome,
  stabilizeVisuals,
  expectNoAccessibilityViolations,
  expectNoHorizontalOverflow,
  expectHomepageDashboardReady,
  expectNoVisiblePrivateMaterial,
  captureBaseline,
  desktopOnly,
  phoneOnly,
  captureStaffToolsSelections,
  captureAccountSettingsTabs,
  expectAccountActivityReady,
  expectNormalStaffWorkspace,
  submitStaleCuratorDecision,
  RCP46F_STAFF_ROUTES,
  registerVisualBaselineHooks,
} from "./visual-baseline-support";

registerVisualBaselineHooks();

test("home intermediate normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await gotoMemberHome(page);
  await expect(
    page.getByRole("heading", {
      name: "Featured recipes",
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
  await expect(
    page.getByRole("list", { name: "Recipe results" }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("list", { name: "Changes at a glance" }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", { name: "Ingredient requests", exact: true }),
  ).toHaveCount(0);
  await stabilizeVisuals(page);
  await expectNoVisiblePrivateMaterial(page);
  await captureBaseline(page, "my-recipes-intermediate-normal");
});

test("authoring entry desktop normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await setScenario("slow-draft-creation");
  await installMemberSession(page.context());
  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.goto("/recipes/new");
  await expect(
    page.getByRole("status").filter({
      hasText: "Preparing a private workspace for your new recipe.",
    }),
  ).toHaveText("Preparing a private workspace for your new recipe.");
  await stabilizeVisuals(page);
  await captureBaseline(page, "authoring-entry-desktop-normal");

  const forkPage = await page.context().newPage();
  await forkPage.goto(`/recipes/${VARIANT_RECIPE_ID}/fork`);
  await expect(
    forkPage.getByRole("status").filter({
      hasText:
        "Copying this recipe into a private workspace. The public recipe stays unchanged.",
    }),
  ).toHaveText(
    "Copying this recipe into a private workspace. The public recipe stays unchanged.",
  );
  await expectNoHorizontalOverflow(forkPage);
  await expectNoAccessibilityViolations(forkPage);
  await forkPage.close();
});

test("draft editor intermediate normal", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await page.goto(`/recipes/drafts/${DRAFT_ID}`);
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
  await page
    .getByRole("button", { name: /^(?:Finish recipe|Publish draft)$/ })
    .click();
  const publishDialog = page.getByRole("dialog", {
    name: "Ready to share your recipe?",
  });
  await expect(publishDialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review and publish" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Draft saved", exact: true }),
  ).toBeDisabled();
  await expect(
    publishDialog.getByRole("link", { name: "community rules" }),
  ).toBeVisible();
  await expect(
    publishDialog.getByText(
      "You can withdraw a published recipe later from My Recipes.",
    ),
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
  await page.goto(`/recipes/drafts/${DRAFT_ID}`);
  const unresolved = page.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  await expect(
    unresolved.getByRole("combobox", { name: "Ingredient" }),
  ).toHaveValue("Sunberry tomato");
  await expect(unresolved.getByRole("status")).toContainText(
    "Pending review",
  );
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

test("publish dialog is keyboard reachable", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 1_440, height: 900 });
  await setScenario("fork-draft");
  await page.goto(`/recipes/drafts/${DRAFT_ID}`);
  await page
    .getByRole("button", { name: /^(?:Finish recipe|Publish draft)$/ })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Ready to share your version?",
  });
  const close = dialog.getByRole("button", {
    name: "Close publish dialog",
  });
  const keepEditing = dialog.getByRole("button", { name: "Keep editing" });
  await expect(close).toBeFocused();
  await stabilizeVisuals(page);
  await expectNoHorizontalOverflow(page);
  const dialogAccessibility = await new AxeBuilder({ page })
    .include("#recipe-workspace-finish")
    .analyze();
  expect(dialogAccessibility.violations).toEqual([]);
  await expect(dialog).toHaveScreenshot("draft-publish-dialog.png");
  await page.keyboard.press("Shift+Tab");
  await expect(keepEditing).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Publish draft" }),
  ).toBeFocused();
});

test("fork draft header normal", async ({ page }, testInfo) => {
  const phone = testInfo.project.name === PHONE_PROJECT;
  await page.setViewportSize(
    phone ? { width: 390, height: 844 } : { width: 1_440, height: 900 },
  );
  await setScenario("fork-draft");
  await page.goto(`/recipes/drafts/${DRAFT_ID}`);

  const editor = page.getByRole("form", {
    name: "Private recipe draft editor",
  });
  await expect(editor).toBeVisible();
  await expect(
    editor.locator(".recipe-detail__version-badge"),
  ).toHaveText("Draft");
  await expect(editor.getByText("New private recipe")).toHaveCount(0);
  await expect(editor.getByText("Editing privately")).toHaveCount(0);

  const parentContext = editor.locator(".recipe-detail__parent-context");
  await expect(parentContext).toHaveText(
    "Based on Sunlit Tomato Soup by Recipe Lab catalog",
  );
  await expect(
    parentContext.getByRole("link", { name: "Sunlit Tomato Soup" }),
  ).toHaveAttribute("href", `/recipes/${ROOT_RECIPE_ID}`);
  await expect(
    parentContext.getByRole("link", { name: "Recipe Lab catalog" }),
  ).toHaveAttribute("href", "/cooks/recipe-lab");
  await expect(
    editor.locator(
      ".recipe-workspace__title-heading + .recipe-detail__parent-context",
    ),
  ).toBeVisible();
  await expect(
    editor.locator(
      ".recipe-detail__parent-context + .recipe-workspace__description-field",
    ),
  ).toBeVisible();

  await stabilizeVisuals(page);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot("draft-fork-header-normal.png");
});

test("sparse own cook profile stays compact", async ({ page }, testInfo) => {
  const phone = testInfo.project.name === PHONE_PROJECT;
  await page.setViewportSize(
    phone ? { width: 390, height: 844 } : { width: 1_292, height: 1_200 },
  );
  await setScenario("sparse-own-profile");
  await page.goto("/cooks/baseline-cook");

  const header = page.locator(".cook-profile__header:visible");
  await expect(header).toBeVisible();
  await expect(header.locator(".cook-profile__description")).toHaveCount(0);
  await expect(header.getByRole("button", { name: /follow/i })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Follow" })).toHaveCount(0);
  const unusedHeaderSpace = await header.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const paddingBottom = Number.parseFloat(
      getComputedStyle(element).paddingBottom,
    );
    const contentBottom = Math.max(
      ...Array.from(element.children, (child) =>
        child.getBoundingClientRect().bottom,
      ),
    );
    return bounds.bottom - paddingBottom - contentBottom;
  });
  expect(unusedHeaderSpace).toBeLessThanOrEqual(1);

  await stabilizeVisuals(page);
  await captureBaseline(page, "cook-profile-sparse-owner");
});

test("staff tools intermediate visual evidence", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await setScenario("normal");
  await page.goto("/staff");
  await captureStaffToolsSelections(
    page,
    "staff-tools-normal-intermediate",
    "staff-tools-moderator-selected-intermediate",
  );
});

test("account activity intermediate visual evidence", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await setScenario("activity-normal");
  await page.goto("/account/activity");
  await expectAccountActivityReady(page);
  await stabilizeVisuals(page);
  await captureBaseline(page, "account-activity-normal-intermediate");
});

test("account settings intermediate visual evidence", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await setScenario("normal");
  await page.goto("/account/settings");
  await captureAccountSettingsTabs(
    page,
    "account-settings-profile-intermediate-normal",
    "account-settings-danger-intermediate-normal",
  );
});

test("curator intermediate visual evidence", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await setScenario("curator-session");
  await page.goto(RCP46F_STAFF_ROUTES.curator.path);
  await expectNormalStaffWorkspace(page, "curator");
  await stabilizeVisuals(page);
  await captureBaseline(page, "ingredient-request-staff-review-intermediate");
});

test("member ingredient requests intermediate visual evidence", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await page.setViewportSize({ width: 820, height: 1_000 });
  await setScenario("normal");
  await page.goto("/account/ingredient-requests");
  await expect(
    page.getByRole("heading", { name: "Ingredient Requests", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Ingredient request: Sunberry tomato" }),
  ).toBeVisible();
  await stabilizeVisuals(page);
  await captureBaseline(page, "my-ingredient-requests-intermediate");
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
  await expect(page.getByLabel("Display name")).toHaveValue(
    "Baseline New Cook",
  );
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
    page.getByRole("heading", {
      name: "We couldn’t find that page.",
      level: 1,
    }),
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
  await captureBaseline(page, "stale-curation-decision");
});

