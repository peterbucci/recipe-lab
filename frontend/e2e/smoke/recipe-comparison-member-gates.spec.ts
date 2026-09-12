import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  expectCarrotComparisonToShowCompleteRecipe,
  openCarrotRoot,
  reachWithKeyboard,
} from "./home-support";

async function expectControlsInKeyboardOrder(
  page: Page,
  controls: readonly { label: string; locator: Locator }[],
): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  let expectedIndex = 0;
  for (let step = 0; step < 80 && expectedIndex < controls.length; step += 1) {
    await page.keyboard.press("Tab");

    let focusedIndex = -1;
    for (let index = 0; index < controls.length; index += 1) {
      if (
        await controls[index]!.locator.evaluate(
          (element) => element === element.ownerDocument.activeElement,
        )
      ) {
        focusedIndex = index;
        break;
      }
    }

    if (focusedIndex === -1) continue;
    expect(
      focusedIndex,
      `Expected ${controls[expectedIndex]!.label} before ${controls[focusedIndex]!.label} in the tab order.`,
    ).toBe(expectedIndex);
    await expect(controls[expectedIndex]!.locator).toBeFocused();
    expectedIndex += 1;
  }

  expect(
    expectedIndex,
    `Keyboard focus did not reach ${controls[expectedIndex]?.label ?? "every required comparison control"}.`,
  ).toBe(controls.length);
}

async function expectColorIndependentBreakdownChanges(
  breakdownPanel: Locator,
): Promise<void> {
  const currentBreakdown = breakdownPanel.locator(
    'ins.recipe-comparison-action-group--added',
  );
  const previousBreakdown = breakdownPanel.locator(
    'del.recipe-comparison-action-group--removed',
  );
  expect(await currentBreakdown.count()).toBeGreaterThan(0);
  expect(await previousBreakdown.count()).toBeGreaterThan(0);
  await expect(
    currentBreakdown
      .first()
      .locator(".recipe-comparison-action-group__change-label"),
  ).toContainText("Current cooking breakdown");
  await expect(
    previousBreakdown
      .first()
      .locator(".recipe-comparison-action-group__change-label"),
  ).toContainText("Previous cooking breakdown");
  await expect(
    currentBreakdown.first().locator(".recipe-comparison-actions--added"),
  ).toBeVisible();
  await expect(
    previousBreakdown.first().locator(".recipe-comparison-actions--removed"),
  ).toBeVisible();
}

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
  const comparison = await expectCarrotComparisonToShowCompleteRecipe(page, {
    baseRecipeVersionId: parentRecipeVersionId,
    targetRecipeVersionId,
  });

  const comparisonHero = page.locator(
    ".recipe-diff-view:visible .recipe-comparison-hero",
  );
  await expectControlsInKeyboardOrder(page, [
    {
      label: "the Explore breadcrumb",
      locator: page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("link", { name: "Explore", exact: true }),
    },
    {
      label: "View starting recipe",
      locator: comparisonHero.getByRole("link", {
        name: "View starting recipe",
        exact: true,
      }),
    },
    {
      label: "Back to the current recipe",
      locator: comparisonHero.getByRole("link", {
        name: "Back to Lower-Sugar Pecan Carrot Cake",
        exact: true,
      }),
    },
    { label: "the selected Recipe tab", locator: comparison.recipeTab },
    { label: "the selected Steps tab", locator: comparison.stepsTab },
  ]);

  const comparisonUrl = page.url();
  await comparison.stepsTab.press("ArrowRight");
  await expect(comparison.breakdownTab).toBeFocused();
  await expect(comparison.breakdownTab).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(comparison.stepsPanel).toBeHidden();
  await expect(comparison.breakdownPanel).toBeVisible();
  await expectColorIndependentBreakdownChanges(comparison.breakdownPanel);
  await expect(page).toHaveURL(comparisonUrl);
  await comparison.breakdownTab.press("Home");
  await expect(comparison.stepsTab).toBeFocused();
  await expect(comparison.stepsPanel).toBeVisible();

  await comparison.recipeTab.focus();
  await comparison.recipeTab.press("ArrowRight");
  await expect(comparison.notesTab).toBeFocused();
  await expect(comparison.notesTab).toHaveAttribute("aria-selected", "true");
  await expect(comparison.recipePanel).toBeHidden();
  await expect(comparison.notesPanel).toBeVisible();
  await expect(
    comparison.notesPanel.getByText("No notes were added for this recipe."),
  ).toBeVisible();
  await expect(page).toHaveURL(`${comparison.comparisonHref}#recipe-notes`);

  await comparison.notesTab.press("ArrowRight");
  await expect(comparison.familyTab).toBeFocused();
  await expect(comparison.familyTab).toHaveAttribute("aria-selected", "true");
  await expect(comparison.notesPanel).toBeHidden();
  await expect(comparison.familyPanel).toBeVisible();
  await expect(
    comparison.familyPanel.getByRole("heading", {
      name: "Recipe family",
      level: 2,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${comparison.comparisonHref}#recipe-family`);

  await comparison.familyTab.press("Home");
  await expect(comparison.recipeTab).toBeFocused();
  await expect(comparison.recipeTab).toHaveAttribute("aria-selected", "true");
  await expect(comparison.recipePanel).toBeVisible();
  await expect(comparison.familyPanel).toBeHidden();
  await expect(page).toHaveURL(`${comparison.comparisonHref}#ingredients`);

  await comparison.recipeTab.press("End");
  await expect(comparison.familyTab).toBeFocused();
  await expect(comparison.familyTab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(`${comparison.comparisonHref}#recipe-family`);

  await page.goto(`${comparison.comparisonHref}#recipe-notes`);
  await expect(comparison.notesTab).toHaveAttribute("aria-selected", "true");
  await expect(comparison.notesPanel).toBeVisible();
  await expect(comparison.recipePanel).toBeHidden();
  expect(new URL(page.url()).searchParams.get("base_version_id")).toBe(
    parentRecipeVersionId,
  );
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

  const targetMatch = childRecipeHref!.match(/^\/recipes\/([^/]+)$/);
  if (!targetMatch) {
    throw new Error("Could not read the child recipe version identifier.");
  }
  const comparison = await expectCarrotComparisonToShowCompleteRecipe(page, {
    baseRecipeVersionId: parentRecipeVersionId,
    targetRecipeVersionId: decodeURIComponent(targetMatch[1]),
  });
  await comparison.ingredients.scrollIntoViewIfNeeded();
  await expect(comparison.ingredients).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await comparison.instructions.scrollIntoViewIfNeeded();
  await expect(comparison.instructions).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await comparison.breakdownTab.click();
  await expect(comparison.breakdownPanel).toBeVisible();
  await expect(comparison.stepsPanel).toBeHidden();
  await expectColorIndependentBreakdownChanges(comparison.breakdownPanel);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await comparison.stepsTab.click();

  await comparison.notesTab.click();
  await expect(comparison.notesTab).toHaveAttribute("aria-selected", "true");
  await expect(comparison.notesPanel).toBeVisible();
  await expect(page).toHaveURL(`${comparison.comparisonHref}#recipe-notes`);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await comparison.familyTab.click();
  await expect(comparison.familyTab).toBeFocused();
  await expect(comparison.familyTab).toHaveAttribute("aria-selected", "true");
  await expect(comparison.familyPanel).toBeVisible();
  await expect(page).toHaveURL(`${comparison.comparisonHref}#recipe-family`);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
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
      name: "Sign in to continue.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Sign in to continue." })
      .getByRole("link", { name: "Sign in", exact: true }),
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
      name: "Finish setting up your account.",
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
