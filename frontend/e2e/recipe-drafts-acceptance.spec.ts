import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

const acceptanceEnabled =
  process.env.MVP_ACCEPTANCE === "1" &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

async function dismissUnsavedChangesDialog(
  page: Page,
  triggerNavigation: () => Promise<unknown>,
) {
  await Promise.all([
    page.waitForEvent("dialog").then(async (dialog) => {
      expect(dialog.message()).toContain("unsaved recipe changes");
      await dialog.dismiss();
    }),
    triggerNavigation(),
  ]);
}

test.describe("private recipe draft acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    !acceptanceEnabled,
    "Private-draft acceptance requires the isolated, freshly seeded acceptance database.",
  );

  test("creates, protects, resumes, and discards an incomplete private draft", async ({ page }) => {
    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes/new");
    await expect(page.getByRole("heading", { name: "Start a new recipe draft." })).toBeVisible();
    await page.getByRole("button", { name: "Start writing" }).click();
    await expect(page).toHaveURL(/\/account\/recipe-drafts\/[0-9a-f-]+$/i);
    const draftId = new URL(page.url()).pathname.split("/").at(-1);
    expect(draftId).toMatch(/^[0-9a-f-]{36}$/i);

    await page.getByLabel("Title").fill("Acceptance pantry soup");
    await dismissUnsavedChangesDialog(page, () =>
      page.getByRole("link", { name: "Explore recipes" }).click(),
    );
    await expect(page.getByLabel("Title")).toHaveValue("Acceptance pantry soup");

    await dismissUnsavedChangesDialog(page, () =>
      page.evaluate(() => window.history.back()),
    );
    await expect(page.getByLabel("Title")).toHaveValue("Acceptance pantry soup");

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved privately.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Title")).toHaveValue("Acceptance pantry soup");

    await page.getByLabel("Title").fill("Acceptance interrupted soup");
    await page.context().clearCookies({ name: "recipe_lab_session" });
    const expiredSave = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === `/api/recipe-drafts/${draftId}`,
    );
    await page.getByRole("button", { name: "Save draft" }).click();
    expect((await expiredSave).status()).toBe(401);
    const interruption = page.getByRole("alert", {
      name: "Your session expired. Your work is still here.",
    });
    await expect(interruption).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in in a new tab" })).toHaveAttribute(
      "target",
      "_blank",
    );
    await expect(page.getByLabel("Title")).toHaveValue("Acceptance interrupted soup");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    const interruptedAccessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(interruptedAccessibility.violations).toEqual([]);

    await page.getByRole("button", { name: "Keep editing for now" }).click();
    await expect(page.getByText(/Sign-in is still required before saving/)).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Acceptance interrupted soup");
    await page.getByRole("button", { name: "Resume sign-in" }).click();
    await useAcceptanceMember(page, "alice");
    await page.getByRole("button", { name: "Check sign-in" }).click();
    await expect(interruption).toHaveCount(0);
    await expect(page.getByLabel("Title")).toHaveValue("Acceptance interrupted soup");

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved privately.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Title")).toHaveValue("Acceptance interrupted soup");

    await useAcceptanceMember(page, "bob");
    const crossOwner = await page.request.get(
      new URL(`/api/recipe-drafts/${draftId}`, baseUrl).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(crossOwner.status()).toBe(404);
    expect(await crossOwner.json()).toMatchObject({ error: { code: "recipe_draft_not_found" } });

    await useAcceptanceMember(page, "alice");
    await page.goto(`/account/recipe-drafts/${draftId}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("Title")).toHaveValue("Acceptance interrupted soup");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);

    await page.getByRole("button", { name: "Discard draft…" }).click();
    await expect(page.getByText(/permanently deletes this draft/i)).toBeVisible();
    await page.getByRole("button", { name: "Discard permanently" }).click();
    await expect(page).toHaveURL("/account/recipe-drafts");
    await expect(page.getByText("Acceptance interrupted soup")).toHaveCount(0);
  });
});
