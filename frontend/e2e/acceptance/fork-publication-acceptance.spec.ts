import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Response } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function confirmPublicationRequirements(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^(?:Finish recipe|Publish draft)$/ })
    .click();
  await page
    .getByRole("checkbox", {
      name: /right to share this recipe.*community rules/i,
    })
    .check();
}

async function fillCompleteRecipe(page: Page, title: string): Promise<void> {
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Makes", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Add ingredient", exact: true })
    .click();
  const ingredient = page.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  const search = ingredient.getByRole("combobox", {
    name: "Ingredient",
    exact: true,
  });
  await search.fill("Pecan");
  await ingredient
    .getByRole("listbox", { name: "Ingredient suggestions" })
    .getByRole("option", { name: /pecan/i })
    .first()
    .click();
  await ingredient
    .getByRole("button", { name: "Edit amount for ingredient 1", exact: true })
    .click();
  const amountEditor = ingredient.getByRole("dialog", {
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

  await page
    .getByRole("button", { name: "Add instruction", exact: true })
    .click();
  const step = page.getByRole("group", { name: "Step 1", exact: true });
  await step
    .getByLabel("Instruction", { exact: true })
    .fill("Knead the pecans into a small round and serve.");
  await page
    .getByRole("tab", { name: "Cooking breakdown", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add cooking detail to Step 1", exact: true })
    .click();
  const action = page.getByRole("dialog", {
    name: "Cooking detail 1 for Step 1",
    exact: true,
  });
  await action
    .getByRole("combobox", { name: "Cooking action", exact: true })
    .selectOption({
      label: "knead",
    });
  await action
    .getByRole("group", { name: "Ingredient inputs", exact: true })
    .getByRole("checkbox", { name: /Ingredient 1: Pecan/i })
    .check();
  await action.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Draft saved", exact: true }),
  ).toBeDisabled();
}

async function finishOriginalPublication(
  page: Page,
  preflightResponse: Promise<Response>,
  publishResponse: Promise<Response>,
): Promise<string> {
  await confirmPublicationRequirements(page);
  await page
    .getByRole("button", { name: "Review and publish", exact: true })
    .click();
  const preflight = await preflightResponse;
  expect(preflight.status()).toBe(201);
  const body = (await preflight.json()) as { classification?: unknown };
  if (body.classification !== "distinct") {
    const review = page.getByRole("region", {
      name:
        body.classification === "exact_duplicate"
          ? "This recipe is very close to another public recipe"
          : "This recipe is similar to another public recipe",
    });
    await review
      .getByRole("checkbox", { name: /publish my recipe anyway/i })
      .check();
    await review
      .getByRole("button", { name: "Publish recipe", exact: true })
      .click();
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

  test("publishes a private source-backed draft after an explicit no-change review", async ({
    browser,
    page,
  }) => {
    const sourceTitle = "Acceptance Parent Pecan Round";
    const childTitle = "Acceptance Bob Pecan Round";

    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes/new");
    await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
    await fillCompleteRecipe(page, sourceTitle);
    const sourceDraftId = new URL(page.url()).pathname.split("/").at(-1)!;
    const sourcePreflight = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/api/recipe-drafts/${sourceDraftId}/duplicate-preflights`),
    );
    const sourcePublication = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${sourceDraftId}/publish`),
    );
    const sourceId = await finishOriginalPublication(
      page,
      sourcePreflight,
      sourcePublication,
    );

    await useAcceptanceMember(page, "bob");
    await page.goto(`/recipes/${sourceId}/fork`);
    await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
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
      page.getByRole("button", { name: "Publish draft", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: sourceTitle })).toHaveAttribute(
      "href",
      `/recipes/${sourceId}`,
    );
    await page.getByLabel("Title", { exact: true }).fill(childTitle);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();

    const preflightResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/api/recipe-drafts/${forkDraftId}/duplicate-preflights`),
    );
    await confirmPublicationRequirements(page);
    await page
      .getByRole("button", { name: "Review and publish version", exact: true })
      .click();
    const preflight = await preflightResponse;
    expect(preflight.status()).toBe(201);
    expect(await preflight.json()).toMatchObject({
      classification: "exact_duplicate",
      same_lineage_no_change: true,
      warnings: [{ code: "same_lineage_no_change" }],
      acknowledgement: { required: true },
    });

    const review = page.getByRole("region", {
      name: "This version is very close to its source",
    });
    await expect(review).toContainText(
      "You can still publish it as a separate version if that’s intentional.",
    );
    await expect(review).not.toContainText(
      /canonical|direct parent|immutable/i,
    );
    const publishAnyway = review.getByRole("button", {
      name: "Publish version",
      exact: true,
    });
    await expect(publishAnyway).toBeDisabled();
    await review
      .getByRole("checkbox", {
        name: /closely matches its source.*publish it separately/i,
      })
      .check();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
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
    await expect(
      page.getByRole("heading", { name: childTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      page
        .locator(".recipe-detail__intro")
        .getByText("Version 2", { exact: true }),
    ).toHaveCount(0);
    const parentContext = page
      .getByRole("main")
      .locator(".recipe-detail__parent-context");
    await expect(parentContext).toContainText(`Based on ${sourceTitle}`);
    await expect(
      parentContext.getByRole("link", { name: sourceTitle }),
    ).toHaveAttribute("href", `/recipes/${sourceId}`);

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
    expect(activeDraftBody.items?.some((item) => item.id === forkDraftId)).toBe(
      false,
    );

    await parentContext
      .getByRole("link", { name: sourceTitle, exact: true })
      .click();
    await expect(page).toHaveURL(`/recipes/${sourceId}`);
    await page.getByRole("tab", { name: "Family", exact: true }).click();
    const family = page.getByRole("tabpanel", { name: "Family", exact: true });
    await family
      .getByRole("button", {
        name: `Show ${childTitle} in the family tree`,
        exact: true,
      })
      .click();
    const compare = family.getByRole("link", {
      name: `Compare with ${sourceTitle} →`,
      exact: true,
    });
    const comparisonPath =
      `/recipes/${published.recipe_version_id}/compare?base_version_id=${sourceId}`;
    await expect(compare).toHaveAttribute("href", comparisonPath);
    await compare.click();
    await expect(page).toHaveURL(comparisonPath);
    await expect(
      page.getByRole("heading", {
        name: `How ${childTitle} changed`,
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Changes at a glance" })
        .getByText(`Change title from ${sourceTitle} to ${childTitle}.`, {
          exact: true,
        }),
    ).toBeVisible();
    const titleChange = page.getByRole("article", { name: "Title" });
    await expect(titleChange.locator("del")).toContainText(sourceTitle);
    await expect(titleChange.locator("ins")).toContainText(childTitle);

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
