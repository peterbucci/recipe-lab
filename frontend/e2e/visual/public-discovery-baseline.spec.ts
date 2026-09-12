import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  REVIEWED_SHELL_VIEWPORTS,
  ROOT_RECIPE_ID,
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

async function expectGridColumnCount(grid: Locator, expected: number) {
  await expect
    .poll(() =>
      grid.evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
    )
    .toBe(expected);
}

async function expectContainedBy(
  child: Locator,
  container: Locator,
): Promise<void> {
  const [childBox, containerBox] = await Promise.all([
    child.boundingBox(),
    container.boundingBox(),
  ]);
  expect(childBox).not.toBeNull();
  expect(containerBox).not.toBeNull();
  expect(childBox!.x).toBeGreaterThanOrEqual(containerBox!.x - 0.5);
  expect(childBox!.y).toBeGreaterThanOrEqual(containerBox!.y - 0.5);
  expect(childBox!.x + childBox!.width).toBeLessThanOrEqual(
    containerBox!.x + containerBox!.width + 0.5,
  );
  expect(childBox!.y + childBox!.height).toBeLessThanOrEqual(
    containerBox!.y + containerBox!.height + 0.5,
  );
}

async function expectSameHorizontalBounds(
  child: Locator,
  container: Locator,
): Promise<void> {
  const [childBox, containerBox] = await Promise.all([
    child.boundingBox(),
    container.boundingBox(),
  ]);
  expect(childBox).not.toBeNull();
  expect(containerBox).not.toBeNull();
  expect(Math.abs(childBox!.x - containerBox!.x)).toBeLessThanOrEqual(0.5);
  expect(
    Math.abs(
      childBox!.x + childBox!.width - (containerBox!.x + containerBox!.width),
    ),
  ).toBeLessThanOrEqual(0.5);
}

