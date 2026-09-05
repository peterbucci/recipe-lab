import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./acceptance-draft-isolation";
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

async function expectNoAccessibilityViolations(
  page: import("@playwright/test").Page,
) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations,
    JSON.stringify(
      results.violations.map((item) => ({
        id: item.id,
        targets: item.nodes.map((node) => node.target),
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

  test("edits, validates, orders, saves, and resumes structured actions in a fork draft", async ({
    page,
    sourceDrafts,
  }) => {
    const draftTitle = "Structured Action Carrot Draft";
    const stepTitle = "Prepare the cake pan";
    const revisedProse =
      "Grease the pan, preheat the oven to 175°C, then line the pan after a short pause.";

    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes?q=carrot");
    const rootRecipeCard = page
      .getByRole("article", {
        name: "Carrot Walnut Snack Cake",
        exact: true,
      })
      .filter({ has: page.getByText("Original", { exact: true }) });
    await expect(rootRecipeCard).toHaveCount(1);
    await Promise.all([
      page.waitForURL(/\/recipes\/[0-9a-f-]{36}$/i),
      rootRecipeCard
        .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
        .click(),
    ]);
    const sourceRecipeUrl = page.url();
    const sourceId = new URL(sourceRecipeUrl).pathname.split("/").at(-1)!;
    await sourceDrafts.assertFresh("alice", sourceId);
    await page
      .getByRole("button", { name: "Make your own version", exact: true })
      .click();
    await expect(page).toHaveURL(sourceRecipeUrl);
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Opening your recipe…", { exact: true }),
    ).toHaveCount(0);

    await page.getByLabel("Title", { exact: true }).fill(draftTitle);
    const firstStep = page.getByRole("group", { name: "Step 1", exact: true });
    await firstStep.getByLabel("Step title", { exact: true }).fill(stepTitle);
    await firstStep
      .getByLabel("Instruction", { exact: true })
      .fill(revisedProse);
    await page
      .getByRole("tab", { name: "Cooking breakdown", exact: true })
      .click();
    const cookingDetails = page.getByRole("list", {
      name: "Cooking details for Step 1",
      exact: true,
    });
    const preheatDetail = cookingDetails.getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
      exact: true,
    });
    const greaseDetail = cookingDetails.getByRole("button", {
      name: "Edit cooking detail 2 for Step 1",
      exact: true,
    });
    const lineDetail = cookingDetails.getByRole("button", {
      name: "Edit cooking detail 3 for Step 1",
      exact: true,
    });
    await expect(preheatDetail).toHaveAttribute("aria-expanded", "false");
    await expect(preheatDetail).toContainText(/preheat/i);
    await expect(
      page.getByRole("dialog", { name: /Cooking detail \d+ for Step 1/ }),
    ).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
    await preheatDetail.focus();
    await page.keyboard.press("Enter");
    await expect(preheatDetail).toHaveAttribute("aria-expanded", "true");

    const preheatAction = page.getByRole("dialog", {
      name: "Cooking detail 1 for Step 1",
      exact: true,
    });
    const preheatSelect = preheatAction.getByRole("combobox", {
      name: "Cooking action",
      exact: true,
    });
    const preheatTypeId = await preheatSelect.inputValue();
    await preheatAction
      .getByRole("group", {
        name: /temperature for cooking detail 1: preheat/i,
      })
      .getByRole("textbox", { name: "Temperature", exact: true })
      .fill("175.0");
    await preheatAction
      .getByRole("button", { name: "Done", exact: true })
      .click();

    await greaseDetail.click();
    const greaseAction = page.getByRole("dialog", {
      name: "Cooking detail 2 for Step 1",
      exact: true,
    });
    const greaseSelect = greaseAction.getByRole("combobox", {
      name: "Cooking action",
      exact: true,
    });
    const greaseTypeId = await greaseSelect.inputValue();
    await greaseAction
      .getByRole("checkbox", { name: "Include duration", exact: true })
      .check();
    const duration = greaseAction.getByRole("group", {
      name: /duration for cooking detail 2: grease/i,
    });
    await duration
      .getByRole("textbox", { name: "Duration", exact: true })
      .fill("2.500");
    const durationUnit = duration.getByRole("combobox", {
      name: "Unit",
      exact: true,
    });
    await durationUnit.selectOption({ label: "minute (min)" });
    const minuteUnitId = await durationUnit.inputValue();
    await greaseAction
      .getByRole("button", { name: "Done", exact: true })
      .click();

    await lineDetail.click();
    const lineAction = page.getByRole("dialog", {
      name: "Cooking detail 3 for Step 1",
      exact: true,
    });
    const lineSelect = lineAction.getByRole("combobox", {
      name: "Cooking action",
      exact: true,
    });
    const lineTypeId = await lineSelect.inputValue();
    const stableLineSelectId = await lineSelect.getAttribute("id");
    expect(stableLineSelectId).not.toBeNull();
    const whiteSugarInput = lineAction
      .getByRole("group", { name: "Ingredient inputs", exact: true })
      .getByRole("checkbox", { name: /Ingredient 3: White sugar/i });
    await whiteSugarInput.check();
    await lineSelect.selectOption("");
    await lineAction.getByRole("button", { name: "Done", exact: true }).click();
    await expect(lineAction).toHaveCount(0);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      lineAction.getByText("Choose a cooking action.", { exact: true }),
    ).toBeVisible();
    await expect(whiteSugarInput).toBeChecked();

    await lineSelect.selectOption({ label: "grease" });
    expect(await lineSelect.inputValue()).toBe(greaseTypeId);
    await lineAction.getByRole("button", { name: "Done", exact: true }).click();
    const correctedSave = page.getByRole("button", {
      name: "Save draft",
      exact: true,
    });
    await correctedSave.focus();
    await expect(correctedSave).toBeFocused();
    await correctedSave.press("Enter");
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("dialog", { name: /Cooking detail \d+ for Step 1/ }),
    ).toHaveCount(0);

    await greaseDetail.click();
    const reopenedGreaseAction = page.getByRole("dialog", {
      name: "Cooking detail 2 for Step 1",
      exact: true,
    });
    await reopenedGreaseAction
      .getByRole("combobox", { name: "Cooking action", exact: true })
      .selectOption({ label: "line" });
    await expect(
      reopenedGreaseAction.getByRole("textbox", {
        name: "Duration",
        exact: true,
      }),
    ).toHaveValue("2.5");
    await reopenedGreaseAction
      .getByRole("button", { name: "Done", exact: true })
      .click();

    await cookingDetails
      .getByRole("button", { name: "Move cooking detail 3 up", exact: true })
      .click();
    await cookingDetails
      .getByRole("button", { name: "Move cooking detail 2 up", exact: true })
      .click();
    const reorderedDetails = cookingDetails.getByRole("button", {
      name: /Edit cooking detail \d+ for Step 1/,
    });
    await expect(reorderedDetails.nth(0)).toContainText(/grease/i);
    await expect(reorderedDetails.nth(1)).toContainText(/preheat/i);
    await expect(reorderedDetails.nth(2)).toContainText(/line/i);
    await reorderedDetails.nth(0).click();
    const movedLineAction = page.getByRole("dialog", {
      name: "Cooking detail 1 for Step 1",
      exact: true,
    });
    await expect(
      movedLineAction.getByRole("combobox", {
        name: "Cooking action",
        exact: true,
      }),
    ).toHaveValue(greaseTypeId);
    await expect(
      movedLineAction.getByRole("checkbox", {
        name: /Ingredient 3: White sugar/i,
      }),
    ).toBeChecked();
    expect(
      await movedLineAction
        .getByRole("combobox", { name: "Cooking action", exact: true })
        .getAttribute("id"),
    ).toBe(stableLineSelectId);
    await movedLineAction
      .getByRole("button", { name: "Done", exact: true })
      .click();

    await expectNoAccessibilityViolations(page);

    const saveRequest = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        /\/api\/recipe-drafts\/[0-9a-f-]+$/i.test(
          new URL(request.url()).pathname,
        ),
    );
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        /\/api\/recipe-drafts\/[0-9a-f-]+$/i.test(
          new URL(response.url()).pathname,
        ),
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const savedRequest = await saveRequest;
    const draftId = new URL(savedRequest.url()).pathname.split("/").at(-1)!;
    const submitted = savedRequest.postDataJSON() as {
      instructions: Array<{
        title: string | null;
        text: string;
        actions: Array<Record<string, unknown>>;
      }>;
    };
    const savedActions = submitted.instructions[0]?.actions;
    expect(submitted.instructions[0]?.title).toBe(stepTitle);
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
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();
    await page.getByRole("tab", { name: "Steps", exact: true }).click();
    await expect(
      firstStep.getByLabel("Instruction", { exact: true }),
    ).toHaveValue(revisedProse);

    await page.reload();
    await page
      .getByRole("button", { name: "Continue your version", exact: true })
      .click();
    await expect(page).toHaveURL(sourceRecipeUrl);
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      draftTitle,
    );
    const resumedStep = page.getByRole("group", {
      name: "Step 1",
      exact: true,
    });
    await expect(
      resumedStep.getByLabel("Step title", { exact: true }),
    ).toHaveValue(stepTitle);
    await expect(
      resumedStep.getByLabel("Instruction", { exact: true }),
    ).toHaveValue(revisedProse);
    await page
      .getByRole("tab", { name: "Cooking breakdown", exact: true })
      .click();
    const resumedDetails = page.getByRole("list", {
      name: "Cooking details for Step 1",
      exact: true,
    });
    const resumedTriggers = resumedDetails.getByRole("button", {
      name: /Edit cooking detail \d+ for Step 1/,
    });
    await expect(resumedTriggers).toHaveCount(3);
    await expect(resumedTriggers.nth(0)).toContainText(/grease/i);
    await expect(resumedTriggers.nth(1)).toContainText(/preheat/i);
    await expect(resumedTriggers.nth(1)).toContainText(/175/);
    await expect(resumedTriggers.nth(2)).toContainText(/line/i);
    const expectedActionTypeIds = [greaseTypeId, preheatTypeId, lineTypeId];
    for (const [
      index,
      expectedActionTypeId,
    ] of expectedActionTypeIds.entries()) {
      await resumedTriggers.nth(index).click();
      const resumedAction = page.getByRole("dialog", {
        name: `Cooking detail ${index + 1} for Step 1`,
        exact: true,
      });
      await expect(
        resumedAction.getByRole("combobox", {
          name: "Cooking action",
          exact: true,
        }),
      ).toHaveValue(expectedActionTypeId);
      await resumedAction
        .getByRole("button", { name: "Done", exact: true })
        .click();
    }
    await expectNoAccessibilityViolations(page);

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
      .getByRole("button", { name: "Review and publish version", exact: true })
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
            ? "This version is very close to another public recipe"
            : "This version is similar to another public recipe",
      });
      await review
        .getByRole("checkbox", {
          name: /reviewed these similar recipes.*publish my version anyway/i,
        })
        .check();
      await review
        .getByRole("button", { name: "Publish version", exact: true })
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

    const stepsPanel = page.getByRole("tabpanel", { name: "Steps" });
    await expect(
      stepsPanel.getByRole("heading", { name: stepTitle, exact: true }),
    ).toBeVisible();
    await expect(
      stepsPanel.getByText(revisedProse, { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("tab", { name: "Cooking breakdown", exact: true })
      .click();
    const breakdownPanel = page.getByRole("tabpanel", {
      name: "Cooking breakdown",
    });
    await expect(
      breakdownPanel.getByRole("heading", { name: stepTitle, exact: true }),
    ).toBeVisible();
    const publishedDetails = breakdownPanel.getByRole("list", {
      name: "Cooking breakdown for step 1",
    });
    const publishedActions = publishedDetails.getByRole("listitem");
    await expect(publishedActions).toHaveCount(3);
    await expect(publishedActions.nth(0)).toContainText("Grease");
    await expect(publishedActions.nth(1)).toContainText("Preheat");
    await expect(publishedActions.nth(1)).toContainText(/175/);
    await expect(publishedActions.nth(2)).toContainText("Line pan");
    await expect(publishedActions.nth(2)).toContainText(/2\.5 min/);
    await expect(publishedDetails).not.toContainText(
      /Inputs:|Duration:|Temperature:|Historical action/,
    );
    await expectNoAccessibilityViolations(page);

    await page
      .locator(".recipe-detail__parent-context")
      .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
      .click();
    await expect(page).toHaveURL(sourceRecipeUrl);
    await page.getByRole("tab", { name: "Family", exact: true }).click();
    const family = page.getByRole("tabpanel", { name: "Family", exact: true });
    await family
      .getByRole("button", {
        name: `Show ${draftTitle} in the family tree`,
        exact: true,
      })
      .click();
    const compare = family.getByRole("link", {
      name: "Compare with Carrot Walnut Snack Cake →",
      exact: true,
    });
    const comparisonPath =
      `/recipes/${published.recipe_version_id}/compare?base_version_id=${sourceId}`;
    await expect(compare).toHaveAttribute("href", comparisonPath);
    await compare.click();
    await expect(page).toHaveURL(comparisonPath);
    const changedInstruction = page.getByRole("article", {
      name: "Update step 1",
      exact: true,
    });
    await expect(changedInstruction).toContainText("Step title changed");
    await expect(changedInstruction).toContainText("Wording changed");
    await expect(changedInstruction).toContainText(
      "Order within the step changed",
    );
    await expect(changedInstruction).toContainText("Timing changed");
    await expect(changedInstruction).toContainText("Temperature changed");
    await expectNoAccessibilityViolations(page);
  });
});
