import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

const recipePathPattern = /^\/recipes\/([^/]+)$/;

async function activateWithKeyboard(page: Page, control: Locator): Promise<void> {
  for (let step = 0; step < 80; step += 1) {
    if (await control.evaluate((element) => element === element.ownerDocument.activeElement)) {
      await expect(control).toBeFocused();
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }

  throw new Error("The expected control was not reachable through forward keyboard navigation.");
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const summary = results.violations.map((violation) => ({
    help: violation.help,
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
  }));
  expect(results.violations, JSON.stringify(summary, null, 2)).toEqual([]);
}

function recipeVersionId(page: Page): string {
  const match = new URL(page.url()).pathname.match(recipePathPattern);
  if (!match) {
    throw new Error(`Could not read the recipe version ID from ${page.url()}.`);
  }
  return decodeURIComponent(match[1]);
}

test.describe("MVP acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    process.env.MVP_ACCEPTANCE !== "1" ||
      process.env.ACCEPTANCE_DATABASE_ISOLATED !== "1",
    "The canonical journey requires the isolated, freshly seeded acceptance database.",
  );

  test("browses, saves, creates, and resumes a private fork draft using the real stack", async ({ page }) => {
    const draftTitle = "MVP Private Pecan Carrot Draft";
    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes?q=carrot");
    await Promise.all([
      page.waitForURL((url) => recipePathPattern.test(url.pathname)),
      page
        .getByRole("article", { name: "Carrot Walnut Snack Cake", exact: true })
        .filter({ hasNot: page.locator(".recipe-card__parent") })
        .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
        .click(),
    ]);
    await expect(
      page.getByRole("heading", { name: "Carrot Walnut Snack Cake", level: 1 }),
    ).toBeVisible();
    const sourceRecipeVersionId = recipeVersionId(page);

    const saveButton = page.getByRole("button", { name: "Save recipe", exact: true });
    await expect(saveButton).toHaveAttribute("aria-pressed", "false");
    await activateWithKeyboard(page, saveButton);
    await expect(page.getByText("Saved to your account.", { exact: true })).toBeVisible();

    await activateWithKeyboard(page, page.getByRole("link", { name: "Make your own version", exact: true }));
    await expect(page.getByRole("heading", { name: /make carrot walnut snack cake your own/i })).toBeVisible();
    await page.getByRole("button", { name: "Create private draft", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/recipe-drafts\/[0-9a-f-]+$/i);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoAccessibilityViolations(page);

    await page.getByLabel("Title", { exact: true }).fill(draftTitle);
    const sugarRow = page.getByRole("group", { name: "Ingredient 3", exact: true });
    const walnutRow = page.getByRole("group", { name: "Ingredient 6", exact: true });
    await sugarRow.getByRole("textbox", { name: "Amount", exact: true }).fill("140");
    const selectedSugarUnitId = await sugarRow.getByRole("combobox", { name: "Unit", exact: true }).inputValue();
    const replacementSearch = walnutRow.getByRole("searchbox", { name: "Catalog ingredient", exact: true });
    await replacementSearch.fill("Pecan");
    await replacementSearch.press("Enter");
    const pecanResult = walnutRow
      .getByRole("list", { name: "Catalog ingredient catalog results" })
      .getByRole("button", { name: /pecan/i })
      .first();
    await expect(pecanResult).toBeVisible();
    await activateWithKeyboard(page, pecanResult);

    const updateRequest = page.waitForRequest(
      (request) => request.method() === "PUT" && /\/api\/recipe-drafts\/[0-9a-f-]+$/i.test(new URL(request.url()).pathname),
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const payload = (await updateRequest).postDataJSON() as {
      ingredients: Array<{ selection: Record<string, unknown>; measure: Record<string, unknown> }>;
      source_version_id?: string;
      title: string;
    };
    expect(payload.title).toBe(draftTitle);
    expect(payload).not.toHaveProperty("source_version_id");
    expect(payload.ingredients[2]?.measure).toMatchObject({
      kind: "exact",
      value: "140",
      unit_id: selectedSugarUnitId,
    });
    expect(payload.ingredients[5]?.selection).toMatchObject({
      kind: "catalog",
      display_name: "Pecan",
    });
    await expect(page.getByText("Draft saved privately.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(draftTitle);
    await expect(walnutRow.getByText("Pecan", { exact: true })).toBeVisible();
    await expect(page.getByText(/private version draft/i)).toBeVisible();
    expect(sourceRecipeVersionId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("keeps saved and rating state isolated between two members", async ({ page }) => {
    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes?q=carrot");
    await page
      .getByRole("link", { name: "Lower-Sugar Pecan Carrot Cake", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Lower-Sugar Pecan Carrot Cake", level: 1 }),
    ).toBeVisible();

    const aliceSave = page.getByRole("button", { name: "Save recipe", exact: true });
    await expect(aliceSave).toHaveAttribute("aria-pressed", "false");
    await aliceSave.click();
    await expect(page.getByText("Saved to your account.", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "4 stars", exact: true }).check();
    await page.getByRole("button", { name: "Rate recipe", exact: true }).click();
    await expect(page.getByText("Your rating is now 4 out of 5.", { exact: true })).toBeVisible();

    await useAcceptanceMember(page, "bob");
    await page.reload();
    await expect(page.getByRole("button", { name: "Save recipe", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(
      page.getByText("You haven’t rated this recipe yet.", { exact: true }),
    ).toBeVisible();
    for (const rating of await page.getByRole("radio").all()) {
      await expect(rating).not.toBeChecked();
    }
    await page.getByRole("radio", { name: "2 stars", exact: true }).check();
    await page.getByRole("button", { name: "Rate recipe", exact: true }).click();
    await expect(page.getByText("Your rating is now 2 out of 5.", { exact: true })).toBeVisible();

    await useAcceptanceMember(page, "alice");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Remove saved recipe", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("radio", { name: "4 stars", exact: true })).toBeChecked();
    await expect(
      page.getByText("Your current rating is 4 out of 5.", { exact: true }),
    ).toBeVisible();
  });
});
