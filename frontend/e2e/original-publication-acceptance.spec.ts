import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

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

async function completeOriginalDraft(page: Page, title: string): Promise<void> {
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
    .fill("Knead the pecans into a small bite and serve.");
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
    await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
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

    await completeOriginalDraft(page, title);

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

    const preflightResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/api/recipe-drafts/${draftId}/duplicate-preflights`),
    );
    const publishResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${draftId}/publish`),
    );
    await confirmPublicationRequirements(page);
    await page
      .getByRole("button", { name: "Review and publish", exact: true })
      .click();
    const preflight = await preflightResponse;
    expect(preflight.status()).toBe(201);
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
      await expect(review).toBeVisible();
      await review
        .getByRole("checkbox", { name: /publish my recipe anyway/i })
        .check();
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
      await review
        .getByRole("button", { name: "Publish recipe", exact: true })
        .click();
    }
    const publication = await publishResponse;
    expect(publication.status()).toBe(201);
    const publicationBody = (await publication.json()) as {
      location?: unknown;
      recipe_version_id?: unknown;
    };
    expect(publicationBody.recipe_version_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(publicationBody.location).toBe(
      `/recipes/${publicationBody.recipe_version_id}`,
    );
    expect(publication.headers().location).toBe(publicationBody.location);

    await expect(page).toHaveURL("/account/recipes?view=published");
    await expect(
      page.getByRole("article", { name: title, exact: true }),
    ).toBeVisible();
    await page.goto(publicationBody.location as string);
    await expect(
      page.getByRole("heading", { name: title, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Version 1", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Based on", { exact: true })).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
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
    const activeDraftBody = (await activeDrafts.json()) as {
      items?: Array<{ id?: unknown }>;
    };
    expect(activeDraftBody.items?.some((item) => item.id === draftId)).toBe(
      false,
    );
    await page.goto(`/recipes?q=${encodeURIComponent(title)}`);
    await expect(
      page.getByRole("link", { name: title, exact: true }),
    ).toBeVisible();
  });

  test("recovers one publication after the first successful response is lost", async ({
    page,
  }) => {
    const title = "Acceptance Lost-Response Pecan Bite";
    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes/new");
    await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
    const draftId = new URL(page.url()).pathname.split("/").at(-1)!;
    await completeOriginalDraft(page, title);

    const publicationKeys: string[] = [];
    const committedPublications: Array<{
      location?: unknown;
      recipe_version_id?: unknown;
    }> = [];
    await page.route("**/api/recipe-drafts/*/publish", async (route) => {
      publicationKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (publicationKeys.length === 1) {
        const committed = await route.fetch();
        expect(committed.status()).toBe(201);
        committedPublications.push(await committed.json());
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    const preflightResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/api/recipe-drafts/${draftId}/duplicate-preflights`),
    );
    await confirmPublicationRequirements(page);
    await page
      .getByRole("button", { name: "Review and publish", exact: true })
      .click();
    const preflight = await preflightResponse;
    expect(preflight.status()).toBe(201);
    const preflightBody = (await preflight.json()) as {
      classification?: unknown;
      acknowledgement?: { required?: unknown };
    };
    if (preflightBody.acknowledgement?.required === true) {
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

    const ambiguousAlert = page.locator(".draft-publication__alert");
    await expect(ambiguousAlert).toBeVisible();
    await expect(ambiguousAlert).toContainText("Publication result is unclear");
    await expect(ambiguousAlert).toContainText(/may already be published/i);
    await expect(ambiguousAlert).toContainText(
      /cannot create a second publication/i,
    );
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
    expect(committedPublications).toHaveLength(1);

    const replayResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${draftId}/publish`),
    );
    await page
      .getByRole("button", {
        name: "Check publication result",
      })
      .click();
    const replay = await replayResponse;
    expect(replay.status()).toBe(201);
    const replayedPublication = (await replay.json()) as {
      location?: unknown;
      recipe_version_id?: unknown;
    };
    expect(replayedPublication).toEqual(committedPublications[0]);
    expect(publicationKeys).toHaveLength(2);
    expect(publicationKeys[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(publicationKeys[1]).toBe(publicationKeys[0]);
    expect(replay.headers().location).toBe(replayedPublication.location);
    await expect(page).toHaveURL("/account/recipes?view=published");

    const libraryResponse = await page.request.get(
      new URL(
        "/api/my/recipes?view=published&page=1&page_size=100",
        baseUrl,
      ).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(libraryResponse.status()).toBe(200);
    const library = (await libraryResponse.json()) as {
      items?: Array<{ kind?: unknown; recipe?: { id?: unknown } }>;
    };
    const matchingPublications = (library.items ?? []).filter(
      (item) =>
        item.kind === "published" &&
        item.recipe?.id === replayedPublication.recipe_version_id,
    );
    expect(matchingPublications).toHaveLength(1);
  });
});
