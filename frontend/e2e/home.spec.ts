import { expect, test, type Locator, type Page } from "@playwright/test";

async function activateWithKeyboard(
  page: Page,
  control: Locator,
): Promise<void> {
  await reachWithKeyboard(page, control);
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");
}

async function reachWithKeyboard(page: Page, control: Locator): Promise<void> {
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

function carrotRootCard(page: Page): Locator {
  return page.getByRole("article", {
    name: "Carrot Walnut Snack Cake",
    exact: true,
  });
}

async function openCarrotRoot(page: Page): Promise<string> {
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

async function expectCarrotComparisonToExplainItsChanges(page: Page) {
  const summary = page.getByRole("list", { name: "Changes at a glance" });
  await expect(summary).toBeVisible();
  await expect(
    summary.getByText("Use 100 g Pecan instead of 100 g Walnut.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    summary.getByText("Change White sugar from 180 g to 140 g.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", {
      name: "Use Pecan instead of Walnut",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", {
      name: "Change White sugar from 180 g to 140 g",
      exact: true,
    }),
  ).toBeVisible();

  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(
    /\bversion\s+\d+\b|catalog name|ingredient \d+:|structured cooking actions|(^|\n)ingredient inputs changed($|\n)|(^|\n)actions changed($|\n)/im,
  );
  expect(visibleText).not.toMatch(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  );

  return summary;
}

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

test("identifies a source and starts a private version with the keyboard on a phone", async ({
  page,
}) => {
  const draftId = "99999999-9999-4999-8999-999999999996";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([
    {
      name: "recipe_lab_csrf",
      value: "csrf-value",
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax",
    },
  ]);
  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "authenticated",
        user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
      }),
    });
  });

  await page.goto("/recipes?q=carrot");
  await page
    .getByRole("link", {
      name: "Lower-Sugar Pecan Carrot Cake",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Lower-Sugar Pecan Carrot Cake",
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.locator(".recipe-detail__parent-context")).toHaveText(
    "Based on Carrot Walnut Snack Cake by Recipe Lab Demo Catalog",
  );

  const sourceVersionId = new URL(page.url()).pathname.split("/").at(-1);
  if (!sourceVersionId) {
    throw new Error("Could not read the source recipe version identifier.");
  }
  const draft = {
    id: draftId,
    source_version_id: sourceVersionId,
    status: "active",
    revision: 1,
    title: "",
    description: null,
    servings: null,
    total_time_minutes: null,
    active_time_minutes: null,
    difficulty: null,
    notes: null,
    categories: [],
    ingredients: [],
    instructions: [],
    created_at: "2026-08-25T12:00:00Z",
    updated_at: "2026-08-25T12:00:00Z",
  };
  await page.route(/\/api\/recipe-drafts(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          page: 1,
          page_size: 1,
          total: 0,
          total_pages: 0,
        }),
      });
      return;
    }
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["idempotency-key"]).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(route.request().postDataJSON()).toEqual({
      source_version_id: sourceVersionId,
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(draft),
    });
  });
  await page.route(`**/api/recipe-drafts/${draftId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(draft),
    });
  });

  const makeVersion = page.getByRole("button", {
    name: "Make your own version",
    exact: true,
  });
  await reachWithKeyboard(page, makeVersion);
  await expect(makeVersion).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/recipes/${sourceVersionId}`);
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Opening your recipe…", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Return", exact: true }).click();
  await expect(page).toHaveURL(`/recipes/${sourceVersionId}`);
  await expect(
    page.getByRole("heading", {
      name: "Lower-Sugar Pecan Carrot Cake",
      level: 1,
    }),
  ).toBeVisible();
});

test("keeps the signed-out recipe catalog readable at a phone viewport", async ({
  page,
}) => {
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
});

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
    const resultsBox = await page
      .getByRole("region", { name: "All recipes" })
      .first()
      .boundingBox();
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
    const columnCount = await page
      .locator(".catalog-results__grid")
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

