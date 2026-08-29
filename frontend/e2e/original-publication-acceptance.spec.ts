import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

async function confirmPublicationRequirements(page: Page): Promise<void> {
  await page.getByRole("checkbox", { name: /agree to the community rules/i }).check();
  await page.getByRole("checkbox", { name: /right to share it/i }).check();
}

const acceptanceEnabled =
  process.env.MVP_ACCEPTANCE === "1" &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

test.describe("original recipe publication acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    !acceptanceEnabled,
    "Original-publication acceptance requires the isolated, freshly seeded database.",
  );

  test("reviews and publishes one private original as an immutable public root", async ({
    browser,
    page,
  }) => {
    const title = "Acceptance Kneaded Pecan Bite";
    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes/new");
    await expect(page).toHaveURL(/\/account\/recipe-drafts\/[0-9a-f-]+$/i);
    const draftId = new URL(page.url()).pathname.split("/").at(-1)!;

    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await useAcceptanceMember(bobPage, "bob");
    const crossOwner = await bobPage.request.get(
      new URL(`/api/recipe-drafts/${draftId}`, baseUrl).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(crossOwner.status()).toBe(404);
    await bobContext.close();

    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Servings", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Add ingredient", exact: true }).click();
    const ingredient = page.getByRole("group", { name: "Ingredient 1", exact: true });
    const search = ingredient.getByRole("combobox", { name: "Ingredient", exact: true });
    await search.fill("Pecan");
    await ingredient
      .getByRole("listbox", { name: "Ingredient suggestions" })
      .getByRole("option", { name: /pecan/i })
      .first()
      .click();
    await ingredient.getByRole("textbox", { name: "Amount", exact: true }).fill("1");
    await ingredient
      .getByRole("combobox", { name: "Unit", exact: true })
      .selectOption({ label: "gram (g)" });

    await page.getByRole("button", { name: "Add instruction", exact: true }).click();
    const step = page.getByRole("group", { name: "Step 1", exact: true });
    await step
      .getByLabel("Instruction", { exact: true })
      .fill("Knead the pecans into a small bite and serve.");
    await step.getByRole("button", { name: "Add cooking details for Step 1" }).click();
    await step.getByRole("button", { name: "Add cooking action", exact: true }).click();
    const action = step.getByRole("group", { name: "Action 1", exact: true });
    await action.getByRole("combobox", { name: "Cooking action", exact: true }).selectOption({
      label: "knead",
    });
    await action
      .getByRole("group", { name: "Ingredient inputs", exact: true })
      .getByRole("checkbox", { name: /Ingredient 1: Pecan/i })
      .check();

    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Draft saved privately.", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    expect(
      (await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()).violations,
    ).toEqual([]);

    const preflightResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${draftId}/duplicate-preflights`),
    );
    const publishResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${draftId}/publish`),
    );
    await confirmPublicationRequirements(page);
    await page.getByRole("button", { name: "Review and publish", exact: true }).click();
    const preflight = await preflightResponse;
    expect(preflight.status()).toBe(201);
    const preflightBody = await preflight.json() as { classification?: unknown };
    if (preflightBody.classification !== "distinct") {
      const review = page.getByRole("region", {
        name: /review (?:a very similar recipe|similar recipes)/i,
      });
      await expect(review).toBeVisible();
      await review
        .getByRole("checkbox", { name: /publish my recipe anyway/i })
        .check();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
      ).toBe(false);
      expect(
        (await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()).violations,
      ).toEqual([]);
      await review.getByRole("button", { name: "Publish recipe anyway" }).click();
    }
    const publication = await publishResponse;
    expect(publication.status()).toBe(201);
    const publicationBody = await publication.json() as {
      location?: unknown;
      recipe_version_id?: unknown;
    };
    expect(publicationBody.recipe_version_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(publicationBody.location).toBe(`/recipes/${publicationBody.recipe_version_id}`);
    expect(publication.headers().location).toBe(publicationBody.location);

    await expect(page).toHaveURL("/account/recipes?view=published");
    await expect(page.getByRole("article", { name: title, exact: true })).toBeVisible();
    await page.goto(publicationBody.location as string);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText("Version 1", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Based on", { exact: true })).toHaveCount(0);
    expect(
      (await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()).violations,
    ).toEqual([]);

    const completedDraft = await page.request.get(
      new URL(`/api/recipe-drafts/${draftId}`, baseUrl).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(completedDraft.status()).toBe(404);
    const activeDrafts = await page.request.get(
      new URL("/api/recipe-drafts?page=1&page_size=100", baseUrl).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(activeDrafts.status()).toBe(200);
    const activeDraftBody = await activeDrafts.json() as { items?: Array<{ id?: unknown }> };
    expect(activeDraftBody.items?.some((item) => item.id === draftId)).toBe(false);
    await page.goto(`/recipes?q=${encodeURIComponent(title)}`);
    await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  });
});
