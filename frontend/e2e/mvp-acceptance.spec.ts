import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const recipePathPattern = /^\/recipes\/([^/]+)$/;

async function activateWithKeyboard(page: Page, control: Locator): Promise<void> {
  for (let step = 0; step < 80; step += 1) {
    if (await control.evaluate((element) => element === element.ownerDocument.activeElement)) {
      await expect(control).toBeFocused();
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }

  throw new Error("The expected control was not reachable through forward keyboard navigation.");
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const summary = results.violations.map((violation) => ({
    help: violation.help,
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
  }));
  expect(results.violations, JSON.stringify(summary, null, 2)).toEqual([]);
}

function recipeVersionId(page: Page): string {
  const match = new URL(page.url()).pathname.match(recipePathPattern);
  if (!match) {
    throw new Error(`Could not read the recipe version ID from ${page.url()}.`);
  }
  return decodeURIComponent(match[1]);
}

test.describe("MVP acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    process.env.MVP_ACCEPTANCE !== "1" ||
      process.env.ACCEPTANCE_DATABASE_ISOLATED !== "1",
    "The canonical journey requires the isolated, freshly seeded acceptance database.",
  );

  test("browses, saves, forks, edits, and compares a recipe using the real stack", async ({
    page,
  }) => {
    const variantTitle = "MVP Lower-Sugar Pecan Carrot Cake";

    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Cook a recipe. Make it yours. Keep what worked.",
        level: 1,
      }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await activateWithKeyboard(
      page,
      page
        .getByRole("region", {
          name: "Cook a recipe. Make it yours. Keep what worked.",
        })
        .getByRole("link", { name: "Explore recipes", exact: true }),
    );
    await expect(
      page.getByRole("heading", {
        name: "Find a recipe worth making your own.",
        level: 1,
      }),
    ).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Search recipes" });
    await search.fill("carrot");
    await search.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Results for “carrot”", level: 2 }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await activateWithKeyboard(
      page,
      page.getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true }),
    );
    await expect(
      page.getByRole("heading", { name: "Carrot Walnut Snack Cake", level: 1 }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page);

    const sourceRecipeVersionId = recipeVersionId(page);
    const saveButton = page.getByRole("button", { name: "Save recipe", exact: true });
    await expect(saveButton).toHaveAttribute("aria-pressed", "false");
    await activateWithKeyboard(page, saveButton);
    await expect(
      page.getByText("Saved to Demo Cook.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove saved recipe", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Carrot Walnut Snack Cake", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove saved recipe", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await activateWithKeyboard(
      page,
      page.getByRole("link", { name: "Make your own version", exact: true }),
    );
    await expect(
      page.getByRole("heading", { name: "Make this recipe your own.", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("group", { name: "About your version" })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    const sugarRow = page.getByRole("group", {
      name: /^Ingredient \d+: White sugar$/,
    });
    const walnutRow = page.getByRole("group", {
      name: /^Ingredient \d+: Walnut$/,
    });
    await page.getByLabel("Title", { exact: true }).fill(variantTitle);
    await activateWithKeyboard(
      page,
      sugarRow.getByRole("button", { name: "Change White sugar", exact: true }),
    );
    await sugarRow.getByLabel("Quantity", { exact: true }).fill("140");
    await activateWithKeyboard(
      page,
      walnutRow.getByRole("button", { name: "Change Walnut", exact: true }),
    );
    await walnutRow
      .getByLabel("Swap ingredient (optional)", { exact: true })
      .fill("Pecan");

    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(
          `/api/recipes/${encodeURIComponent(sourceRecipeVersionId)}/variants`,
        ),
    );
    await activateWithKeyboard(
      page,
      page.getByRole("button", { name: "Create my version", exact: true }),
    );
    expect((await createResponse).status()).toBe(201);

    await expect(page).toHaveURL(/\/recipes\/[^/]+$/);
    const childRecipeVersionId = recipeVersionId(page);
    expect(childRecipeVersionId).not.toBe(sourceRecipeVersionId);
    await expect(
      page.getByRole("heading", { name: variantTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: /based on.*carrot walnut snack cake.*version 1/i,
      }),
    ).toBeVisible();

    const ingredients = page.getByRole("region", { name: "Ingredients" });
    await expect(
      ingredients.getByRole("listitem").filter({ hasText: "White sugar" }),
    ).toContainText("140 g");
    await expect(
      ingredients.getByRole("listitem").filter({ hasText: "Pecan" }),
    ).toContainText("100 g");
    await expect(
      ingredients.getByRole("listitem").filter({ hasText: "Walnut" }),
    ).toHaveCount(0);
    await expectNoAccessibilityViolations(page);

    await activateWithKeyboard(
      page,
      page.getByRole("link", { name: "See what changed", exact: true }),
    );
    await expect(page).toHaveURL(`/recipes/${childRecipeVersionId}/compare`);
    await expect(
      page.getByRole("heading", {
        name: `What changed in ${variantTitle}`,
        level: 1,
      }),
    ).toBeVisible();

    const comparedRecipes = page.getByRole("navigation", { name: "Compared recipes" });
    await expect(
      comparedRecipes.getByRole("link", {
        name: /starting recipe.*carrot walnut snack cake.*version 1/i,
      }),
    ).toBeVisible();
    await expect(
      comparedRecipes.getByRole("link", {
        name: new RegExp(`this version.*${variantTitle}.*version \\d+`, "i"),
      }),
    ).toBeVisible();

    const sugarChange = page.getByRole("article", {
      name: "White sugar",
      exact: true,
    });
    await expect(sugarChange.getByText("Amount changed", { exact: true })).toBeVisible();
    await expect(sugarChange.getByText("Before", { exact: true })).toBeVisible();
    await expect(sugarChange.getByText("After", { exact: true })).toBeVisible();
    await expect(sugarChange.getByText("180 g", { exact: true })).toBeVisible();
    await expect(sugarChange.getByText("140 g", { exact: true })).toBeVisible();

    const substitution = page.getByRole("article", {
      name: "Walnut replaced with Pecan",
    });
    await expect(substitution.getByText("Substitution", { exact: true })).toBeVisible();
    await expect(
      substitution.getByText("Original ingredient", { exact: true }),
    ).toBeVisible();
    await expect(
      substitution.getByText("Replacement ingredient", { exact: true }),
    ).toBeVisible();
    await expect(substitution.getByText("Walnut", { exact: true })).toBeVisible();
    await expect(substitution.getByText("Pecan", { exact: true })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});
