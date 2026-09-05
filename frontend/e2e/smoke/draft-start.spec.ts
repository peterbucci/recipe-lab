import { expect, test } from "@playwright/test";

import {
  activateWithKeyboard,
  openCarrotRoot,
  reachWithKeyboard,
} from "./home-support";

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
  await page.route(/\/api\/recipes\/viewer-states(?:\?.*)?$/, async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
  await page.route(/\/api\/recipe-drafts(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const query = new URL(route.request().url()).searchParams;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [],
        page: Number.parseInt(query.get("page") ?? "1", 10),
        page_size: Number.parseInt(query.get("page_size") ?? "1", 10),
        total: 0,
        total_pages: 0,
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
    .getByRole("group", { name: "Ingredients", exact: true })
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
  await expect(search).toHaveAttribute("aria-expanded", "false");
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
  await expect(amountEditor).toHaveCount(0);

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
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      { message: "The phone draft editor must not overflow horizontally." },
    )
    .toBeLessThanOrEqual(0);
});
