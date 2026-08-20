import { expect, test } from "@playwright/test";

test("presents the MVP product promise", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Recipe Lab/);
  await expect(
    page.getByRole("heading", { name: /recipes evolve\. keep the useful history/i }),
  ).toBeVisible();
  await expect(page.getByText(/foundation in progress/i)).toBeVisible();
});
