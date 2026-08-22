import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

import type { RecipeDetail } from "../lib/recipe-api";
import type { RecipeVariantCreateRequest } from "../lib/variant-api";

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);

async function openCarrotRoot(page: Page): Promise<string> {
  await page.goto("/recipes?q=carrot");
  await page.getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Carrot Walnut Snack Cake", level: 1 }),
  ).toBeVisible();

  const match = new URL(page.url()).pathname.match(/^\/recipes\/([^/]+)$/);
  if (!match) {
    throw new Error(`Could not read the recipe version ID from ${page.url()}.`);
  }
  return decodeURIComponent(match[1]);
}

async function expectApiSuccess(responsePromise: Promise<APIResponse>, action: string) {
  const response = await responsePromise;
  expect(
    response.ok(),
    `${action} failed with ${response.status()}: ${await response.text()}`,
  ).toBe(true);
}

function saveUrl(recipeVersionId: string): string {
  return `${apiBaseUrl}/api/recipes/${encodeURIComponent(recipeVersionId)}/save`;
}

function ratingUrl(recipeVersionId: string): string {
  return `${apiBaseUrl}/api/recipes/${encodeURIComponent(recipeVersionId)}/rating`;
}

function actionHeaders(): Record<string, string> {
  return { "Idempotency-Key": crypto.randomUUID() };
}

async function setRating(
  request: APIRequestContext,
  recipeVersionId: string,
  rating: number,
  action: string,
) {
  await expectApiSuccess(
    request.put(ratingUrl(recipeVersionId), {
      data: { rating },
      headers: actionHeaders(),
    }),
    action,
  );
}

async function fetchRecipeDetail(
  request: APIRequestContext,
  recipeVersionId: string,
): Promise<RecipeDetail> {
  const response = await request.get(
    `${apiBaseUrl}/api/recipes/${encodeURIComponent(recipeVersionId)}`,
  );
  if (!response.ok()) {
    throw new Error(
      `Recipe detail request failed with ${response.status()}: ${await response.text()}`,
    );
  }
  return (await response.json()) as RecipeDetail;
}

test("browses, searches, and opens a structured recipe", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Recipe Lab/);
  await expect(
    page.getByRole("heading", {
      name: "Cook a recipe. Make it yours. Keep what worked.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Public demo notice" }),
  ).toBeVisible();

  const primaryNavigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  await primaryNavigation
    .getByRole("link", { name: "Explore recipes", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: /find a recipe worth making your own/i })).toBeVisible();

  await page.getByLabel(/search recipes/i).fill("carrot");
  await page.getByRole("button", { name: /^search$/i }).click();
  await expect(page.getByRole("heading", { name: /results for “carrot”/i })).toBeVisible();

  await page.getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Carrot Walnut Snack Cake", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /ingredients/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /instructions/i })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Save and rate this recipe" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /another version.*lower-sugar pecan carrot cake.*version 2/i,
    }),
  ).toBeVisible();
});