async function expectComparisonTabsAndActions(
  page: Page,
  layout: "columns" | "rows",
): Promise<void> {
  const comparisonView = page.locator(".recipe-diff-view:visible");
  const tablist = comparisonView.getByRole("tablist", {
    name: "Recipe sections",
  });
  const tabs = tablist.getByRole("tab");
  const recipeTab = tablist.getByRole("tab", {
    name: "Recipe",
    exact: true,
  });
  const notesTab = tablist.getByRole("tab", { name: "Notes", exact: true });
  const familyTab = tablist.getByRole("tab", {
    name: "Family",
    exact: true,
  });
  const recipePanel = comparisonView.locator("#recipe-panel-recipe");
  const notesPanel = comparisonView.locator("#recipe-panel-notes");
  const familyPanel = comparisonView.locator("#recipe-panel-family");

  await expect(tabs).toHaveCount(3);
  await expect(recipeTab).toHaveAttribute("aria-selected", "true");
  await expect(notesTab).toHaveAttribute("aria-selected", "false");
  await expect(familyTab).toHaveAttribute("aria-selected", "false");
  await expect(recipePanel).toBeVisible();
  await expect(notesPanel).toBeHidden();
  await expect(familyPanel).toBeHidden();

  const instructions = recipePanel.getByRole("region", {
    name: "Instructions",
  });
  const instructionTabs = instructions.getByRole("tablist", {
    name: "Instruction comparison view",
  });
  const stepsTab = instructionTabs.getByRole("tab", {
    name: "Steps",
    exact: true,
  });
  const breakdownTab = instructionTabs.getByRole("tab", {
    name: "Cooking breakdown",
    exact: true,
  });
  const stepsPanel = instructions.locator(
    "#recipe-comparison-instructions-steps-panel",
  );
  const breakdownPanel = instructions.locator(
    "#recipe-comparison-instructions-breakdown-panel",
  );
  await expect(instructionTabs.getByRole("tab")).toHaveCount(2);
  await expect(stepsTab).toHaveAttribute("aria-selected", "true");
  await expect(stepsPanel).toBeVisible();
  await expect(breakdownPanel).toBeHidden();
  await expectContainedBy(stepsTab, instructionTabs);
  await expectContainedBy(breakdownTab, instructionTabs);
  await breakdownTab.click();
  await expect(stepsPanel).toBeHidden();
  await expect(breakdownPanel).toBeVisible();
  const changedBreakdown = breakdownPanel.locator(
    ".recipe-comparison-instruction-row--changed",
  );
  const cookingActions = changedBreakdown.getByRole("list", {
    name: "Cooking action comparison for step 1",
  });
  const actionRows = cookingActions.locator(
    ":scope > .recipe-comparison-action",
  );
  const addedActions = cookingActions.locator(
    ':scope > .recipe-comparison-action[data-action-status="added"]',
  );
  const unchangedActions = cookingActions.locator(
    ':scope > .recipe-comparison-action[data-action-status="unchanged"]',
  );
  const removedActions = cookingActions.locator(
    ':scope > .recipe-comparison-action[data-action-status="removed"]',
  );
  await expect(changedBreakdown).toHaveCount(1);
  await expect(cookingActions).toBeVisible();
  await expect(actionRows).toHaveCount(4);
  expect(
    await actionRows.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-action-status")),
    ),
  ).toEqual(["added", "unchanged", "removed", "added"]);
  await expect(addedActions).toHaveCount(2);
  await expect(unchangedActions).toHaveCount(1);
  await expect(removedActions).toHaveCount(1);
  await expect(unchangedActions).toContainText("Rest");
  await expect(addedActions.first().locator("ins")).toHaveText(
    "Added action:",
  );
  await expect(removedActions.locator("del")).toHaveText("Removed action:");
  await expectGridColumnCount(
    actionRows.first(),
    layout === "rows" ? 2 : 3,
  );
  await expectGridColumnCount(
    removedActions,
    layout === "rows" ? 2 : 3,
  );
  await expect(
    breakdownPanel.locator(".recipe-comparison-instruction-row__step-number"),
  ).toHaveText(["1", "2"]);
  await expect(
    changedBreakdown.locator(
      ".recipe-comparison-instruction-row__step-number",
    ),
  ).toBeVisible();
  await expect
    .poll(() =>
      changedBreakdown.evaluate(
        (element) => getComputedStyle(element, "::before").display,
      ),
    )
    .not.toBe("none");
  await stepsTab.click();

  for (let index = 0; index < 3; index += 1) {
    await expectContainedBy(tabs.nth(index), tablist);
  }
  const tabBoxes = await Promise.all(
    [0, 1, 2].map((index) => tabs.nth(index).boundingBox()),
  );
  for (const box of tabBoxes) {
    expect(box).not.toBeNull();
  }
  expect(tabBoxes[0]!.x + tabBoxes[0]!.width).toBeLessThanOrEqual(
    tabBoxes[1]!.x + 0.5,
  );
  expect(tabBoxes[1]!.x + tabBoxes[1]!.width).toBeLessThanOrEqual(
    tabBoxes[2]!.x + 0.5,
  );

  await notesTab.click();
  await expect(notesTab).toHaveAttribute("aria-selected", "true");
  await expect(recipePanel).toBeHidden();
  await expect(notesPanel).toBeVisible();
  await expect(familyPanel).toBeHidden();
  await expect(
    comparisonView.locator(".recipe-comparison-notes"),
  ).toBeVisible();
  await expect(page).toHaveURL(
    `/recipes/${VARIANT_RECIPE_ID}/compare#recipe-notes`,
  );

  await familyTab.click();
  await expect(familyTab).toHaveAttribute("aria-selected", "true");
  await expect(recipePanel).toBeHidden();
  await expect(notesPanel).toBeHidden();
  await expect(familyPanel).toBeVisible();
  await expect(
    familyPanel.getByRole("heading", { name: "Recipe family", level: 2 }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    `/recipes/${VARIANT_RECIPE_ID}/compare#recipe-family`,
  );

  await recipeTab.click();
  await expect(recipeTab).toHaveAttribute("aria-selected", "true");
  await expect(recipePanel).toBeVisible();
  await expect(notesPanel).toBeHidden();
  await expect(familyPanel).toBeHidden();
  await expect(page).toHaveURL(
    `/recipes/${VARIANT_RECIPE_ID}/compare#ingredients`,
  );

  const actions = comparisonView.locator(
    ".recipe-comparison-hero__actions",
  );
  const startingRecipe = actions.getByRole("link", {
    name: "View starting recipe",
  });
  const currentRecipe = actions.getByRole("link", {
    name: "Back to Garden Cream Tomato Soup",
  });
  await expect(actions.getByRole("link")).toHaveCount(2);
  await expect(startingRecipe).toHaveAttribute(
    "href",
    `/recipes/${ROOT_RECIPE_ID}`,
  );
  await expect(currentRecipe).toHaveAttribute(
    "href",
    `/recipes/${VARIANT_RECIPE_ID}`,
  );
  await expectContainedBy(startingRecipe, actions);
  await expectContainedBy(currentRecipe, actions);

  const [startingBox, currentBox] = await Promise.all([
    startingRecipe.boundingBox(),
    currentRecipe.boundingBox(),
  ]);
  expect(startingBox).not.toBeNull();
  expect(currentBox).not.toBeNull();
  if (layout === "columns") {
    expect(startingBox!.x + startingBox!.width).toBeLessThanOrEqual(
      currentBox!.x + 0.5,
    );
    expect(Math.abs(startingBox!.y - currentBox!.y)).toBeLessThanOrEqual(0.5);
  } else {
    expect(startingBox!.y + startingBox!.height).toBeLessThanOrEqual(
      currentBox!.y + 0.5,
    );
  }
}

