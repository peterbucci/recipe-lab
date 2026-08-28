import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

async function confirmPublicationRequirements(page: Page): Promise<void> {
  await page.getByRole("checkbox", { name: /agree to the community rules/i }).check();
  await page.getByRole("checkbox", { name: /right to share it/i }).check();
}

async function expectNoAccessibilityViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations,
    JSON.stringify(results.violations.map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) })), null, 2),
  ).toEqual([]);
}

test.describe("structured cooking action acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    process.env.MVP_ACCEPTANCE !== "1" ||
      process.env.ACCEPTANCE_DATABASE_ISOLATED !== "1",
    "Structured action acceptance requires the isolated, freshly seeded database.",
  );

  test("edits, validates, orders, saves, and resumes structured actions in a fork draft", async ({ page }) => {
    const draftTitle = "Structured Action Carrot Draft";
    const revisedProse =
      "Grease the pan, preheat the oven to 175°C, then line the pan after a short pause.";

    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes?q=carrot");
    const rootRecipeCard = page
      .getByRole("article", {
        name: "Carrot Walnut Snack Cake",
        exact: true,
      })
      .filter({ hasNot: page.locator(".recipe-card__parent") });
    await expect(rootRecipeCard).toHaveCount(1);
    await rootRecipeCard
      .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
      .click();
    await page.getByRole("link", { name: "Make your own version", exact: true }).click();
    await expect(page.getByRole("heading", { name: /make carrot walnut snack cake your own/i })).toBeVisible();
    await page.getByRole("button", { name: "Create private draft", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/recipe-drafts\/[0-9a-f-]+$/i);

    await page.getByLabel("Title", { exact: true }).fill(draftTitle);
    const firstStep = page.getByRole("group", { name: "Step 1", exact: true });
    await firstStep.getByLabel("Human-readable direction", { exact: true }).fill(revisedProse);

    const actionGroups = firstStep.getByRole("group", { name: /^Action \d+$/ });
    await expect(actionGroups).toHaveCount(3);
    const preheatAction = actionGroups.nth(0);
    const greaseAction = actionGroups.nth(1);
    const lineAction = actionGroups.nth(2);
    const preheatSelect = preheatAction.getByRole("combobox", { name: "Cooking action" });
    const greaseSelect = greaseAction.getByRole("combobox", { name: "Cooking action" });
    const lineSelect = lineAction.getByRole("combobox", { name: "Cooking action" });
    const preheatTypeId = await preheatSelect.inputValue();
    const greaseTypeId = await greaseSelect.inputValue();
    const lineTypeId = await lineSelect.inputValue();
    const stableLineSelectId = await lineSelect.getAttribute("id");
    expect(stableLineSelectId).not.toBeNull();

    await preheatAction
      .getByRole("group", { name: /temperature for action 1: preheat/i })
      .getByRole("textbox", { name: "Temperature", exact: true })
      .fill("175.0");
    await greaseAction.getByRole("checkbox", { name: "Include duration", exact: true }).check();
    const duration = greaseAction.getByRole("group", { name: /duration for action 2: grease/i });
    await duration.getByRole("textbox", { name: "Duration", exact: true }).fill("2.500");
    const durationUnit = duration.getByRole("combobox", { name: "Unit", exact: true });
    await durationUnit.selectOption({ label: "minute (min)" });
    const minuteUnitId = await durationUnit.inputValue();

    const whiteSugarInput = lineAction
      .getByRole("group", { name: "Ingredient inputs", exact: true })
      .getByRole("checkbox", { name: /Ingredient 3: White sugar/i });
    await whiteSugarInput.check();
    await lineSelect.selectOption("");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(lineAction.getByText("Choose a cooking action.", { exact: true })).toBeVisible();
    await expect(firstStep.getByLabel("Human-readable direction", { exact: true })).toHaveValue(revisedProse);
    await expect(duration.getByRole("textbox", { name: "Duration", exact: true })).toHaveValue("2.500");
    await expect(whiteSugarInput).toBeChecked();

    await greaseSelect.selectOption({ label: "line" });
    await lineSelect.selectOption({ label: "grease" });
    expect(await greaseSelect.inputValue()).toBe(lineTypeId);
    expect(await lineSelect.inputValue()).toBe(greaseTypeId);
    const stableLineSelect = page.locator(`[id="${stableLineSelectId!}"]`);
    await firstStep.getByRole("button", { name: "Move up action 3", exact: true }).click();
    await expect(stableLineSelect).toBeFocused();
    await firstStep.getByRole("button", { name: "Move up action 2", exact: true }).click();
    await expect(stableLineSelect).toBeFocused();
    expect(
      await firstStep.getByRole("combobox", { name: "Cooking action" }).evaluateAll((items) =>
        items.map((item) => (item as HTMLSelectElement).value),
      ),
    ).toEqual([greaseTypeId, preheatTypeId, lineTypeId]);
    await expectNoAccessibilityViolations(page);

    const saveRequest = page.waitForRequest(
      (request) => request.method() === "PUT" && /\/api\/recipe-drafts\/[0-9a-f-]+$/i.test(new URL(request.url()).pathname),
    );
    const saveResponse = page.waitForResponse(
      (response) => response.request().method() === "PUT" && /\/api\/recipe-drafts\/[0-9a-f-]+$/i.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const submitted = (await saveRequest).postDataJSON() as {
      instructions: Array<{ text: string; actions: Array<Record<string, unknown>> }>;
    };
    const savedActions = submitted.instructions[0]?.actions;
    expect(submitted.instructions[0]?.text).toBe(revisedProse);
    expect(savedActions?.map((action) => action.action_type_id)).toEqual([
      greaseTypeId,
      preheatTypeId,
      lineTypeId,
    ]);
    expect(savedActions?.[0]).toMatchObject({
      ingredient_refs: [expect.stringMatching(/^[0-9a-f-]{36}$/i)],
    });
    expect(savedActions?.[1]).toMatchObject({
      temperature: { kind: "exact", value: "175.0" },
    });
    expect(savedActions?.[2]).toMatchObject({
      duration: { kind: "exact", value: "2.500", unit_id: minuteUnitId },
    });
    expect((await saveResponse).status()).toBe(200);
    await expect(page.getByText("Draft saved privately.", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(draftTitle);
    const resumedStep = page.getByRole("group", { name: "Step 1", exact: true });
    await expect(resumedStep.getByLabel("Human-readable direction", { exact: true })).toHaveValue(revisedProse);
    const resumedActions = resumedStep.getByRole("group", { name: /^Action \d+$/ });
    await expect(resumedActions).toHaveCount(3);
    await expect(resumedActions.nth(0).getByRole("combobox", { name: "Cooking action" })).toHaveValue(greaseTypeId);
    await expect(resumedActions.nth(1).getByRole("combobox", { name: "Cooking action" })).toHaveValue(preheatTypeId);
    await expect(resumedActions.nth(2).getByRole("combobox", { name: "Cooking action" })).toHaveValue(lineTypeId);
    await expectNoAccessibilityViolations(page);

    const draftId = new URL(page.url()).pathname.split("/").at(-1)!;
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
    await page.getByRole("button", { name: "Review and publish version", exact: true }).click();
    const preflight = await preflightResponse;
    expect(preflight.status()).toBe(201);
    const preflightBody = (await preflight.json()) as { classification?: unknown };
    if (preflightBody.classification !== "distinct") {
      const review = page.locator(".duplicate-preflight-review");
      await review
        .getByRole("checkbox", {
          name: /publish my version anyway|matches the recipe it is based on.*publish it anyway/i,
        })
        .check();
      await review.getByRole("button", { name: "Publish version anyway" }).click();
    }
    expect((await publishResponse).status()).toBe(201);
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/i);

    await page.getByRole("link", { name: "See what changed", exact: true }).click();
    const changedInstruction = page.getByRole("article", { name: "Updated instruction" }).first();
    await expect(changedInstruction).toContainText("Prose changed");
    await expect(changedInstruction).toContainText("Action order changed");
    await expect(changedInstruction).toContainText("Duration changed");
    await expect(changedInstruction).toContainText("Temperature changed");
    await expectNoAccessibilityViolations(page);
  });
});