test("compares a selected family recipe with the open recipe without signing in", async ({
  page,
}) => {
  const parentRecipeVersionId = await openCarrotRoot(page);

  await page.getByRole("tab", { name: "Family", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Family", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const openRecipeUrl = page.url();
  const childSelector = page.getByRole("button", {
    name: "Show Lower-Sugar Pecan Carrot Cake in the family tree",
  });
  await childSelector.click();
  await expect(page).toHaveURL(openRecipeUrl);
  await expect(
    page.getByLabel("Selected family recipe: Lower-Sugar Pecan Carrot Cake"),
  ).toBeVisible();
  const childRecipeLink = page.getByRole("link", {
    name: "Lower-Sugar Pecan Carrot Cake",
    exact: true,
  });
  const childRecipeHref = await childRecipeLink.getAttribute("href");
  expect(childRecipeHref).toMatch(/^\/recipes\/[0-9a-f-]+$/i);
  await childRecipeLink.click();
  await expect(page).toHaveURL(childRecipeHref!);
  await expect(
    page.getByRole("heading", {
      name: "Lower-Sugar Pecan Carrot Cake",
      level: 1,
    }),
  ).toBeVisible();

  await page.goto(openRecipeUrl);
  await expect(
    page.getByRole("tab", { name: "Family", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", {
      name: "Show Lower-Sugar Pecan Carrot Cake in the family tree",
    })
    .click();
  const compareLink = page.getByRole("link", {
    name: /compare with carrot walnut snack cake/i,
  });
  const targetMatch = (await compareLink.getAttribute("href"))?.match(
    /^\/recipes\/([^/]+)\/compare\?base_version_id=([^&]+)$/,
  );
  if (!targetMatch) {
    throw new Error("Could not read the child recipe version identifier.");
  }
  const targetRecipeVersionId = decodeURIComponent(targetMatch[1]);
  expect(decodeURIComponent(targetMatch[2])).toBe(parentRecipeVersionId);

  await reachWithKeyboard(page, compareLink);
  await expect(compareLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    `/recipes/${targetRecipeVersionId}/compare?base_version_id=${parentRecipeVersionId}`,
  );
  await expect(
    page.getByRole("heading", {
      name: "How Lower-Sugar Pecan Carrot Cake changed",
      level: 1,
    }),
  ).toBeVisible();

  await expectCarrotComparisonToExplainItsChanges(page);

  const comparedRecipes = page.getByRole("navigation", {
    name: "Compared recipes",
  });
  const parentLink = comparedRecipes.getByRole("link", {
    name: /starting recipe.*carrot walnut snack cake/i,
  });
  await expect(
    comparedRecipes.getByRole("link", {
      name: /this recipe.*lower-sugar pecan carrot cake/i,
    }),
  ).toBeVisible();
  await parentLink.focus();
  await expect(parentLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/recipes/${parentRecipeVersionId}`);
});

test("keeps the selected family comparison usable at a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const parentRecipeVersionId = await openCarrotRoot(page);
  await page.getByRole("tab", { name: "Family", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Show Lower-Sugar Pecan Carrot Cake in the family tree",
    })
    .click();
  const childRecipeLink = page.getByRole("link", {
    name: "Lower-Sugar Pecan Carrot Cake",
    exact: true,
  });
  const childRecipeHref = await childRecipeLink.getAttribute("href");
  expect(childRecipeHref).toMatch(/^\/recipes\/[0-9a-f-]+$/i);
  const compareLink = page.getByRole("link", {
    name: /compare with carrot walnut snack cake/i,
  });
  await expect(compareLink).toHaveAttribute(
    "href",
    new RegExp(`\\?base_version_id=${parentRecipeVersionId}$`),
  );
  await reachWithKeyboard(page, compareLink);
  await expect(compareLink).toBeFocused();
  await page.keyboard.press("Enter");

  const summary = await expectCarrotComparisonToExplainItsChanges(page);
  await summary.scrollIntoViewIfNeeded();
  await expect(summary).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const sourceLink = page
    .getByRole("navigation", { name: "Compared recipes" })
    .getByRole("link", { name: /starting recipe.*carrot walnut snack cake/i });
  await sourceLink.focus();
  await expect(sourceLink).toBeFocused();
});

test("requires sign-in for save, rate, recorded-view, and fork actions", async ({
  page,
}) => {
  let recordedViews = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/view")) {
      recordedViews += 1;
    }
  });
  const recipeVersionId = await openCarrotRoot(page);

  await expect(
    page.getByRole("button", { name: "Save recipe", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rate recipe", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Make your own version",
      exact: true,
    }),
  ).toHaveAttribute(
    "href",
    `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
  );
  await page.getByRole("button", { name: "Rate recipe", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Sign in to rate recipes" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Sign in to rate recipes" })
      .getByRole("link", { name: "Sign in", exact: true }),
  ).toHaveAttribute(
    "href",
    `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}`,
  );
  expect(recordedViews).toBe(0);

  await page.goto(`/recipes/${recipeVersionId}/fork`);
  await expect(
    page.getByRole("heading", {
      name: "Page Unavailable",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign In", exact: true }),
  ).toHaveAttribute(
    "href",
    `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
  );
});

test("requires account setup before exposing member recipe actions", async ({
  page,
}) => {
  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "onboarding_required",
        user: {
          id: "pending-member",
          display_name: "Pending Member",
          handle: null,
        },
      }),
    });
  });
  const recipeVersionId = await openCarrotRoot(page);

  await expect(
    page.getByRole("link", { name: /make your own version/i }),
  ).toHaveAttribute(
    "href",
    `/onboarding?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
  );
  await expect(
    page.getByRole("region", { name: /save and rate/i }),
  ).toHaveCount(0);

  await page.goto(`/recipes/${recipeVersionId}/fork`);
  await expect(
    page.getByRole("heading", {
      name: "Finish setting up your account",
      level: 1,
    }),
  ).toBeVisible();
});

test("keeps the anonymous recipe detail gate usable at a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCarrotRoot(page);

  await page.getByRole("button", { name: "Rate recipe", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Sign in to rate recipes" });
  await expect(prompt).toBeVisible();
  const promptBox = await prompt.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(promptBox!.x).toBeGreaterThanOrEqual(0);
  expect(promptBox!.x + promptBox!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("selects a stable catalog ingredient in a private draft with the keyboard on a phone", async ({
  page,
}) => {
  const pecanId = "77777777-7777-4777-8777-777777777777";
  const draftId = "99999999-9999-4999-8999-999999999997";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([
    {
      name: "recipe_lab_csrf",
      value: "csrf-value",
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax",
    },
  ]);
  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "authenticated",
        user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
      }),
    });
  });
  await page.route("**/api/ingredients?*", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { id: pecanId, canonical_name: "Pecan", aliases: ["Pecan nut"] },
        ],
        page: 1,
        page_size: 20,
        total: 1,
        total_pages: 1,
      }),
    });
  });

  const draftResponse = (sourceVersionId: string) => ({
    id: draftId,
    source_version_id: sourceVersionId,
    status: "active",
    revision: 1,
    title: "",
    description: null,
    servings: null,
    total_time_minutes: null,
    active_time_minutes: null,
    difficulty: null,
    notes: null,
    categories: [],
    ingredients: [],
    instructions: [],
    created_at: "2026-08-25T12:00:00Z",
    updated_at: "2026-08-25T12:00:00Z",
  });

  const recipeVersionId = await openCarrotRoot(page);
  await page.route(/\/api\/recipe-drafts(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get("source_version_id")).toBe(recipeVersionId);
      expect(query.get("page")).toBe("1");
      expect(query.get("page_size")).toBe("1");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          page: 1,
          page_size: 1,
          total: 0,
          total_pages: 0,
        }),
      });
      return;
    }
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["idempotency-key"]).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(route.request().postDataJSON()).toEqual({
      source_version_id: recipeVersionId,
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(draftResponse(recipeVersionId)),
    });
  });
  await page.route(`**/api/recipe-drafts/${draftId}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(draftResponse(recipeVersionId)),
      });
      return;
    }
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "internal_operator_policy_failure",
          message:
            "Canonical UUID 88888888-8888-4888-8888-888888888888 failed an operator policy.",
          issues: [],
        },
      }),
    });
  });

  await page.goto(`/recipes/${recipeVersionId}/fork`);
  await expect(page).toHaveURL(`/recipes/drafts/${draftId}`);
  await page
    .getByRole("button", { name: "Add ingredient", exact: true })
    .focus();
  await page.keyboard.press("Enter");

  const ingredientRow = page.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  const search = ingredientRow.getByRole("combobox", {
    name: "Ingredient",
    exact: true,
  });
  await search.focus();
  await search.fill("Pecan");
  const result = ingredientRow
    .getByRole("listbox", { name: "Ingredient suggestions" })
    .getByRole("option", { name: /pecan/i });
  await expect(result).toBeVisible();
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(search).toHaveValue("Pecan");
  await expect(
    ingredientRow.getByText("Selected ingredient", { exact: true }),
  ).toHaveCount(0);
  await ingredientRow
    .getByRole("button", { name: "Edit amount for ingredient 1", exact: true })
    .click();
  const amountEditor = ingredientRow.getByRole("dialog", {
    name: "Amount for ingredient 1",
    exact: true,
  });
  await amountEditor
    .getByRole("textbox", { name: "Amount", exact: true })
    .fill("1");
  await amountEditor
    .getByRole("combobox", { name: "Unit", exact: true })
    .selectOption({ label: "gram (g)" });
  await amountEditor.getByRole("button", { name: "Done", exact: true }).click();

  const updateRequest = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      request.url().endsWith(`/recipe-drafts/${draftId}`),
  );
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "Save draft", exact: true }),
  );
  const payload = (await updateRequest).postDataJSON() as {
    ingredients: Array<Record<string, unknown>>;
  };
  expect(payload.ingredients[0]).toMatchObject({
    selection: {
      kind: "catalog",
      ingredient_id: pecanId,
      display_name: "Pecan",
    },
  });
  const errorSummary = page.locator(".draft-editor__error-summary");
  await expect(errorSummary).toContainText(
    "Recipe Lab could not save this draft. Your edits are still here.",
  );
  await expect(errorSummary).not.toContainText(
    /88888888|canonical|uuid|operator|policy|internal_/i,
  );

  const picker = ingredientRow.locator(".ingredient-picker");
  const pickerBox = await picker.boundingBox();
  expect(pickerBox).not.toBeNull();
  expect(pickerBox!.x).toBeGreaterThanOrEqual(0);
  expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
