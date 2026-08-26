import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { useAcceptanceMember as applyAcceptanceMember } from "./acceptance-session";

const acceptanceEnabled =
  process.env.MVP_ACCEPTANCE === "1" &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

interface RecipeSummary {
  id: string;
  title: string;
}

async function firstPublicRecipe(page: Page): Promise<RecipeSummary> {
  const response = await page.request.get(new URL("/api/recipes?page_size=1", baseUrl).toString());
  expect(response.status(), await response.text()).toBe(200);
  const payload = (await response.json()) as { items?: unknown };
  expect(Array.isArray(payload.items)).toBe(true);
  const recipe = (payload.items as Array<Record<string, unknown>>)[0];
  expect(recipe?.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(typeof recipe?.title).toBe("string");
  return { id: recipe.id as string, title: recipe.title as string };
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

test.describe("recipe reporting and moderation acceptance", () => {
  test.describe.configure({ retries: 0, timeout: 90_000 });
  test.skip(
    !acceptanceEnabled,
    "Recipe moderation requires the isolated, freshly seeded acceptance database.",
  );

  test("keeps reports private and exercises the separate moderator workflow", async ({
    browser,
    page,
  }) => {
    const recipe = await firstPublicRecipe(page);
    const privateDetails = `<img src="x" onerror="window.__rcp31_pwned = true"> RCP31 private report ${crypto.randomUUID().slice(0, 8)}`;

    await applyAcceptanceMember(page, "alice");
    await page.goto(`/recipes/${recipe.id}`);
    await page.getByRole("button", { name: "Report recipe", exact: true }).click();
    await page.getByRole("radio", { name: "Spam or misleading content", exact: true }).check();
    await page.getByLabel("Additional details (optional)").fill(privateDetails);
    const reportResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipes/${recipe.id}/reports`),
    );
    await page.getByRole("button", { name: "Submit private report", exact: true }).click();
    expect((await reportResponse).status()).toBe(201);
    await expect(
      page.getByText("Report received. Thank you for helping keep Recipe Lab safe.", {
        exact: true,
      }),
    ).toBeVisible();

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    const publicDetail = await publicPage.request.get(
      new URL(`/api/recipes/${recipe.id}`, baseUrl).toString(),
    );
    expect(publicDetail.status(), await publicDetail.text()).toBe(200);
    expect(await publicDetail.text()).not.toContain(privateDetails);
    await publicContext.close();

    await applyAcceptanceMember(page, "bob");
    const ordinaryQueue = await page.request.get(
      new URL("/api/moderation/recipe-reports", baseUrl).toString(),
    );
    expect(ordinaryQueue.status(), await ordinaryQueue.text()).toBe(403);

    await applyAcceptanceMember(page, "curator");
    await page.goto("/moderation/recipes");
    await expect(
      page.getByRole("heading", { name: "We couldn’t find that page.", level: 1 }),
    ).toBeVisible();

    const moderator = await applyAcceptanceMember(page, "moderator");
    await page.goto("/");
    await page.getByLabel("Account menu for Morgan Moderator").click();
    await page.getByRole("link", { name: "Review recipe reports", exact: true }).click();
    await expect(page).toHaveURL("/moderation/recipes");
    await expect(page.getByRole("heading", { name: "Recipe reports", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: recipe.title, level: 2 })).toBeVisible();
    await expect(page.getByText(privateDetails, { exact: true })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.getByText("1 reporter", { exact: true })).toBeVisible();
    await expect(page.getByText("acceptance_alice", { exact: true })).toHaveCount(0);
    await expect(page.getByText(moderator.user_id, { exact: true })).toHaveCount(0);
    await expectNoAccessibilityViolations(page);

    await page.getByLabel("Private note (optional)").fill("Hide while the report is reviewed.");
    const hideResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/moderation/recipe-reports/${recipe.id}/actions`),
    );
    await page.getByRole("button", { name: "Hide recipe", exact: true }).click();
    expect((await hideResponse).status()).toBe(200);
    await expect(page.getByText(/Recipe hidden\. The moderation record was updated\./)).toBeVisible();

    const hiddenContext = await browser.newContext();
    const hiddenPage = await hiddenContext.newPage();
    const hiddenDetail = await hiddenPage.request.get(
      new URL(`/api/recipes/${recipe.id}`, baseUrl).toString(),
    );
    expect(hiddenDetail.status()).toBe(404);
    await hiddenContext.close();

    await expect(page.getByRole("button", { name: "Restore recipe", exact: true })).toBeEnabled();
    const restoreResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/moderation/recipe-reports/${recipe.id}/actions`),
    );
    await page.getByRole("button", { name: "Restore recipe", exact: true }).click();
    expect((await restoreResponse).status()).toBe(200);
    await expect(page.getByText(/Recipe restored\. The moderation record was updated\./)).toBeVisible();
    expect(
      (
        await page.request.get(new URL(`/api/recipes/${recipe.id}`, baseUrl).toString())
      ).status(),
    ).toBe(200);

    await expect(page.getByRole("button", { name: "Resolve case", exact: true })).toBeEnabled();
    const resolveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/moderation/recipe-reports/${recipe.id}/actions`),
    );
    await page.getByRole("button", { name: "Resolve case", exact: true }).click();
    expect((await resolveResponse).status()).toBe(200);
    await expect(page.getByText(/Case resolved\. The moderation record was updated\./)).toBeVisible();
    await page.getByRole("button", { name: "Resolved", exact: true }).click();
    await expect(page.getByRole("heading", { name: recipe.title, level: 2 })).toBeVisible();
    await expect(page.getByText("Resolved case", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Private audit history", level: 3 })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});
