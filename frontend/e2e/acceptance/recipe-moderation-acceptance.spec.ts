import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./acceptance-draft-isolation";
import { useAcceptanceMember as applyAcceptanceMember } from "./acceptance-session";

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

  test("keeps reports private and exercises the separate moderator workflow", async ({
    browser,
    page,
    sourceDrafts,
  }) => {
    const recipe = await firstPublicRecipe(page);
    await sourceDrafts.assertFresh("alice", recipe.id);
    const privateDetails = `<img src="x" onerror="window.__rcp31_pwned = true"> RCP31 private report ${crypto.randomUUID().slice(0, 8)}`;

    const alice = await applyAcceptanceMember(page, "alice");
    const hiddenReplayKey = crypto.randomUUID();
    const draftBeforeHiding = await page.request.post(
      new URL("/api/recipe-drafts", baseUrl).toString(),
      {
        data: { source_version_id: recipe.id },
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": hiddenReplayKey,
          Origin: baseUrl,
          "X-CSRF-Token": alice.csrf_token,
        },
      },
    );
    expect(draftBeforeHiding.status(), await draftBeforeHiding.text()).toBe(201);
    const draftBeforeHidingBody = (await draftBeforeHiding.json()) as { id?: unknown };
    expect(draftBeforeHidingBody.id).toMatch(/^[0-9a-f-]{36}$/i);
    sourceDrafts.trackExplicit("alice", recipe.id, draftBeforeHidingBody.id as string);

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
    await page.getByRole("link", { name: "Staff tools", exact: true }).click();
    await page.getByRole("link", { name: "Open recipe reports", exact: true }).click();
    await expect(page).toHaveURL("/moderation/recipes");
    await expect(page.getByRole("heading", { name: "Recipe reports", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: recipe.title, level: 2 })).toBeVisible();
    await expect(page.getByText(privateDetails, { exact: true })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.getByText("1 reporter", { exact: true })).toBeVisible();
    await expect(page.getByText("acceptance_alice", { exact: true })).toHaveCount(0);
    await expect(page.getByText(moderator.user_id, { exact: true })).toHaveCount(0);
    await expectNoAccessibilityViolations(page);

    const privateNoteDisclosure = page
      .locator("details")
      .filter({ hasText: "Private moderator note" });
    await privateNoteDisclosure
      .getByText("Private moderator note", { exact: true })
      .click();
    await expect(privateNoteDisclosure).toHaveAttribute("open", "");
    await privateNoteDisclosure
      .getByLabel("Private note (optional)")
      .fill("Hide while the report is reviewed.");
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

    await applyAcceptanceMember(page, "alice");
    const replayAfterHiding = await page.request.post(
      new URL("/api/recipe-drafts", baseUrl).toString(),
      {
        data: { source_version_id: recipe.id },
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": hiddenReplayKey,
          Origin: baseUrl,
          "X-CSRF-Token": alice.csrf_token,
        },
      },
    );
    expect(replayAfterHiding.status(), await replayAfterHiding.text()).toBe(201);
    expect(await replayAfterHiding.json()).toMatchObject({ id: draftBeforeHidingBody.id });
    const newIntentAfterHiding = await page.request.post(
      new URL("/api/recipe-drafts", baseUrl).toString(),
      {
        data: { source_version_id: recipe.id },
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          Origin: baseUrl,
          "X-CSRF-Token": alice.csrf_token,
        },
      },
    );
    expect(newIntentAfterHiding.status()).toBe(404);
    expect(await newIntentAfterHiding.json()).toMatchObject({
      error: { code: "recipe_source_not_found" },
    });

    await applyAcceptanceMember(page, "moderator");
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
    await expect(page.locator(".moderation-detail__status-pill")).toHaveText("Resolved");
    const auditHistoryDisclosure = page
      .locator("details")
      .filter({ hasText: "Private audit history" });
    await auditHistoryDisclosure
      .getByText("Private audit history", { exact: true })
      .click();
    await expect(auditHistoryDisclosure).toHaveAttribute("open", "");
    await expect(auditHistoryDisclosure.getByText("Case resolved", { exact: true })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});