async function expectCurrentBeforePrevious(row: Locator): Promise<void> {
  const current = row.locator('[data-comparison-value="current"]');
  const previous = row.locator('[data-comparison-value="previous"]');
  await expect(current).toBeVisible();
  await expect(previous).toBeVisible();
  const [currentBox, previousBox] = await Promise.all([
    current.boundingBox(),
    previous.boundingBox(),
  ]);
  expect(currentBox).not.toBeNull();
  expect(previousBox).not.toBeNull();
  expect(currentBox!.y + currentBox!.height).toBeLessThanOrEqual(
    previousBox!.y + 0.5,
  );
}

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
      await setScenario("normal");
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

      await expectGridColumnCount(results, expectedColumns[viewport.label]);
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
      name: "Sign in to continue.",
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
      comparisonHero: 2,
      comparisonBody: 2,
      comparisonFacts: 4,
      comparisonActions: 2,
      cook: 4,
      rules: 2,
    },
    intermediate: {
      hero: 1,
      reading: 1,
      comparisonHero: 1,
      comparisonBody: 1,
      comparisonFacts: 4,
      comparisonActions: 2,
      cook: 3,
      rules: 1,
    },
    phone: {
      hero: 1,
      reading: 1,
      comparisonHero: 1,
      comparisonBody: 1,
      comparisonFacts: 2,
      comparisonActions: 1,
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
      await expectGridColumnCount(
        detailHero,
        expectedColumns[viewport.label].hero,
      );
      await expectGridColumnCount(
        readingPanels,
        expectedColumns[viewport.label].reading,
      );
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await setScenario("comparison-actions");
      await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
      const comparisonView = page.locator(".recipe-diff-view:visible");
      const comparisonHero = comparisonView.locator(
        ".recipe-comparison-hero",
      );
      const comparisonBody = page.locator(
        ".recipe-diff-view:visible #recipe-panel-recipe .recipe-comparison-body",
      );
      const comparisonFacts = comparisonView.locator(
        ".recipe-comparison-hero__facts dl",
      );
      const comparisonActions = comparisonView.locator(
        ".recipe-comparison-hero__actions",
      );
      const changedIngredient = comparisonView.locator(
        ".recipe-comparison-ingredient-row--changed",
      );
      const changedInstruction = comparisonView.locator(
        "#recipe-comparison-instructions-steps-panel .recipe-comparison-instruction-row--changed",
      );
      await expect(
        page.getByRole("heading", {
          name: "Garden Cream Tomato Soup",
          level: 1,
        }),
      ).toBeVisible();
      await expect(comparisonHero).toHaveCount(1);
      await expect(comparisonBody).toHaveCount(1);
      await expect(comparisonFacts).toHaveCount(1);
      await expect(comparisonActions).toHaveCount(1);
      await expectGridColumnCount(
        comparisonHero,
        expectedColumns[viewport.label].comparisonHero,
      );
      await expectGridColumnCount(
        comparisonBody,
        expectedColumns[viewport.label].comparisonBody,
      );
      await expectGridColumnCount(
        comparisonFacts,
        expectedColumns[viewport.label].comparisonFacts,
      );
      await expectGridColumnCount(
        comparisonActions,
        expectedColumns[viewport.label].comparisonActions,
      );
      await expectCurrentBeforePrevious(changedIngredient);
      await expectCurrentBeforePrevious(changedInstruction);
      await expectGridColumnCount(
        changedIngredient
          .locator('[data-comparison-value="current"]')
          .locator(".recipe-comparison-ingredient-value"),
        2,
      );
      await expectGridColumnCount(
        changedIngredient
          .locator('[data-comparison-value="previous"]')
          .locator(".recipe-comparison-ingredient-value"),
        2,
      );
      await expectGridColumnCount(
        changedInstruction
          .locator('[data-comparison-value="current"]')
          .locator(".recipe-comparison-instruction-value"),
        2,
      );
      await expectGridColumnCount(
        changedInstruction
          .locator('[data-comparison-value="previous"]')
          .locator(".recipe-comparison-instruction-value"),
        1,
      );
      await expectComparisonTabsAndActions(
        page,
        viewport.label === "phone" ? "rows" : "columns",
      );
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/cooks/baseline-cook");
      const cookRecipes = page.getByRole("list", {
        name: "Public recipes by Baseline Cook",
      });
      await expect(cookRecipes).toBeVisible();
      await expect(cookRecipes).toHaveCount(1);
      await expectGridColumnCount(
        cookRecipes,
        expectedColumns[viewport.label].cook,
      );
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);

      await page.goto("/community-rules");
      const rules = page.locator(".policy-page__sections");
      await expect(
        page.getByRole("heading", { name: "Community rules", level: 1 }),
      ).toBeVisible();
      await expect(rules).toHaveCount(1);
      await expectGridColumnCount(rules, expectedColumns[viewport.label].rules);
      await expectNoHorizontalOverflow(page);
      await expectNoAccessibilityViolations(page);
    });
  }

  await test.step("instruction switches fill their stacked 680px headers", async () => {
    await setScenario("normal");
    await page.setViewportSize({ width: 680, height: 900 });

    await page.goto(`/recipes/${VARIANT_RECIPE_ID}`);
    const readerInstructionTabs = page.getByRole("tablist", {
      name: "Instruction view",
    });
    const readerInstructionHeader = page.locator(
      ".recipe-detail:visible .recipe-instructions__header",
    );
    await expect(readerInstructionTabs).toBeVisible();
    await expect(readerInstructionHeader).toBeVisible();
    await expectSameHorizontalBounds(
      readerInstructionTabs,
      readerInstructionHeader,
    );

    await setScenario("comparison-actions");
    await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
    const comparisonInstructions = page.getByRole("region", {
      name: "Instructions",
    });
    await expectSameHorizontalBounds(
      comparisonInstructions.getByRole("tablist", {
        name: "Instruction comparison view",
      }),
      comparisonInstructions.locator(
        ".recipe-comparison-instructions__header",
      ),
    );
    await expectNoHorizontalOverflow(page);
  });
});

