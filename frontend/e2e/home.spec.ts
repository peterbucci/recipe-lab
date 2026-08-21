import { expect, test } from "@playwright/test";

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
  await expect(page.getByText(/not yet rated/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /direct child.*lower-sugar pecan/i })).toBeVisible();
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
});
