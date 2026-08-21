import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

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

async function setRating(
  request: APIRequestContext,
  recipeVersionId: string,
  rating: number,
  action: string,
) {
  await expectApiSuccess(
    request.put(ratingUrl(recipeVersionId), { data: { rating } }),
    action,
  );
}

test("browses, searches, and opens a structured recipe", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Recipe Lab/);
  await expect(
    page.getByRole("heading", { name: /a good recipe is only the beginning/i }),
  ).toBeVisible();

  await page.getByRole("link", { name: /browse the catalog/i }).click();
  await expect(page.getByRole("heading", { name: /find a recipe worth making your own/i })).toBeVisible();

  await page.getByLabel(/search recipes/i).fill("carrot");
  await page.getByRole("button", { name: /^search$/i }).click();
  await expect(page.getByRole("heading", { name: /results for “carrot”/i })).toBeVisible();

  await page.getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Carrot Walnut Snack Cake", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /ingredients/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /instructions/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /your demo activity/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /direct child.*lower-sugar pecan/i })).toBeVisible();
});

test("persists shared demo saves and rating updates", async ({ page, request }) => {
  let recipeVersionId: string | undefined;

  try {
    recipeVersionId = await openCarrotRoot(page);
    await expectApiSuccess(
      request.delete(saveUrl(recipeVersionId)),
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
      page.getByText("Your rating is now 4 out of 5 for Demo Cook.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Your current rating is 4 out of 5.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("4.0 out of 5 from 1 rating", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("radio", { name: "4 stars", exact: true })).toBeChecked();
    await expect(page.getByText("Your current rating is 4 out of 5.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("4.0 out of 5 from 1 rating", { exact: true })).toBeVisible();

    await page.getByRole("radio", { name: "5 stars", exact: true }).check();
    await page.getByRole("button", { name: "Update rating", exact: true }).click();
    await expect(
      page.getByText("Your rating is now 5 out of 5 for Demo Cook.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Your current rating is 5 out of 5.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("5.0 out of 5 from 1 rating", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("radio", { name: "5 stars", exact: true })).toBeChecked();
    await expect(page.getByText("Your current rating is 5 out of 5.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("5.0 out of 5 from 1 rating", { exact: true })).toBeVisible();
  } finally {
    if (recipeVersionId) {
      await expectApiSuccess(
        request.delete(saveUrl(recipeVersionId)),
        "Final save normalization",
      );
      await setRating(request, recipeVersionId, 5, "Final rating normalization");
    }
  }
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
  await expect(page.getByRole("heading", { name: /your demo activity/i })).toBeVisible();
  await expect(page.getByRole("group", { name: /your rating/i })).toBeVisible();
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
});
