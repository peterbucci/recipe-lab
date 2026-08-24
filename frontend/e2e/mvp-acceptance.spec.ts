import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

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
    const authoredIngredient = "Black lime powder (house blend)";

    await useAcceptanceMember(page, "alice");
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Recipes change. Recipe Lab keeps track.",
        level: 1,
      }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await activateWithKeyboard(
      page,
      page
        .getByRole("region", {
          name: "Recipes change. Recipe Lab keeps track.",
        })
        .getByRole("link", { name: "Explore recipes", exact: true }),
    );
    await expect(
      page.getByRole("heading", {
        name: "Find something to cook",
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
      page.getByText("Saved to your account.", { exact: true }),
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
    await page.getByRole("button", { name: "Add ingredient", exact: true }).click();
    const authoredIngredientRow = page
      .getByRole("group", { name: /^New ingredient \d+$/ })
      .last();
    await authoredIngredientRow
      .getByLabel("Ingredient name", { exact: true })
      .fill(authoredIngredient);
    await authoredIngredientRow.getByLabel("Quantity", { exact: true }).fill("1");
    await authoredIngredientRow.getByLabel("Unit", { exact: true }).fill("tsp");

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
    const whiteSugar = ingredients.getByRole("listitem").filter({ hasText: "White sugar" });
    await expect(whiteSugar).toContainText("140 g");
    await expect(whiteSugar).toContainText("Catalog name: Granulated sugar");
    await expect(
      ingredients.getByRole("listitem").filter({ hasText: "Pecan" }),
    ).toContainText("100 g");
    await expect(
      ingredients.getByRole("listitem").filter({ hasText: "Walnut" }),
    ).toHaveCount(0);
    const authoredIngredientDetail = ingredients
      .getByRole("listitem")
      .filter({ hasText: authoredIngredient });
    await expect(authoredIngredientDetail).toContainText("1 tsp");
    await expect(authoredIngredientDetail.getByText(/catalog name:/i)).toHaveCount(0);
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

    const authoredAddition = page.getByRole("article", {
      name: authoredIngredient,
      exact: true,
    });
    await expect(authoredAddition.getByText("Added", { exact: true })).toBeVisible();
    await expect(authoredAddition.getByText("1 tsp", { exact: true })).toBeVisible();
    await expect(authoredAddition.getByText(/catalog name:/i)).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
  });

  test("keeps saved and rating state isolated between two members", async ({ page }) => {
    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes?q=carrot");
    await page
      .getByRole("link", { name: "Lower-Sugar Pecan Carrot Cake", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Lower-Sugar Pecan Carrot Cake", level: 1 }),
    ).toBeVisible();

    const aliceSave = page.getByRole("button", { name: "Save recipe", exact: true });
    await expect(aliceSave).toHaveAttribute("aria-pressed", "false");
    await aliceSave.click();
    await expect(page.getByText("Saved to your account.", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "4 stars", exact: true }).check();
    await page.getByRole("button", { name: "Rate recipe", exact: true }).click();
    await expect(page.getByText("Your rating is now 4 out of 5.", { exact: true })).toBeVisible();

    await useAcceptanceMember(page, "bob");
    await page.reload();
    await expect(page.getByRole("button", { name: "Save recipe", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(
      page.getByText("You haven’t rated this recipe yet.", { exact: true }),
    ).toBeVisible();
    for (const rating of await page.getByRole("radio").all()) {
      await expect(rating).not.toBeChecked();
    }
    await page.getByRole("radio", { name: "2 stars", exact: true }).check();
    await page.getByRole("button", { name: "Rate recipe", exact: true }).click();
    await expect(page.getByText("Your rating is now 2 out of 5.", { exact: true })).toBeVisible();

    await useAcceptanceMember(page, "alice");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Remove saved recipe", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("radio", { name: "4 stars", exact: true })).toBeChecked();
    await expect(
      page.getByText("Your current rating is 4 out of 5.", { exact: true }),
    ).toBeVisible();
  });
});
