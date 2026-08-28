import { expect, test, type Locator, type Page } from "@playwright/test";

async function activateWithKeyboard(
  page: Page,
  control: Locator,
): Promise<void> {
  for (let step = 0; step < 80; step += 1) {
    if (
      await control.evaluate(
        (element) => element === element.ownerDocument.activeElement,
      )
    ) {
      await page.keyboard.press("Enter");
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

test("browses, searches, and opens a structured recipe anonymously", async ({
  page,
}) => {
  let recordedViews = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/view")) {
      recordedViews += 1;
    }
  });

  await page.goto("/");
  await expect(page).toHaveTitle(/Recipe Lab/);
  await expect(
    page.getByRole("heading", {
      name: "Recipes change. Recipe Lab keeps track.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.locator(".public-demo-notice")).toHaveCount(0);

  const primaryNavigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  await primaryNavigation
    .getByRole("link", { name: "Explore recipes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Find something to cook", level: 1 }),
  ).toBeVisible();

  const recipeType = page.getByRole("navigation", { name: "Recipe type" });
  await page.getByLabel(/search recipes/i).fill("carrot");
  await page.getByRole("button", { name: /^search$/i }).click();
  await expect(
    page.getByRole("heading", { name: /results for “carrot”/i }),
  ).toBeVisible();

  await recipeType
    .getByRole("link", { name: "Originals", exact: true })
    .click();
  await expect(page).toHaveURL("/recipes?q=carrot&type=originals");
  await expect(
    carrotRootCard(page).getByRole("link", {
      name: "Carrot Walnut Snack Cake",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Lower-Sugar Pecan Carrot Cake",
      exact: true,
    }),
  ).toHaveCount(0);

  await recipeType.getByRole("link", { name: "Versions", exact: true }).click();
  await expect(page).toHaveURL("/recipes?q=carrot&type=versions");
  await expect(
    page.getByRole("link", {
      name: "Lower-Sugar Pecan Carrot Cake",
      exact: true,
    }),
  ).toBeVisible();

  await recipeType.getByRole("link", { name: "All", exact: true }).click();
  await carrotRootCard(page)
    .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /ingredients/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /instructions/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Member recipe actions" }),
  ).toContainText("Sign in to save or rate this recipe");
  await expect(
    page.getByRole("region", { name: "Save and rate this recipe" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", {
      name: /another version.*lower-sugar pecan carrot cake.*version 2/i,
    }),
  ).toBeVisible();
  expect(recordedViews).toBe(0);
});

test("keeps the plain-language homepage readable at a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Recipes change. Recipe Lab keeps track.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Explore recipes", exact: true }).first(),
  ).toBeVisible();

  const conceptHeadings = page.locator(".home-concept__version strong");
  await expect(conceptHeadings).toHaveCount(2);
  for (const heading of await conceptHeadings.all()) {
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("compares the seeded carrot variant with its parent without signing in", async ({
  page,
}) => {
  const parentRecipeVersionId = await openCarrotRoot(page);

  await page
    .getByRole("link", {
      name: /another version.*lower-sugar pecan carrot cake.*version 2/i,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Lower-Sugar Pecan Carrot Cake",
      level: 1,
    }),
  ).toBeVisible();
  const targetMatch = new URL(page.url()).pathname.match(
    /^\/recipes\/([^/]+)$/,
  );
  if (!targetMatch) {
    throw new Error("Could not read the child recipe version identifier.");
  }
  const targetRecipeVersionId = decodeURIComponent(targetMatch[1]);

  await page
    .getByRole("link", { name: "See what changed", exact: true })
    .click();
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
  await expect(
    sugarChange.getByText("Amount changed", { exact: true }),
  ).toBeVisible();
  await expect(sugarChange.getByText("180 g", { exact: true })).toBeVisible();
  await expect(sugarChange.getByText("140 g", { exact: true })).toBeVisible();
  const substitution = page.getByRole("article", {
    name: "Walnut replaced with Pecan",
  });
  await expect(
    substitution.getByText("Substitution", { exact: true }),
  ).toBeVisible();
  await expect(substitution.getByText("Walnut", { exact: true })).toBeVisible();
  await expect(substitution.getByText("Pecan", { exact: true })).toBeVisible();

  const parentLink = page
    .getByRole("navigation", { name: "Compared recipes" })
    .getByRole("link", {
      name: /starting recipe.*carrot walnut snack cake.*version 1/i,
    });
  await parentLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/recipes/${parentRecipeVersionId}`);
});

test("keeps the seeded recipe comparison usable at a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCarrotRoot(page);
  await page
    .getByRole("link", {
      name: /another version.*lower-sugar pecan carrot cake.*version 2/i,
    })
    .click();
  await page
    .getByRole("link", { name: "See what changed", exact: true })
    .click();
  await expect(page.getByText("Before", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("After", { exact: true }).first()).toBeVisible();

  const comparison = await page.locator(".recipe-diff-view").boundingBox();
  expect(comparison).not.toBeNull();
  expect(comparison!.x).toBeGreaterThanOrEqual(0);
  expect(comparison!.x + comparison!.width).toBeLessThanOrEqual(390);
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

  await expect(page.getByRole("button", { name: /save recipe/i })).toHaveCount(
    0,
  );
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(
    page.getByRole("link", {
      name: "Sign in to make your own version",
      exact: true,
    }),
  ).toHaveAttribute(
    "href",
    `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
  );
  expect(recordedViews).toBe(0);

  await page.goto(`/recipes/${recipeVersionId}/fork`);
  await expect(
    page.getByRole("heading", {
      name: "Sign in to work on private recipes",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create private draft", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Sign in to continue", exact: true }),
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
    page.getByRole("link", { name: /finish setup to make a version/i }),
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
  await expect(
    page.getByRole("button", { name: "Create private draft", exact: true }),
  ).toHaveCount(0);
});

test("keeps the anonymous recipe detail gate usable at a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCarrotRoot(page);

  const gate = page.getByRole("region", { name: "Member recipe actions" });
  await expect(gate).toBeVisible();
  await expect(gate).toContainText(/sign in to save or rate/i);
  const gateBox = await gate.boundingBox();
  expect(gateBox).not.toBeNull();
  expect(gateBox!.x).toBeGreaterThanOrEqual(0);
  expect(gateBox!.x + gateBox!.width).toBeLessThanOrEqual(390);
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
    ingredients: [],
    instructions: [],
    created_at: "2026-08-25T12:00:00Z",
    updated_at: "2026-08-25T12:00:00Z",
  });

  const recipeVersionId = await openCarrotRoot(page);
  await page.route("**/api/recipe-drafts", async (route) => {
    expect(route.request().method()).toBe("POST");
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
  await page
    .getByRole("button", { name: "Create private draft", exact: true })
    .click();
  await expect(page).toHaveURL(`/account/recipe-drafts/${draftId}`);
  await page
    .getByRole("button", { name: "Add ingredient", exact: true })
    .focus();
  await page.keyboard.press("Enter");

  const ingredientRow = page.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  const search = ingredientRow.getByRole("searchbox", {
    name: "Catalog ingredient",
    exact: true,
  });
  await search.focus();
  await search.fill("Pecan");
  await page.keyboard.press("Enter");
  const result = ingredientRow
    .getByRole("list", { name: "Catalog ingredient catalog results" })
    .getByRole("button", { name: /pecan/i });
  await expect(result).toBeVisible();
  await activateWithKeyboard(page, result);
  await expect(
    ingredientRow.getByText("Selected catalog ingredient"),
  ).toBeVisible();

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