test("compares the seeded carrot variant with its parent without writing recipe state", async ({
  page,
}) => {
  const parentRecipeVersionId = await openCarrotRoot(page);

  await page
    .getByRole("link", {
      name: /another version.*lower-sugar pecan carrot cake.*version 2/i,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Lower-Sugar Pecan Carrot Cake", level: 1 }),
  ).toBeVisible();

  const targetMatch = new URL(page.url()).pathname.match(/^\/recipes\/([^/]+)$/);
  if (!targetMatch) {
    throw new Error(`Could not read the child recipe version ID from ${page.url()}.`);
  }
  const targetRecipeVersionId = decodeURIComponent(targetMatch[1]);

  await page.getByRole("link", { name: "See what changed", exact: true }).click();
  await expect(page).toHaveURL(`/recipes/${targetRecipeVersionId}/compare`);
  await expect(
    page.getByRole("heading", {
      name: "What changed in Lower-Sugar Pecan Carrot Cake",
      level: 1,
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
  await expect(substitution.getByText("Original ingredient", { exact: true })).toBeVisible();
  await expect(substitution.getByText("Replacement ingredient", { exact: true })).toBeVisible();
  await expect(substitution.getByText("Walnut", { exact: true })).toBeVisible();
  await expect(substitution.getByText("Pecan", { exact: true })).toBeVisible();

  const comparedVersions = page.getByRole("navigation", { name: "Compared recipes" });
  const parentLink = comparedVersions.getByRole("link", {
    name: /starting recipe.*carrot walnut snack cake.*version 1/i,
  });
  await expect(
    comparedVersions.getByRole("link", {
      name: /this version.*lower-sugar pecan carrot cake.*version 2/i,
    }),
  ).toBeVisible();
  await parentLink.focus();
  await expect(parentLink).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(`/recipes/${parentRecipeVersionId}`);
  await expect(
    page.getByRole("heading", { name: "Carrot Walnut Snack Cake", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "See what changed" })).toHaveCount(0);
});

test("keeps the seeded recipe comparison usable at a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCarrotRoot(page);

  await page
    .getByRole("link", {
      name: /another version.*lower-sugar pecan carrot cake.*version 2/i,
    })
    .click();
  await page.getByRole("link", { name: "See what changed", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "What changed in Lower-Sugar Pecan Carrot Cake",
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByText("Before", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("After", { exact: true }).first()).toBeVisible();

  const comparison = await page.locator(".recipe-diff-view").boundingBox();
  expect(comparison).not.toBeNull();
  expect(comparison!.x).toBeGreaterThanOrEqual(0);
  expect(comparison!.x + comparison!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("persists shared demo saves and rating updates", async ({ page, request }) => {
  let recipeVersionId: string | undefined;

  try {
    recipeVersionId = await openCarrotRoot(page);
    await expectApiSuccess(
      request.delete(saveUrl(recipeVersionId), { headers: actionHeaders() }),
      "Initial save normalization",
    );
    await setRating(request, recipeVersionId, 3, "Initial rating normalization");
    await page.reload();

    const saveButton = page.getByRole("button", { name: "Save recipe", exact: true });
    await expect(saveButton).toHaveAttribute("aria-pressed", "false");
    await saveButton.click();
    await expect(page.getByText("Saved to Demo Cook.", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove saved recipe", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    const removeSaveButton = page.getByRole("button", {
      name: "Remove saved recipe",
      exact: true,
    });
    await expect(removeSaveButton).toHaveAttribute("aria-pressed", "true");
    await removeSaveButton.click();
    await expect(
      page.getByText("Removed from Demo Cook's saved recipes.", { exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Save recipe", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await page.getByRole("radio", { name: "4 stars", exact: true }).check();
    await page.getByRole("button", { name: "Update rating", exact: true }).click();
    await expect(
      page.getByText("Demo Cook’s rating is now 4 out of 5.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Demo Cook’s current rating is 4 out of 5.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("4.0 out of 5 from 1 rating", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("radio", { name: "4 stars", exact: true })).toBeChecked();
    await expect(
      page.getByText("Demo Cook’s current rating is 4 out of 5.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("4.0 out of 5 from 1 rating", { exact: true })).toBeVisible();

    await page.getByRole("radio", { name: "5 stars", exact: true }).check();
    await page.getByRole("button", { name: "Update rating", exact: true }).click();
    await expect(
      page.getByText("Demo Cook’s rating is now 5 out of 5.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Demo Cook’s current rating is 5 out of 5.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("5.0 out of 5 from 1 rating", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("radio", { name: "5 stars", exact: true })).toBeChecked();
    await expect(
      page.getByText("Demo Cook’s current rating is 5 out of 5.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("5.0 out of 5 from 1 rating", { exact: true })).toBeVisible();
  } finally {
    if (recipeVersionId) {
      await expectApiSuccess(
        request.delete(saveUrl(recipeVersionId), { headers: actionHeaders() }),
        "Final save normalization",
      );
      await setRating(request, recipeVersionId, 5, "Final rating normalization");
    }
  }
});

test("preserves variant edits after validation and opens the created child", async ({
  page,
  request,
}) => {
  const sourceRecipeVersionId = await openCarrotRoot(page);
  const sourceRecipe = await fetchRecipeDetail(request, sourceRecipeVersionId);
  const seededChildReference = sourceRecipe.children.find((child) =>
    child.title.toLocaleLowerCase().includes("lower-sugar pecan"),
  );
  if (!seededChildReference) {
    throw new Error("The seeded lower-sugar pecan child variant is unavailable.");
  }
  const seededChild = await fetchRecipeDetail(request, seededChildReference.id);
  const sugar = sourceRecipe.ingredients.find(
    (ingredient) => ingredient.canonical_name === "Granulated sugar",
  );
  const walnut = sourceRecipe.ingredients.find(
    (ingredient) => ingredient.canonical_name === "Walnut",
  );
  const firstInstruction = sourceRecipe.instructions[0];
  if (!sugar || !walnut || !firstInstruction) {
    throw new Error("The seeded carrot recipe is missing the rows required by this test.");
  }

  let postAttempts = 0;
  const submittedPayloads: RecipeVariantCreateRequest[] = [];
  await page.route(
    `**/api/recipes/${encodeURIComponent(sourceRecipeVersionId)}/variants`,
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      postAttempts += 1;
      submittedPayloads.push(
        route.request().postDataJSON() as RecipeVariantCreateRequest,
      );
      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      };
      if (postAttempts === 1) {
        await route.fulfill({
          status: 422,
          headers,
          body: JSON.stringify({
            error: {
              code: "invalid_recipe_edits",
              message: "The test ingredient edit is invalid.",
              issues: [],
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 201,
        headers,
        body: JSON.stringify(seededChild),
      });
    },
  );

  await page.getByRole("link", { name: "Make your own version", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make this recipe your own.", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "About your version" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    `${sourceRecipe.title} variation`,
  );
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    sourceRecipe.description ?? "",
  );
  await expect(page.getByLabel("Servings", { exact: true })).toHaveValue(
    sourceRecipe.servings,
  );

  const sugarRow = page.getByRole("group", {
    name: new RegExp(`^Ingredient ${sugar.display_order + 1}:`),
  });
  const walnutRow = page.getByRole("group", {
    name: new RegExp(`^Ingredient ${walnut.display_order + 1}:`),
  });
  const variantTitle = "E2E Orange Pecan Carrot Cake";
  const changedInstruction = "Fold gently until the batter is just combined.";
  await page.getByLabel("Title", { exact: true }).fill(variantTitle);
  await sugarRow
    .getByRole("button", {
      name: `Change ${sugar.display_name}`,
      exact: true,
    })
    .click();
  await sugarRow.getByLabel("Quantity", { exact: true }).fill("125.5");
  await sugarRow.getByLabel("Unit", { exact: true }).fill("cup");
  await walnutRow
    .getByRole("button", {
      name: `Change ${walnut.display_name}`,
      exact: true,
    })
    .click();
  await walnutRow
    .getByLabel("Swap ingredient (optional)", { exact: true })
    .fill("Pecan");
  const firstStepNumber = firstInstruction.display_order + 1;
  await page
    .getByRole("button", {
      name: `Edit step ${firstStepNumber}`,
      exact: true,
    })
    .click();
  const firstInstructionRow = page.getByRole("listitem").filter({
    has: page.getByRole("button", {
      name: `Done editing step ${firstStepNumber}`,
      exact: true,
    }),
  });
  const firstInstructionInput = firstInstructionRow.getByRole("textbox", {
    name: "Instruction",
    exact: true,
  });
  await firstInstructionInput.fill(changedInstruction);

  await page.getByRole("button", { name: "Create my version", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Check your version before creating it" }),
  ).toContainText("The test ingredient edit is invalid.");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(variantTitle);
  await expect(sugarRow.getByLabel("Quantity", { exact: true })).toHaveValue("125.5");
  await expect(sugarRow.getByLabel("Unit", { exact: true })).toHaveValue("cup");
  await expect(
    walnutRow.getByLabel("Swap ingredient (optional)", { exact: true }),
  ).toHaveValue("Pecan");
  await expect(firstInstructionInput).toHaveValue(changedInstruction);

  const expectedPayload: RecipeVariantCreateRequest = {
    title: variantTitle,
    description: sourceRecipe.description,
    servings: sourceRecipe.servings,
    ingredient_edits: [
      {
        op: "set_quantity",
        recipe_ingredient_id: sugar.id,
        quantity: "125.5",
      },
      {
        op: "set_unit",
        recipe_ingredient_id: sugar.id,
        unit: "cup",
      },
      {
        op: "replace",
        recipe_ingredient_id: walnut.id,
        ingredient_name: "Pecan",
      },
    ],
    instruction_edits: [
      {
        op: "update",
        recipe_instruction_id: firstInstruction.id,
        text: changedInstruction,
      },
    ],
  };
  expect(submittedPayloads).toEqual([expectedPayload]);

  await page.getByRole("button", { name: "Create my version", exact: true }).click();
  await expect(page).toHaveURL(`/recipes/${seededChild.id}`);
  await expect(
    page.getByRole("heading", { name: seededChild.title, level: 1 }),
  ).toBeVisible();
  expect(submittedPayloads).toEqual([expectedPayload, expectedPayload]);
});

test("keeps the recipe catalog usable at a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/recipes?q=carrot");

  await expect(page.getByLabel(/search recipes/i)).toHaveValue("carrot");
  await expect(page.getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);

  await page.getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Carrot Walnut Snack Cake", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Save and rate this recipe" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Demo Cook’s rating", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "5 stars", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(save recipe|remove saved recipe)$/i }),
  ).toBeVisible();

  const interactionPanel = await page.locator(".recipe-interactions").boundingBox();
  expect(interactionPanel).not.toBeNull();
  expect(interactionPanel!.x).toBeGreaterThanOrEqual(0);
  expect(interactionPanel!.x + interactionPanel!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);

  await page.getByRole("link", { name: "Make your own version", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make this recipe your own.", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "About your version" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: /^Ingredient 1:/ })).toBeVisible();
  await expect(
    page.getByRole("group", { name: /^Ingredient 1:/ }).getByRole("button", {
      name: /change /i,
    }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "Create my version", exact: true }),
  ).toBeVisible();

  const editor = await page.locator(".variant-editor").boundingBox();
  expect(editor).not.toBeNull();
  expect(editor!.x).toBeGreaterThanOrEqual(0);
  expect(editor!.x + editor!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
