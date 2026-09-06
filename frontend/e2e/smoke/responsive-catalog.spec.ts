import { expect, test } from "@playwright/test";

import { CROSS_BROWSER_SANITY_TAG } from "./tags";

test(
  "keeps the signed-out recipe catalog readable at a phone viewport",
  { tag: CROSS_BROWSER_SANITY_TAG },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page).toHaveURL("/recipes");

    await expect(
      page.getByRole("heading", {
        name: "All recipes",
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Create recipe", exact: true }),
    ).toHaveCount(0);
    const filters = page.getByRole("region", { name: "Explore filters" });
    await expect(
      filters.getByRole("navigation", { name: "Recipe categories" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Recipe results" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
  },
);

test("keeps one consistent catalog canvas across tablet and phone widths", async ({
  page,
}) => {
  for (const viewport of [
    { width: 980, height: 1_100 },
    { width: 790, height: 1_100 },
    { width: 500, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(page).toHaveURL("/recipes");
    await expect(
      page.getByRole("heading", { name: "All recipes", level: 1 }),
    ).toBeVisible();
    const results = page
      .getByRole("region", { name: "All recipes" })
      .first();
    const resultsBox = await results.boundingBox();
    expect(resultsBox).not.toBeNull();
    const expectedGutter = viewport.width <= 700 ? 12 : 24;
    expect(Math.abs(resultsBox!.x - expectedGutter)).toBeLessThanOrEqual(
      1,
    );
    expect(
      Math.abs(
        viewport.width -
          (resultsBox!.x + resultsBox!.width) -
          expectedGutter,
      ),
    ).toBeLessThanOrEqual(1);
    const columnCount = await results
      .getByRole("list", { name: "Recipe results" })
      .evaluate(
        (grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      );
    expect(columnCount).toBe(viewport.width > 900 ? 3 : 2);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
  }
});

