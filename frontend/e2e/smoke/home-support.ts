import { expect, type Locator, type Page } from "@playwright/test";

export async function activateWithKeyboard(
  page: Page,
  control: Locator,
): Promise<void> {
  await reachWithKeyboard(page, control);
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");
}

export async function reachWithKeyboard(page: Page, control: Locator): Promise<void> {
  for (let step = 0; step < 80; step += 1) {
    if (
      await control.evaluate(
        (element) => element === element.ownerDocument.activeElement,
      )
    ) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(
    "The expected control was not reachable through keyboard navigation.",
  );
}

export function carrotRootCard(page: Page): Locator {
  return page.getByRole("article", {
    name: "Carrot Walnut Snack Cake",
    exact: true,
  });
}

export async function openCarrotRoot(page: Page): Promise<string> {
  await page.goto("/recipes?q=carrot");
  await carrotRootCard(page)
    .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Carrot Walnut Snack Cake", level: 1 }),
  ).toBeVisible();

  const match = new URL(page.url()).pathname.match(/^\/recipes\/([^/]+)$/);
  if (!match) {
    throw new Error("Could not read the current recipe version identifier.");
  }
  return decodeURIComponent(match[1]);
}

export async function expectCarrotComparisonToShowCompleteRecipe(
  page: Page,
  {
    baseRecipeVersionId,
    targetRecipeVersionId,
  }: {
    baseRecipeVersionId: string;
    targetRecipeVersionId: string;
  },
) {
  const baseRecipeHref = `/recipes/${baseRecipeVersionId}`;
  const currentRecipeHref = `/recipes/${targetRecipeVersionId}`;
  const comparisonHref = `${currentRecipeHref}/compare?base_version_id=${baseRecipeVersionId}`;

  await expect(
    page.getByRole("heading", {
      name: "Lower-Sugar Pecan Carrot Cake",
      level: 1,
    }),
  ).toBeVisible();

  const ingredients = page.getByRole("region", { name: "Ingredients" });
  await expect(ingredients).toBeVisible();
  const currentIngredientNames = ingredients.locator(
    '[data-comparison-value="current"] .recipe-comparison-ingredient-value__name',
  );
  await expect(currentIngredientNames).toHaveText([
    "All-purpose flour",
    "Carrot",
    "White sugar",
    "Egg",
    "Vegetable oil",
    "Pecan",
    "Cinnamon",
    "Baking powder",
    "Bicarbonate of soda",
  ]);

  const changedIngredients = ingredients.locator(
    ".recipe-comparison-ingredient-row--changed",
  );
  await expect(changedIngredients).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    await expect(
      changedIngredients
        .nth(index)
        .locator(
          ':scope > [data-comparison-value="current"] + [data-comparison-value="previous"]',
        ),
    ).toHaveCount(1);
  }
  const changedSugar = changedIngredients.filter({ hasText: "White sugar" });
  await expect(changedSugar).toContainText("140 g");
  await expect(changedSugar).toContainText("Previous");
  await expect(changedSugar).toContainText("180 g");
  const pecanSubstitution = changedIngredients.filter({ hasText: "Pecan" });
  await expect(pecanSubstitution).toContainText("100 g Pecan");
  await expect(pecanSubstitution).toContainText("Previous");
  await expect(pecanSubstitution).toContainText("100 g Walnut");

  const instructions = page.getByRole("region", { name: "Instructions" });
  await expect(instructions).toBeVisible();
  const currentInstructionText = instructions.locator(
    '[data-comparison-value="current"] .recipe-comparison-instruction-value__text',
  );
  await expect(currentInstructionText).toHaveText([
    "Heat the oven to 180°C (350°F), grease a 20 cm square pan, and line its base.",
    "Whisk the flour, cinnamon, baking powder, and bicarbonate of soda together.",
    "Whisk the sugar, eggs, and oil, fold in the dry ingredients, then fold in the carrots and nuts.",
    "Spread the batter in the pan and bake until the center springs back and a tester comes out clean; cool before slicing.",
  ]);
  const changedInstructions = instructions.locator(
    ".recipe-comparison-instruction-row--changed",
  );
  for (let index = 0; index < (await changedInstructions.count()); index += 1) {
    await expect(
      changedInstructions
        .nth(index)
        .locator(
          ':scope > [data-comparison-value="current"] + [data-comparison-value="previous"]',
        ),
    ).toHaveCount(1);
  }

  const comparisonView = page.locator(".recipe-diff-view:visible");
  const hero = comparisonView.locator(".recipe-comparison-hero");
  await expect(
    hero.getByRole("link", { name: "View starting recipe", exact: true }),
  ).toHaveAttribute("href", baseRecipeHref);
  await expect(
    hero.getByRole("link", {
      name: "Back to Lower-Sugar Pecan Carrot Cake",
      exact: true,
    }),
  ).toHaveAttribute("href", currentRecipeHref);

  const tabs = comparisonView.getByRole("tablist", {
    name: "Recipe sections",
  });
  const recipeTab = tabs.getByRole("tab", { name: "Recipe", exact: true });
  const notesTab = tabs.getByRole("tab", { name: "Notes", exact: true });
  const familyTab = tabs.getByRole("tab", { name: "Family", exact: true });
  const recipePanel = comparisonView.locator("#recipe-panel-recipe");
  const notesPanel = comparisonView.locator("#recipe-panel-notes");
  const familyPanel = comparisonView.locator("#recipe-panel-family");

  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await expect(recipeTab).toHaveAttribute("aria-selected", "true");
  await expect(recipeTab).toHaveAttribute(
    "aria-controls",
    "recipe-panel-recipe",
  );
  await expect(recipeTab).toHaveAttribute("tabindex", "0");
  await expect(notesTab).toHaveAttribute("aria-selected", "false");
  await expect(notesTab).toHaveAttribute("aria-controls", "recipe-panel-notes");
  await expect(notesTab).toHaveAttribute("tabindex", "-1");
  await expect(familyTab).toHaveAttribute("aria-selected", "false");
  await expect(familyTab).toHaveAttribute(
    "aria-controls",
    "recipe-panel-family",
  );
  await expect(familyTab).toHaveAttribute("tabindex", "-1");

  await expect(recipePanel).toHaveAttribute("role", "tabpanel");
  await expect(recipePanel).toHaveAttribute(
    "aria-labelledby",
    "recipe-tab-recipe",
  );
  await expect(recipePanel).toBeVisible();
  await expect(notesPanel).toHaveAttribute("role", "tabpanel");
  await expect(notesPanel).toHaveAttribute(
    "aria-labelledby",
    "recipe-tab-notes",
  );
  await expect(notesPanel).toBeHidden();
  await expect(notesPanel).toContainText("No notes were added for this recipe.");
  await expect(
    recipePanel.getByText("No notes were added for this recipe."),
  ).toHaveCount(0);
  await expect(familyPanel).toHaveAttribute("role", "tabpanel");
  await expect(familyPanel).toHaveAttribute(
    "aria-labelledby",
    "recipe-tab-family",
  );
  await expect(familyPanel).toBeHidden();
  await expect(familyPanel).toContainText("Recipe family");

  await expect(
    page.getByRole("navigation", { name: "Recipe views" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Changes", exact: true }),
  ).toHaveCount(0);

  expect(
    await page
      .getByRole("heading", { name: "Changes at a glance" })
      .count(),
  ).toBe(0);
  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  );

  return {
    comparisonHref,
    familyPanel,
    familyTab,
    ingredients,
    instructions,
    notesPanel,
    notesTab,
    recipePanel,
    recipeTab,
    tabs,
  };
}