test("recipe comparison switches both primary grids at the 900px boundary", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);

  for (const expectation of [
    { width: 901, columns: 2 },
    { width: 900, columns: 1 },
  ] as const) {
    await test.step(`${expectation.width}px`, async () => {
      await setScenario("comparison-actions");
      await page.setViewportSize({ width: expectation.width, height: 1_000 });
      await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
      const comparisonView = page.locator(".recipe-diff-view:visible");
      await expect(
        comparisonView.locator(".recipe-comparison-hero"),
      ).toHaveCount(1);
      await expect(
        comparisonView.locator(
          "#recipe-panel-recipe .recipe-comparison-body",
        ),
      ).toHaveCount(1);
      await expectGridColumnCount(
        comparisonView.locator(".recipe-comparison-hero"),
        expectation.columns,
      );
      await expectGridColumnCount(
        comparisonView.locator(
          "#recipe-panel-recipe .recipe-comparison-body",
        ),
        expectation.columns,
      );
      await expectNoHorizontalOverflow(page);
    });
  }
});

test("recipe comparison remains understandable in forced colors", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await page.emulateMedia({ forcedColors: "active" });
  await setScenario("comparison-actions");
  await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
  await expect
    .poll(() =>
      page.evaluate(() => window.matchMedia("(forced-colors: active)").matches),
    )
    .toBe(true);

  const changedIngredient = page.locator(
    ".recipe-comparison-ingredient-row--changed",
  );
  const addedIngredient = page.locator(
    ".recipe-comparison-ingredient-row--added",
  );
  const changedInstruction = page.locator(
    "#recipe-comparison-instructions-steps-panel .recipe-comparison-instruction-row--changed",
  );
  await expect(changedIngredient).toHaveCount(1);
  await expect(addedIngredient).toHaveCount(1);
  await expect(changedInstruction).toHaveCount(1);
  await expect(
    changedIngredient.locator(".recipe-comparison-ingredient-row__marker"),
  ).toHaveText("±");
  await expect(
    changedIngredient.getByText("Changed", { exact: true }),
  ).toBeVisible();
  await expect(
    addedIngredient.locator(".recipe-comparison-ingredient-row__marker"),
  ).toHaveText("+");
  await expect(addedIngredient.getByText("Added", { exact: true })).toBeVisible();
  await expect(
    changedInstruction.locator(".recipe-comparison-instruction-row__marker"),
  ).toHaveText("±");
  await expect(
    changedInstruction.getByText("Changed", { exact: true }),
  ).toBeVisible();

  await expect(
    changedIngredient.locator('[data-comparison-value="current"] ins'),
  ).toBeVisible();
  await expect(
    changedIngredient.locator('[data-comparison-value="previous"] del'),
  ).toBeVisible();
  await expect(
    changedInstruction.locator('[data-comparison-value="current"] ins'),
  ).toBeVisible();
  await expect(
    changedInstruction.locator('[data-comparison-value="previous"] del'),
  ).toBeVisible();
  const instructionTabs = page.getByRole("tablist", {
    name: "Instruction comparison view",
  });
  const breakdownTab = instructionTabs.getByRole("tab", {
    name: "Cooking breakdown",
  });
  await expect(
    instructionTabs.getByRole("tab", { name: "Steps" }),
  ).toHaveCSS("border-top-style", "solid");
  await breakdownTab.click();
  await expect(breakdownTab).toHaveCSS("border-top-style", "solid");
  const changedBreakdown = page.locator(
    "#recipe-comparison-instructions-breakdown-panel .recipe-comparison-instruction-row--changed",
  );
  const actions = changedBreakdown.getByRole("list", {
    name: "Cooking action comparison for step 1",
  });
  const addedAction = actions.locator(
    ':scope > .recipe-comparison-action[data-action-status="added"]',
  ).first();
  const unchangedAction = actions.locator(
    ':scope > .recipe-comparison-action[data-action-status="unchanged"]',
  );
  const removedAction = actions.locator(
    ':scope > .recipe-comparison-action[data-action-status="removed"]',
  );
  await expect(changedBreakdown).toHaveCount(1);
  await expect(
    changedBreakdown.locator(".recipe-comparison-instruction-row__marker"),
  ).toHaveText("±");
  await expect(addedAction.locator("ins")).toHaveText("Added action:");
  await expect(removedAction.locator("del")).toHaveText("Removed action:");
  await expect(unchangedAction).toContainText("Rest");
  await expect(addedAction).toHaveCSS("border-left-style", "solid");
  await expect(removedAction).toHaveCSS("border-left-style", "dashed");
  await expect(
    changedBreakdown.locator(
      ".recipe-comparison-instruction-row__step-number",
    ),
  ).toHaveCSS("border-top-style", "solid");
  await expectNoHorizontalOverflow(page);
  await expectNoAccessibilityViolations(page);
});

