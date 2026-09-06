import { expect, test } from "@playwright/test";

import { carrotRootCard, reachWithKeyboard } from "./home-support";

test("redirects signed-out home visitors to the recipe catalog and supports discovery", async ({
  page,
}) => {
  let recordedViews = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/view")) {
      recordedViews += 1;
    }
  });

  await page.goto("/");
  await expect(page).toHaveURL("/recipes");
  await expect(page).toHaveTitle(/Recipe Lab/);
  await expect(
    page.getByRole("heading", {
      name: "All recipes",
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.locator(".public-demo-notice")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Create recipe", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  const filters = page.getByRole("region", { name: "Explore filters" });
  await expect(
    filters.getByRole("navigation", { name: "Recipe categories" }),
  ).toBeVisible();
  await expect(
    filters.getByRole("link", { name: "Lunch", exact: true }),
  ).toHaveAttribute("href", "/recipes?category=lunch&sort=newest");
  await expect(
    filters.getByRole("combobox", { name: "Sort recipes" }),
  ).toHaveValue("newest");

  await page.getByRole("searchbox", { name: "Search recipes" }).fill("carrot");
  await page
    .getByRole("button", { name: "Search recipes from the header" })
    .click();
  await expect(
    page.getByRole("heading", { name: /all recipes matching “carrot”/i }),
  ).toBeVisible();

  await expect(page).toHaveURL("/recipes?q=carrot");
  await expect(
    filters.getByRole("navigation", { name: "Recipe categories" }),
  ).toBeVisible();
  await expect(
    filters.getByRole("combobox", { name: "Sort recipes" }),
  ).toHaveValue("newest");
  await expect(page.getByRole("combobox", { name: "Recipe type" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("tablist", { name: "Recipe type" })).toHaveCount(
    0,
  );
  await expect(
    carrotRootCard(page).getByRole("link", {
      name: "Carrot Walnut Snack Cake",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    carrotRootCard(page).getByRole("link", {
      name: "Recipe Lab Demo Catalog",
      exact: true,
    }),
  ).toHaveAttribute("href", /\/cooks\//);
  await expect(
    page.getByRole("link", {
      name: "Lower-Sugar Pecan Carrot Cake",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", {
        name: "Lower-Sugar Pecan Carrot Cake",
        exact: true,
      })
      .locator(".recipe-card-engagement__lineage"),
  ).toContainText("Based on Carrot Walnut Snack Cake");
  await expect(carrotRootCard(page).getByText(/^original$/i)).toBeVisible();
  await expect(
    carrotRootCard(page).getByText(
      "A simple spiced carrot cake with walnuts and an unfrosted finish.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/^version \d+$/i)).toHaveCount(0);

  const artwork = carrotRootCard(page).locator(".recipe-card__artwork");
  await artwork.scrollIntoViewIfNeeded();
  const artworkBox = await artwork.boundingBox();
  if (!artworkBox) {
    throw new Error("The recipe card artwork was not available to click.");
  }
  const artworkHitTarget = await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      const link = target instanceof Element ? target.closest("a") : null;
      return {
        href: link?.getAttribute("href") ?? null,
        label: link?.textContent?.trim() ?? null,
      };
    },
    { x: artworkBox.x + 12, y: artworkBox.y + 12 },
  );
  expect(artworkHitTarget).toEqual({
    href: expect.stringMatching(/^\/recipes\//),
    label: "Carrot Walnut Snack Cake",
  });

  const carrotTitle = carrotRootCard(page).getByRole("link", {
    name: "Carrot Walnut Snack Cake",
    exact: true,
  });
  await carrotTitle.focus();
  await expect(carrotTitle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: /ingredients/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /instructions/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save recipe", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rate recipe", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Save and rate this recipe" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Family", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: "Lower-Sugar Pecan Carrot Cake",
      exact: true,
    }),
  ).toBeVisible();
  expect(recordedViews).toBe(0);
});

test("reaches a chosen recipe from signed-out home using only the keyboard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL("/recipes");

  const search = page
    .getByRole("search", { name: "Site recipe search" })
    .getByRole("searchbox", { name: "Search recipes" });
  await reachWithKeyboard(page, search);
  await expect(search).toBeFocused();
  await page.keyboard.type("carrot");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/recipes?q=carrot");

  const chosenRecipe = carrotRootCard(page).getByRole("link", {
    name: "Carrot Walnut Snack Cake",
    exact: true,
  });
  await reachWithKeyboard(page, chosenRecipe);
  await expect(chosenRecipe).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/recipes\/[^/]+$/);
  await expect(
    page.getByRole("heading", {
      name: "Carrot Walnut Snack Cake",
      level: 1,
    }),
  ).toBeVisible();
});

