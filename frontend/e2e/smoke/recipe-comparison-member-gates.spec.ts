import { expect, test } from "@playwright/test";

import {
  expectCarrotComparisonToExplainItsChanges,
  openCarrotRoot,
  reachWithKeyboard,
} from "./home-support";

test("compares a selected family recipe with the open recipe without signing in", async ({
  page,
}) => {
  const parentRecipeVersionId = await openCarrotRoot(page);
  const openRecipeUrl = page.url();

  await page.getByRole("tab", { name: "Family", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Family", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(openRecipeUrl + "#recipe-family");
  const childSelector = page.getByRole("button", {
    name: "Show Lower-Sugar Pecan Carrot Cake in the family tree",
  });
  await childSelector.press("Enter");
  await expect(page).toHaveURL(openRecipeUrl + "#recipe-family");
  await expect(
    page.getByLabel("Selected family recipe: Lower-Sugar Pecan Carrot Cake"),
  ).toBeVisible();
  const childRecipeLink = page.getByRole("link", {
    name: "Lower-Sugar Pecan Carrot Cake",
    exact: true,
  });
  const childRecipeHref = await childRecipeLink.getAttribute("href");
  expect(childRecipeHref).toMatch(/^\/recipes\/[0-9a-f-]+$/i);
  await childRecipeLink.click();
  await expect(page).toHaveURL(childRecipeHref!);
  await expect(
    page.getByRole("heading", {
      name: "Lower-Sugar Pecan Carrot Cake",
      level: 1,
    }),
  ).toBeVisible();

  await page.goto(openRecipeUrl);
  await page.getByRole("tab", { name: "Family", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Family", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(openRecipeUrl + "#recipe-family");
  await page
    .getByRole("button", {
      name: "Show Lower-Sugar Pecan Carrot Cake in the family tree",
    })
    .press("Enter");
  const compareLink = page.getByRole("link", {
    name: /compare with carrot walnut snack cake/i,
  });
  const targetMatch = (await compareLink.getAttribute("href"))?.match(
    /^\/recipes\/([^/]+)\/compare\?base_version_id=([^&]+)$/,
  );
  if (!targetMatch) {
    throw new Error("Could not read the child recipe version identifier.");
  }
  const targetRecipeVersionId = decodeURIComponent(targetMatch[1]);
  expect(decodeURIComponent(targetMatch[2])).toBe(parentRecipeVersionId);

  await reachWithKeyboard(page, compareLink);
  await expect(compareLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    `/recipes/${targetRecipeVersionId}/compare?base_version_id=${parentRecipeVersionId}`,
  );
  await expect(
    page.getByRole("heading", {
      name: "How Lower-Sugar Pecan Carrot Cake changed",
      level: 1,
    }),
  ).toBeVisible();

  await expectCarrotComparisonToExplainItsChanges(page);

  const comparedRecipes = page.getByRole("navigation", {
    name: "Compared recipes",
  });
  const parentLink = comparedRecipes.getByRole("link", {
    name: /starting recipe.*carrot walnut snack cake/i,
  });
  await expect(
    comparedRecipes.getByRole("link", {
      name: /this recipe.*lower-sugar pecan carrot cake/i,
    }),
  ).toBeVisible();
  await parentLink.focus();
  await expect(parentLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/recipes/${parentRecipeVersionId}`);
});

test("keeps the selected family comparison usable at a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const parentRecipeVersionId = await openCarrotRoot(page);
  await page.getByRole("tab", { name: "Family", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Show Lower-Sugar Pecan Carrot Cake in the family tree",
    })
    .press("Enter");
  const childRecipeLink = page.getByRole("link", {
    name: "Lower-Sugar Pecan Carrot Cake",
    exact: true,
  });
  const childRecipeHref = await childRecipeLink.getAttribute("href");
  expect(childRecipeHref).toMatch(/^\/recipes\/[0-9a-f-]+$/i);
  const compareLink = page.getByRole("link", {
    name: /compare with carrot walnut snack cake/i,
  });
  await expect(compareLink).toHaveAttribute(
    "href",
    new RegExp(`\\?base_version_id=${parentRecipeVersionId}$`),
  );
  await reachWithKeyboard(page, compareLink);
  await expect(compareLink).toBeFocused();
  await page.keyboard.press("Enter");

  const summary = await expectCarrotComparisonToExplainItsChanges(page);
  await summary.scrollIntoViewIfNeeded();
  await expect(summary).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const sourceLink = page
    .getByRole("navigation", { name: "Compared recipes" })
    .getByRole("link", { name: /starting recipe.*carrot walnut snack cake/i });
  await sourceLink.focus();
  await expect(sourceLink).toBeFocused();
});

test("requires sign-in for save, rate, recorded-view, and fork actions", async ({
  page,
}) => {
  let recordedViews = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/view")) {
      recordedViews += 1;
    }
  });
  const recipeVersionId = await openCarrotRoot(page);

  await expect(
    page.getByRole("button", { name: "Save recipe", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rate recipe", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Make your own version",
      exact: true,
    }),
  ).toHaveAttribute(
    "href",
    `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
  );
  await page.getByRole("button", { name: "Rate recipe", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Sign in to rate recipes" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Sign in to rate recipes" })
      .getByRole("link", { name: "Sign in", exact: true }),
  ).toHaveAttribute(
    "href",
    `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}`,
  );
  expect(recordedViews).toBe(0);

  await page.goto(`/recipes/${recipeVersionId}/fork`);
  await expect(
    page.getByRole("heading", {
      name: "Page Unavailable",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign In", exact: true }),
  ).toHaveAttribute(
    "href",
    `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
  );
});

test("requires account setup before exposing member recipe actions", async ({
  page,
}) => {
  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "onboarding_required",
        user: {
          id: "pending-member",
          display_name: "Pending Member",
          handle: null,
        },
      }),
    });
  });
  const recipeVersionId = await openCarrotRoot(page);

  await expect(
    page.getByRole("link", { name: /make your own version/i }),
  ).toHaveAttribute(
    "href",
    `/onboarding?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
  );
  await expect(
    page.getByRole("region", { name: /save and rate/i }),
  ).toHaveCount(0);

  await page.goto(`/recipes/${recipeVersionId}/fork`);
  await expect(
    page.getByRole("heading", {
      name: "Finish setting up your account",
      level: 1,
    }),
  ).toBeVisible();
});

test("keeps the anonymous recipe detail gate usable at a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCarrotRoot(page);

  await page.getByRole("button", { name: "Rate recipe", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Sign in to rate recipes" });
  await expect(prompt).toBeVisible();
  const promptBox = await prompt.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(promptBox!.x).toBeGreaterThanOrEqual(0);
  expect(promptBox!.x + promptBox!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