test("recipe comparison preserves the complete recipe when printed", async ({
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  await setScenario("comparison-actions");
  await page.goto(`/recipes/${VARIANT_RECIPE_ID}/compare`);
  await page
    .getByRole("tablist", { name: "Instruction comparison view" })
    .getByRole("tab", { name: "Cooking breakdown" })
    .click();
  await page.emulateMedia({ media: "print" });
  await expect
    .poll(() => page.evaluate(() => window.matchMedia("print").matches))
    .toBe(true);

  const comparisonView = page.locator(".recipe-diff-view:visible");
  const ingredients = comparisonView.locator(".recipe-comparison-ingredients");
  const instructions = comparisonView.locator(
    ".recipe-comparison-instructions",
  );
  const notes = comparisonView.locator(".recipe-comparison-notes");
  const recipePanel = comparisonView.locator("#recipe-panel-recipe");
  const notesPanel = comparisonView.locator("#recipe-panel-notes");
  const familyPanel = comparisonView.locator("#recipe-panel-family");
  const tablist = comparisonView.getByRole("tablist", {
    name: "Recipe sections",
    includeHidden: true,
  });
  const instructionTablist = comparisonView.getByRole("tablist", {
    name: "Instruction comparison view",
    includeHidden: true,
  });
  const stepsPanel = comparisonView.locator(
    "#recipe-comparison-instructions-steps-panel",
  );
  const breakdownPanel = comparisonView.locator(
    "#recipe-comparison-instructions-breakdown-panel",
  );
  await expect(
    page.getByRole("heading", {
      name: "Garden Cream Tomato Soup",
      level: 1,
    }),
  ).toBeVisible();
  await expect(ingredients).toHaveCount(1);
  await expect(instructions).toHaveCount(1);
  await expect(notes).toHaveCount(1);
  await expect(recipePanel).toBeVisible();
  await expect(notesPanel).toBeVisible();
  await expect(familyPanel).toBeHidden();
  await expect(tablist).toBeHidden();
  await expect(instructionTablist).toBeHidden();
  await expect(ingredients).toBeVisible();
  await expect(
    ingredients.locator(".recipe-comparison-ingredient-row"),
  ).toHaveCount(2);
  await expect(
    ingredients.locator('[data-comparison-value="current"]'),
  ).toHaveCount(2);
  await expect(
    ingredients.locator('[data-comparison-value="previous"]'),
  ).toHaveCount(1);
  await expect(instructions).toBeVisible();
  await expect(
    instructions.getByRole("heading", {
      name: /^Written steps — \d+ step changes?$/,
    }),
  ).toBeVisible();
  await expect(
    instructions.getByRole("heading", {
      name: /^Cooking breakdown — \d+ cooking breakdown changes?$/,
    }),
  ).toBeVisible();
  await expect(
    instructions.locator(".recipe-comparison-instructions__view-summary"),
  ).toBeHidden();
  await expect(stepsPanel).toBeVisible();
  await expect(breakdownPanel).toBeVisible();
  await expect(stepsPanel.locator(".recipe-comparison-instruction-row")).toHaveCount(
    2,
  );
  await expect(
    breakdownPanel.locator(".recipe-comparison-instruction-row"),
  ).toHaveCount(2);
  await expect(stepsPanel.locator('[data-comparison-value="current"]')).toHaveCount(
    2,
  );
  await expect(
    breakdownPanel.locator(".recipe-comparison-instruction-row__step-number"),
  ).toHaveCount(2);
  await expect(
    stepsPanel.locator('[data-comparison-value="previous"]'),
  ).toHaveCount(1);
  const actions = breakdownPanel.getByRole("list", {
    name: "Cooking action comparison for step 1",
  });
  const addedActions = actions.locator(
    ':scope > .recipe-comparison-action[data-action-status="added"]',
  );
  const unchangedAction = actions.locator(
    ':scope > .recipe-comparison-action[data-action-status="unchanged"]',
  );
  const removedAction = actions.locator(
    ':scope > .recipe-comparison-action[data-action-status="removed"]',
  );
  await expect(actions).toBeVisible();
  await expect(addedActions).toHaveCount(2);
  await expect(unchangedAction).toHaveCount(1);
  await expect(removedAction).toHaveCount(1);
  await expect(unchangedAction).toContainText("Rest");
  await expect(addedActions.first().locator("ins")).toHaveText(
    "Added action:",
  );
  await expect(removedAction.locator("del")).toHaveText("Removed action:");
  await expect(addedActions.first()).toHaveCSS("border-left-style", "solid");
  await expect(removedAction).toHaveCSS("border-left-style", "solid");
  await expect(notes).toBeVisible();
  await expect(
    notes.getByText(
      "Taste before serving and adjust the seasoning if needed.",
    ),
  ).toBeVisible();
  await expect(comparisonView.locator(".recipe-family-nav")).toBeHidden();
  await expect(
    comparisonView.locator(".recipe-comparison-hero__actions"),
  ).toBeHidden();
  await expectNoHorizontalOverflow(page);
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
