import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

const recipePathPattern = /^\/recipes\/([^/]+)$/;

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
      await expect(control).toBeFocused();
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }

  throw new Error(
    "The expected control was not reachable through forward keyboard navigation.",
  );
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

  test("browses, saves, creates, and resumes a private fork draft using the real stack", async ({
    page,
  }) => {
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

    const saveButton = page.getByRole("button", {
      name: "Save recipe",
      exact: true,
    });
    await expect(saveButton).toHaveAttribute("aria-pressed", "false");
    await activateWithKeyboard(page, saveButton);
    await expect(
      page.getByText("Saved to your account.", { exact: true }),
    ).toBeVisible();

    const sourceRecipeUrl = page.url();
    await activateWithKeyboard(
      page,
      page.getByRole("button", { name: "Make your own version", exact: true }),
    );
    await expect(page).toHaveURL(sourceRecipeUrl);
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Opening your recipe…", { exact: true }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoAccessibilityViolations(page);

    await page.getByLabel("Title", { exact: true }).fill(draftTitle);
    const sugarRow = page.getByRole("group", {
      name: "Ingredient 3",
      exact: true,
    });
    const walnutRow = page.getByRole("group", {
      name: "Ingredient 6",
      exact: true,
    });
    await sugarRow
      .getByRole("button", {
        name: "Edit amount for ingredient 3",
        exact: true,
      })
      .click();
    const sugarAmountEditor = sugarRow.getByRole("dialog", {
      name: "Amount for ingredient 3",
      exact: true,
    });
    await sugarAmountEditor
      .getByRole("textbox", { name: "Amount", exact: true })
      .fill("140");
    const selectedSugarUnitId = await sugarAmountEditor
      .getByRole("combobox", { name: "Unit", exact: true })
      .inputValue();
    await sugarAmountEditor
      .getByRole("button", { name: "Done", exact: true })
      .click();
    const replacementSearch = walnutRow.getByRole("combobox", {
      name: "Ingredient",
      exact: true,
    });
    await replacementSearch.fill("Pecan");
    const pecanResult = walnutRow
      .getByRole("listbox", { name: "Ingredient suggestions" })
      .getByRole("option", { name: /pecan/i })
      .first();
    await expect(pecanResult).toBeVisible();
    await replacementSearch.press("ArrowDown");
    await replacementSearch.press("Enter");

    const updateRequest = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        /\/api\/recipe-drafts\/[0-9a-f-]+$/i.test(
          new URL(request.url()).pathname,
        ),
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const payload = (await updateRequest).postDataJSON() as {
      ingredients: Array<{
        selection: Record<string, unknown>;
        measure: Record<string, unknown>;
      }>;
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
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      draftTitle,
    );
    await expect(walnutRow.getByText("Pecan", { exact: true })).toBeVisible();
    await expect(page.getByText(/private version draft/i)).toBeVisible();
    expect(sourceRecipeVersionId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("keeps saved and rating state isolated between two members", async ({
    page,
  }) => {
    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes?q=carrot");
    await page
      .getByRole("link", { name: "Lower-Sugar Pecan Carrot Cake", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Lower-Sugar Pecan Carrot Cake",
        level: 1,
      }),
    ).toBeVisible();

    const aliceSave = page.getByRole("button", {
      name: "Save recipe",
      exact: true,
    });
    await expect(aliceSave).toHaveAttribute("aria-pressed", "false");
    await aliceSave.click();
    await expect(
      page.getByText("Saved to your account.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Rate recipe", exact: true })
      .click();
    await page
      .getByRole("button", { name: "4 stars — Really good", exact: true })
      .click();
    await expect(
      page.getByText("✓ Rated 4 stars", { exact: true }),
    ).toBeVisible();

    await useAcceptanceMember(page, "bob");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Save recipe", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await page
      .getByRole("button", { name: "Rate recipe", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "How would you rate this?" }),
    ).toBeVisible();
    for (const rating of await page
      .getByLabel("Choose a rating")
      .getByRole("button")
      .all()) {
      await expect(rating).toHaveAttribute("aria-pressed", "false");
    }
    await page
      .getByRole("button", { name: "2 stars — Okay", exact: true })
      .click();
    await expect(
      page.getByText("✓ Rated 2 stars", { exact: true }),
    ).toBeVisible();

    await useAcceptanceMember(page, "alice");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Remove saved recipe", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: /change rating, currently 4 stars/i })
      .click();
    await expect(
      page.getByRole("button", { name: "4 stars — Really good", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
