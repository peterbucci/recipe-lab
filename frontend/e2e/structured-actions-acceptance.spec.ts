import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  continueRecipeDuplicateReviewIfRequired,
  useAcceptanceMember,
} from "./acceptance-session";

const recipePathPattern = /^\/recipes\/([^/]+)$/;

function recipeVersionId(page: Page): string {
  const match = new URL(page.url()).pathname.match(recipePathPattern);
  if (!match) {
    throw new Error(`Could not read the recipe version ID from ${page.url()}.`);
  }
  return decodeURIComponent(match[1]);
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations,
    JSON.stringify(
      results.violations.map((violation) => ({
        id: violation.id,
        help: violation.help,
        targets: violation.nodes.map((node) => node.target),
      })),
      null,
      2,
    ),
  ).toEqual([]);
}

test.describe("structured cooking action acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    process.env.MVP_ACCEPTANCE !== "1" ||
      process.env.ACCEPTANCE_DATABASE_ISOLATED !== "1",
    "Structured action acceptance requires the isolated, freshly seeded database.",
  );

  test("authors, validates, forks, reads, and compares ordered action structure", async ({
    page,
  }) => {
    const variantTitle = "Structured Action Carrot Cake";
    const revisedProse =
      "Grease the pan, preheat the oven to 175°C, then line the pan after a short pause.";

    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes?q=carrot");
    await page
      .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
      .click();
    await expect(page).toHaveURL(/\/recipes\/[^/?#]+$/);
    const sourceRecipeVersionId = recipeVersionId(page);
    await page.getByRole("link", { name: "Make your own version", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Make this recipe your own.", level: 1 }),
    ).toBeVisible();

    await page.getByLabel("Title", { exact: true }).fill(variantTitle);
    await page.getByRole("button", { name: "Edit step 1", exact: true }).click();
    await page.getByLabel("Instruction", { exact: true }).fill(revisedProse);

    const initialActionGroups = page.getByRole("group", { name: /^Action \d+$/ });
    await expect(initialActionGroups).toHaveCount(3);
    const preheatAction = page.getByRole("group", { name: "Action 1", exact: true });
    const greaseAction = page.getByRole("group", { name: "Action 2", exact: true });
    const lineAction = page.getByRole("group", { name: "Action 3", exact: true });
    const preheatSelect = preheatAction.getByRole("combobox", {
      name: "Cooking action",
    });
    const greaseSelect = greaseAction.getByRole("combobox", {
      name: "Cooking action",
    });
    const lineSelect = lineAction.getByRole("combobox", { name: "Cooking action" });
    const preheatTypeId = await preheatSelect.inputValue();
    const greaseTypeId = await greaseSelect.inputValue();
    const lineTypeId = await lineSelect.inputValue();
    const stableLineSelectId = await lineSelect.getAttribute("id");
    expect(stableLineSelectId).not.toBeNull();

    const preheatTemperature = preheatAction.getByRole("group", {
      name: /temperature for action 1: preheat/i,
    });
    await preheatTemperature
      .getByRole("textbox", { name: "Temperature", exact: true })
      .fill("175.0");

    await greaseAction
      .getByRole("checkbox", { name: "Include duration", exact: true })
      .check();
    const duration = greaseAction.getByRole("group", {
      name: /duration for action 2: grease/i,
    });
    await duration.getByRole("textbox", { name: "Duration", exact: true }).fill("2.500");
    const durationUnit = duration.getByRole("combobox", { name: "Unit", exact: true });
    await durationUnit.selectOption({ label: "minute (min)" });
    const minuteUnitId = await durationUnit.inputValue();

    await lineAction
      .getByRole("group", { name: "Ingredient inputs", exact: true })
      .getByRole("checkbox", { name: /Ingredient 3: White sugar, 180 g/i })
      .check();
    await lineSelect.selectOption("");

    await page.getByRole("button", { name: "Create my version", exact: true }).click();
    await expect(
      lineAction.getByText("Choose a cooking action.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Instruction", { exact: true })).toHaveValue(revisedProse);
    await expect(
      greaseAction.getByRole("textbox", { name: "Duration", exact: true }),
    ).toHaveValue("2.500");
    await expect(
      lineAction
        .getByRole("group", { name: "Ingredient inputs", exact: true })
        .getByRole("checkbox", { name: /Ingredient 3: White sugar, 180 g/i }),
    ).toBeChecked();

    await greaseSelect.selectOption({ label: "line" });
    await lineSelect.selectOption({ label: "grease" });
    expect(await greaseSelect.inputValue()).toBe(lineTypeId);
    expect(await lineSelect.inputValue()).toBe(greaseTypeId);

    const stableLineSelect = page.locator(`[id="${stableLineSelectId!}"]`);
    await page.getByRole("button", { name: "Move up action 3", exact: true }).click();
    await expect(stableLineSelect).toBeFocused();
    await page.getByRole("button", { name: "Move up action 2", exact: true }).click();
    await expect(stableLineSelect).toBeFocused();

    const orderedTypeIds = await page
      .getByRole("combobox", { name: "Cooking action" })
      .evaluateAll((selects) =>
        selects.slice(0, 3).map((select) => (select as HTMLSelectElement).value),
      );
    expect(orderedTypeIds).toEqual([greaseTypeId, preheatTypeId, lineTypeId]);
    await expectNoAccessibilityViolations(page);

    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(
          `/api/recipes/${encodeURIComponent(sourceRecipeVersionId)}/variants`,
        ),
    );
    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(
          `/api/recipes/${encodeURIComponent(sourceRecipeVersionId)}/variants`,
        ),
    );
    const duplicatePreflightResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/duplicate-preflights"),
    );
    await page.getByRole("button", { name: "Create my version", exact: true }).click();
    await continueRecipeDuplicateReviewIfRequired(
      page,
      await duplicatePreflightResponse,
    );

    const submitted = (await createRequest).postDataJSON() as {
      instruction_edits: Array<Record<string, unknown>>;
    };
    const setActions = submitted.instruction_edits.find(
      (edit) => edit.op === "set_actions",
    ) as { actions: Array<Record<string, unknown>> } | undefined;
    expect(setActions?.actions).toHaveLength(3);
    expect(setActions?.actions.map((action) => action.action_type_id)).toEqual([
      greaseTypeId,
      preheatTypeId,
      lineTypeId,
    ]);
    expect(setActions?.actions[0]).toMatchObject({
      ingredient_refs: [
        {
          kind: "existing",
          recipe_ingredient_id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
        },
      ],
    });
    expect(setActions?.actions[1]).toMatchObject({
      temperature: { kind: "exact", value: "175.0" },
    });
    expect(setActions?.actions[2]).toMatchObject({
      duration: { kind: "exact", value: "2.500", unit_id: minuteUnitId },
    });
    expect(
      submitted.instruction_edits.find((edit) => edit.op === "update"),
    ).toMatchObject({ text: revisedProse });
    expect((await createResponse).status()).toBe(201);

    await expect(page).toHaveURL(/\/recipes\/[^/]+$/);
    const childRecipeVersionId = recipeVersionId(page);
    const detailActions = page.getByRole("list", {
      name: "Structured actions for step 1",
    });
    const detailItems = detailActions.getByRole("listitem");
    await expect(detailItems).toHaveCount(3);
    await expect(detailItems.nth(0).getByText("grease", { exact: true })).toBeVisible();
    await expect(detailItems.nth(0)).toContainText("Inputs: Ingredient 3: White sugar");
    await expect(detailItems.nth(1).getByText("preheat", { exact: true })).toBeVisible();
    await expect(detailItems.nth(1)).toContainText("Temperature: 175");
    await expect(detailItems.nth(2).getByText("line", { exact: true })).toBeVisible();
    await expect(detailItems.nth(2)).toContainText("Duration: 2.5 minutes");
    await expect(page.getByText(revisedProse, { exact: true })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByRole("link", { name: "See what changed", exact: true }).click();
    await expect(page).toHaveURL(`/recipes/${childRecipeVersionId}/compare`);
    const changed = page.getByRole("article", { name: "Updated instruction" });
    for (const label of [
      "Prose changed",
      "Ingredient inputs changed",
      "Action order changed",
      "Duration changed",
      "Temperature changed",
    ]) {
      await expect(changed.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(changed.getByText(revisedProse, { exact: true })).toBeVisible();
    const afterActions = changed.locator("ins").getByRole("list", {
      name: "Structured cooking actions",
    });
    const afterItems = afterActions.getByRole("listitem");
    await expect(afterItems).toHaveCount(3);
    await expect(afterItems.nth(0).getByText("grease", { exact: true })).toBeVisible();
    await expect(afterItems.nth(1).getByText("preheat", { exact: true })).toBeVisible();
    await expect(afterItems.nth(2).getByText("line", { exact: true })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});
