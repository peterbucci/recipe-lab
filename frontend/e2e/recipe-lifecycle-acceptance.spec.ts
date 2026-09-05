import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Response } from "@playwright/test";

import {
  type MemberName,
  useAcceptanceMember as applyAcceptanceMember,
} from "./acceptance-session";

const acceptanceEnabled =
  process.env.MVP_ACCEPTANCE === "1" &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function csrfHeaders(
  page: Page,
  memberName: MemberName,
): Promise<Record<string, string>> {
  const member = await applyAcceptanceMember(page, memberName);
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: baseUrl,
    "X-CSRF-Token": member.csrf_token,
  };
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

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
  await page.getByRole("button", { name: "Edit categories", exact: true }).click();
  const categoryEditor = page.getByRole("dialog", {
    name: "Edit recipe categories",
    exact: true,
  });
  const categories = categoryEditor.getByRole("group", {
    name: "Curated recipe categories",
  });
  await categories.getByRole("checkbox", { name: "Breakfast" }).check();
  await categories.getByRole("checkbox", { name: "Quick & Easy" }).check();
  await categoryEditor.getByRole("button", { name: "Done", exact: true }).click();
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
    .fill("Knead the pecans into a small lifecycle test bite and serve.");
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
  publicationResponse: Promise<Response>,
): Promise<string> {
  await confirmPublicationRequirements(page);
  await page
    .getByRole("button", { name: "Review and publish", exact: true })
    .click();
  const preflight = await preflightResponse;
  expect(preflight.status(), await preflight.text()).toBe(201);
  const preflightBody = (await preflight.json()) as {
    classification?: unknown;
  };
  if (preflightBody.classification !== "distinct") {
    const review = page.getByRole("region", {
      name:
        preflightBody.classification === "exact_duplicate"
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
  const publication = await publicationResponse;
  expect(publication.status(), await publication.text()).toBe(201);
  const body = (await publication.json()) as {
    location?: unknown;
    recipe_version_id?: unknown;
  };
  expect(body.recipe_version_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(body.location).toBe(`/recipes/${body.recipe_version_id}`);
  expect(publication.headers().location).toBe(body.location);
  await expect(page).toHaveURL(body.location as string);
  const categories = page.getByRole("list", { name: /^Categories for / });
  await expect(
    categories.getByText("Breakfast", { exact: true }),
  ).toBeVisible();
  await expect(
    categories.getByText("Quick & Easy", { exact: true }),
  ).toBeVisible();
  return body.recipe_version_id as string;
}

async function publishOriginal(
  page: Page,
  memberName: MemberName,
  title: string,
): Promise<string> {
  await applyAcceptanceMember(page, memberName);
  await page.goto("/recipes/new");
  await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
  await fillCompleteRecipe(page, title);
  const draftId = new URL(page.url()).pathname.split("/").at(-1)!;
  const preflightResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(`/api/recipe-drafts/${draftId}/duplicate-preflights`),
  );
  const publicationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/recipe-drafts/${draftId}/publish`),
  );
  return finishOriginalPublication(
    page,
    preflightResponse,
    publicationResponse,
  );
}

async function publishUnchangedFork(
  page: Page,
  sourceId: string,
  childTitle: string,
): Promise<string> {
  await page.goto(`/recipes/${sourceId}/fork`);
  await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
  const draftId = new URL(page.url()).pathname.split("/").at(-1)!;
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
        .endsWith(`/api/recipe-drafts/${draftId}/duplicate-preflights`),
  );
  await confirmPublicationRequirements(page);
  await page
    .getByRole("button", { name: "Review and publish version", exact: true })
    .click();
  const preflight = await preflightResponse;
  expect(preflight.status(), await preflight.text()).toBe(201);
  expect(await preflight.json()).toMatchObject({
    classification: "exact_duplicate",
    same_lineage_no_change: true,
    acknowledgement: { required: true },
  });

  const review = page.getByRole("region", {
    name: "This version is very close to its source",
  });
  await review
    .getByRole("checkbox", {
      name: /closely matches its source.*publish it separately/i,
    })
    .check();
  const publicationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/recipe-drafts/${draftId}/publish`),
  );
  await review
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  const publication = await publicationResponse;
  expect(publication.status(), await publication.text()).toBe(201);
  const body = (await publication.json()) as {
    location?: unknown;
    recipe_version_id?: unknown;
  };
  expect(body.recipe_version_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(body.location).toBe(`/recipes/${body.recipe_version_id}`);
  expect(publication.headers().location).toBe(body.location);
  await expect(page).toHaveURL(body.location as string);
  const categories = page.getByRole("list", { name: /^Categories for / });
  await expect(
    categories.getByText("Breakfast", { exact: true }),
  ).toBeVisible();
  await expect(
    categories.getByText("Quick & Easy", { exact: true }),
  ).toBeVisible();
  return body.recipe_version_id as string;
}

test.describe("recipe visibility and account lifecycle acceptance", () => {
  test.describe.configure({ retries: 0, timeout: 90_000 });
  test.skip(
    !acceptanceEnabled,
    "Recipe-lifecycle acceptance requires the isolated, freshly seeded database.",
  );

  test("withdraws and restores only an authored version without hiding its public child", async ({
    page,
  }) => {
    const runId = crypto.randomUUID().slice(0, 8);
    const sourceTitle = `RCP30 lifecycle parent ${runId}`;
    const childTitle = `RCP30 lifecycle child ${runId}`;
    const sourceId = await publishOriginal(page, "alice", sourceTitle);

    await page.goto(
      `/recipes?category=breakfast&q=${encodeURIComponent(sourceTitle)}`,
    );
    await expect(
      page.getByRole("link", { name: sourceTitle, exact: true }),
    ).toBeVisible();
    await page.goto(
      `/recipes?category=lunch&q=${encodeURIComponent(sourceTitle)}`,
    );
    await expect(
      page.getByRole("link", { name: sourceTitle, exact: true }),
    ).toHaveCount(0);

    const bobHeaders = await csrfHeaders(page, "bob");
    const withdrawnReplayKey = crypto.randomUUID();
    const draftBeforeWithdrawal = await page.request.post(
      "/api/recipe-drafts",
      {
        data: { source_version_id: sourceId },
        headers: { ...bobHeaders, "Idempotency-Key": withdrawnReplayKey },
      },
    );
    expect(
      draftBeforeWithdrawal.status(),
      await draftBeforeWithdrawal.text(),
    ).toBe(201);
    const draftBeforeWithdrawalBody = (await draftBeforeWithdrawal.json()) as {
      id?: unknown;
    };
    expect(draftBeforeWithdrawalBody.id).toMatch(/^[0-9a-f-]{36}$/i);

    const childId = await publishUnchangedFork(page, sourceId, childTitle);
    const unauthorized = await page.request.put(
      `/api/recipes/${sourceId}/visibility`,
      {
        data: { state: "author_withdrawn" },
        headers: bobHeaders,
      },
    );
    expect(unauthorized.status(), await unauthorized.text()).toBe(404);

    await applyAcceptanceMember(page, "alice");
    await page.goto("/account/recipes?view=published");
    let sourceCard = page.getByRole("article", {
      name: sourceTitle,
      exact: true,
    });
    await sourceCard
      .getByRole("button", { name: `Withdraw ${sourceTitle}`, exact: true })
      .click();
    const withdrawalResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/recipes/${sourceId}/visibility`),
    );
    await sourceCard
      .getByRole("button", {
        name: `Confirm withdrawal of ${sourceTitle}`,
        exact: true,
      })
      .click();
    expect((await withdrawalResponse).status()).toBe(200);
    await expect(page.getByRole("status").filter({
      hasText: `${sourceTitle} moved to Withdrawn.`,
    })).toHaveText(
      `${sourceTitle} moved to Withdrawn.`,
    );
    await expect(sourceCard).toHaveCount(0);

    await page.goto("/account/recipes?view=withdrawn");
    sourceCard = page.getByRole("article", { name: sourceTitle, exact: true });
    await expect(
      sourceCard.getByText("Original", { exact: true }),
    ).toBeVisible();
    await expect(
      sourceCard.getByRole("link", { name: sourceTitle, exact: true }),
    ).toHaveCount(0);

    const replayHeaders = await csrfHeaders(page, "bob");
    const replayAfterWithdrawal = await page.request.post(
      "/api/recipe-drafts",
      {
        data: { source_version_id: sourceId },
        headers: { ...replayHeaders, "Idempotency-Key": withdrawnReplayKey },
      },
    );
    expect(
      replayAfterWithdrawal.status(),
      await replayAfterWithdrawal.text(),
    ).toBe(409);
    expect(await replayAfterWithdrawal.json()).toMatchObject({
      error: { code: "idempotency_key_conflict" },
    });
    const newIntentAfterWithdrawal = await page.request.post(
      "/api/recipe-drafts",
      {
        data: { source_version_id: sourceId },
        headers: { ...replayHeaders, "Idempotency-Key": crypto.randomUUID() },
      },
    );
    expect(newIntentAfterWithdrawal.status()).toBe(404);
    expect(await newIntentAfterWithdrawal.json()).toMatchObject({
      error: { code: "recipe_source_not_found" },
    });

    const unavailableSource = await page.request.get(
      `/api/recipes/${sourceId}`,
    );
    expect(unavailableSource.status()).toBe(404);
    await page.goto(`/recipes?q=${encodeURIComponent(sourceTitle)}`);
    await expect(
      page.getByRole("link", { name: sourceTitle, exact: true }),
    ).toHaveCount(0);

    await page.goto(`/recipes/${childId}`);
    await expect(
      page.getByRole("heading", { name: childTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      page.locator(".recipe-detail__parent-context").first(),
    ).toHaveText("Source unavailable");
    await expect(page.getByText(sourceTitle, { exact: true })).toHaveCount(0);
    await expectNoAccessibilityViolations(page);

    await applyAcceptanceMember(page, "alice");
    await page.goto("/account/recipes?view=withdrawn");
    sourceCard = page.getByRole("article", { name: sourceTitle, exact: true });
    const restoreResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().endsWith(`/api/recipes/${sourceId}/visibility`),
    );
    await sourceCard
      .getByRole("button", { name: `Restore ${sourceTitle}`, exact: true })
      .click();
    expect((await restoreResponse).status()).toBe(200);
    await expect(page.getByRole("status").filter({
      hasText: `${sourceTitle} moved to Published.`,
    })).toHaveText(
      `${sourceTitle} moved to Published.`,
    );
    await expect(sourceCard).toHaveCount(0);

    await page.goto("/account/recipes?view=published");
    sourceCard = page.getByRole("article", { name: sourceTitle, exact: true });
    await expect(
      sourceCard.getByText("Original", { exact: true }),
    ).toBeVisible();
    await expect(
      sourceCard.getByRole("link", { name: sourceTitle, exact: true }),
    ).toBeVisible();
    expect((await page.request.get(`/api/recipes/${sourceId}`)).status()).toBe(
      200,
    );
  });

  test("deletes private account data while retaining public history as Deleted cook", async ({
    browser,
    page,
  }) => {
    const runId = crypto.randomUUID().slice(0, 8);
    const title = `RCP30 deleted cook recipe ${runId}`;
    const recipeId = await publishOriginal(page, "deleter", title);

    await page.goto("/account/settings");
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Danger zone" }).click();
    await page
      .getByText("What happens to my published recipes?")
      .click();
    await expect(
      page.getByText(/public recipes remain public/i),
    ).toBeVisible();
    await expect(page.getByText(/author name is replaced/i)).toHaveText(
      /Deleted cook/i,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await expectNoAccessibilityViolations(page);

    await page
      .getByRole("checkbox", { name: /account deletion is permanent/i })
      .check();
    await page
      .getByLabel(/Type acceptance_deleter to confirm/i)
      .fill("acceptance_deleter");
    const deletionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith("/api/auth/account"),
    );
    await page
      .getByRole("button", { name: "Permanently delete account" })
      .click();
    expect((await deletionResponse).status()).toBe(204);
    await expect(page).toHaveURL("/account/deleted");
    await expect(
      page.getByRole("heading", {
        name: "Your account has been deleted.",
        level: 1,
      }),
    ).toBeVisible();
    const accountSession = await page.request.get("/api/auth/session");
    expect(accountSession.status(), await accountSession.text()).toBe(200);
    expect(await accountSession.json()).toEqual({ status: "anonymous" });

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(new URL(`/recipes/${recipeId}`, baseUrl).toString());
    await expect(
      publicPage.getByRole("heading", { name: title, level: 1 }),
    ).toBeVisible();
    await expect(
      publicPage
        .getByRole("main")
        .locator(".recipe-detail__attribution")
        .getByText("Deleted cook", { exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByRole("link", { name: "Deleted cook" }),
    ).toHaveCount(0);
    await publicPage.goto(
      new URL("/cooks/acceptance_deleter", baseUrl).toString(),
    );
    await expect(
      publicPage.getByRole("heading", {
        name: "We couldn’t find that cook.",
        level: 1,
      }),
    ).toBeVisible();
    expect(
      (
        await publicPage.request.get(
          new URL("/api/cooks/acceptance_deleter", baseUrl).toString(),
        )
      ).status(),
    ).toBe(404);
    await publicContext.close();
  });
});
