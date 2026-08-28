import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Response } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

const acceptanceEnabled =
  process.env.MVP_ACCEPTANCE === "1" &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function confirmPublicationRequirements(page: Page): Promise<void> {
  await page.getByRole("checkbox", { name: /agree to the community rules/i }).check();
  await page.getByRole("checkbox", { name: /right to share it/i }).check();
}

async function fillCompleteRecipe(page: Page, title: string): Promise<void> {
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Servings", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Add ingredient", exact: true }).click();
  const ingredient = page.getByRole("group", { name: "Ingredient 1", exact: true });
  const search = ingredient.getByRole("searchbox", {
    name: "Catalog ingredient",
    exact: true,
  });
  await search.fill("Pecan");
  await search.press("Enter");
  await ingredient
    .getByRole("list", { name: "Catalog ingredient catalog results" })
    .getByRole("button", { name: /pecan/i })
    .first()
    .click();

  await page.getByRole("button", { name: "Add instruction", exact: true }).click();
  const step = page.getByRole("group", { name: "Step 1", exact: true });
  await step
    .getByLabel("Human-readable direction", { exact: true })
    .fill("Knead the pecans into a small round and serve.");
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
}

async function finishOriginalPublication(
  page: Page,
  preflightResponse: Promise<Response>,
  publishResponse: Promise<Response>,
): Promise<string> {
  await confirmPublicationRequirements(page);
  await page.getByRole("button", { name: "Review and publish", exact: true }).click();
  const preflight = await preflightResponse;
  expect(preflight.status()).toBe(201);
  const body = (await preflight.json()) as { classification?: unknown };
  if (body.classification !== "distinct") {
    const review = page.getByRole("region", {
      name: /review (?:a very similar recipe|similar recipes)/i,
    });
    await review.getByRole("checkbox", { name: /publish my recipe anyway/i }).check();
    await review.getByRole("button", { name: "Publish recipe anyway" }).click();
  }
  const publication = await publishResponse;
  expect(publication.status()).toBe(201);
  const published = (await publication.json()) as {
    location?: unknown;
    recipe_version_id?: unknown;
  };
  expect(published.recipe_version_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(published.location).toBe(`/recipes/${published.recipe_version_id}`);
  expect(publication.headers().location).toBe(published.location);
  await expect(page).toHaveURL(published.location as string);
  return published.recipe_version_id as string;
}

test.describe("cross-user fork publication acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    !acceptanceEnabled,
    "Fork-publication acceptance requires the isolated, freshly seeded database.",
  );

  test("publishes a private source-backed draft after an explicit no-change review", async ({
    browser,
    page,
  }) => {
    const sourceTitle = "Acceptance Parent Pecan Round";
    const childTitle = "Acceptance Bob Pecan Round";

    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes/new");
    await page.getByRole("button", { name: "Start writing", exact: true }).click();
    await fillCompleteRecipe(page, sourceTitle);
    const sourceDraftId = new URL(page.url()).pathname.split("/").at(-1)!;
    const sourcePreflight = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${sourceDraftId}/duplicate-preflights`),
    );
    const sourcePublication = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${sourceDraftId}/publish`),
    );
    const sourceId = await finishOriginalPublication(page, sourcePreflight, sourcePublication);

    await useAcceptanceMember(page, "bob");
    await page.goto(`/recipes/${sourceId}/fork`);
    await expect(
      page.getByRole("heading", { name: `Make ${sourceTitle} your own.` }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create private draft", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/recipe-drafts\/[0-9a-f-]+$/i);
    const forkDraftId = new URL(page.url()).pathname.split("/").at(-1)!;

    const aliceContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    await useAcceptanceMember(alicePage, "alice");
    const sourceAuthorCannotReadFork = await alicePage.request.get(
      new URL(`/api/recipe-drafts/${forkDraftId}`, baseUrl).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(sourceAuthorCannotReadFork.status()).toBe(404);
    await aliceContext.close();

    await expect(
      page.getByRole("heading", { name: "Publish your version without changing its source." }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "the public recipe you started from" }),
    ).toHaveAttribute("href", `/recipes/${sourceId}`);
    await page.getByLabel("Title", { exact: true }).fill(childTitle);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Draft saved privately.", { exact: true })).toBeVisible();

    const preflightResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${forkDraftId}/duplicate-preflights`),
    );
    await confirmPublicationRequirements(page);
    await page.getByRole("button", { name: "Review and publish version", exact: true }).click();
    const preflight = await preflightResponse;
    expect(preflight.status()).toBe(201);
    expect(await preflight.json()).toMatchObject({
      classification: "exact_duplicate",
      same_lineage_no_change: true,
      warnings: [{ code: "same_lineage_no_change" }],
      acknowledgement: { required: true },
    });

    const review = page.getByRole("region", {
      name: "Your version matches the recipe it is based on",
    });
    await expect(review).toContainText("Your version matches the recipe it is based on.");
    await expect(review).not.toContainText(/canonical|direct parent|immutable/i);
    const publishAnyway = review.getByRole("button", { name: "Publish version anyway" });
    await expect(publishAnyway).toBeDisabled();
    await review
      .getByRole("checkbox", {
        name: /matches the recipe it is based on.*publish it anyway/i,
      })
      .check();

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

    const publishResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${forkDraftId}/publish`),
    );
    await publishAnyway.click();
    const publication = await publishResponse;
    expect(publication.status()).toBe(201);
    const published = (await publication.json()) as {
      location?: unknown;
      recipe_version_id?: unknown;
    };
    expect(published.location).toBe(`/recipes/${published.recipe_version_id}`);
    expect(publication.headers().location).toBe(published.location);

    await expect(page).toHaveURL(published.location as string);
    await expect(page.getByRole("heading", { name: childTitle, level: 1 })).toBeVisible();
    await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(page.getByText("Based on", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Based on.*Acceptance Parent Pecan Round/i })).toHaveAttribute(
      "href",
      `/recipes/${sourceId}`,
    );

    const completedDraft = await page.request.get(
      new URL(`/api/recipe-drafts/${forkDraftId}`, baseUrl).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(completedDraft.status()).toBe(404);
    const activeDrafts = await page.request.get(
      new URL("/api/recipe-drafts?page=1&page_size=100", baseUrl).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(activeDrafts.status()).toBe(200);
    const activeDraftBody = (await activeDrafts.json()) as {
      items?: Array<{ id?: unknown }>;
    };
    expect(activeDraftBody.items?.some((item) => item.id === forkDraftId)).toBe(false);

    await page.getByRole("link", { name: "See what changed", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `What changed in ${childTitle}` }),
    ).toBeVisible();
    const titleChange = page.getByRole("article", { name: "Title" });
    await expect(titleChange).toContainText(sourceTitle);
    await expect(titleChange).toContainText(childTitle);

    const source = await page.request.get(`/api/recipes/${sourceId}`);
    expect(source.status()).toBe(200);
    expect(await source.json()).toMatchObject({
      id: sourceId,
      parent_version_id: null,
      title: sourceTitle,
      version_number: 1,
    });
  });
});
