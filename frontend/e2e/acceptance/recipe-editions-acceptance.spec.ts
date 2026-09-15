import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, Response } from "@playwright/test";

import { expect, test } from "./acceptance-draft-isolation";
import { useAcceptanceMember } from "./acceptance-session";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
}

async function activateWithKeyboard(control: Locator): Promise<void> {
  await control.focus();
  await expect(control).toBeFocused();
  await control.press("Enter");
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
    .fill("Toast the pecans gently, cool them, and serve.");
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
    .selectOption({ label: "toast" });
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

async function publishPreparedDraft(
  page: Page,
  draftId: string,
  primaryAction: Locator,
  duplicateAcknowledgement: RegExp,
  duplicatePublishButton: string,
): Promise<Response> {
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

  await primaryAction.click();
  const preflight = await preflightResponse;
  expect(preflight.status(), await preflight.text()).toBe(201);
  const preflightBody = (await preflight.json()) as {
    classification?: unknown;
  };
  if (preflightBody.classification !== "distinct") {
    const review = page.locator(".duplicate-preflight-review");
    await expect(review).toBeVisible();
    await review
      .getByRole("checkbox", { name: duplicateAcknowledgement })
      .check();
    await review
      .getByRole("button", { name: duplicatePublishButton, exact: true })
      .click();
  }
  return publicationResponse;
}

test.describe("recipe edition acceptance", () => {
  test.describe.configure({ retries: 0 });

  test("edits the current recipe into a new published edition and preserves the older exact link", async ({
    page,
    sourceDrafts,
  }) => {
    test.setTimeout(120_000);
    const runId = randomUUID().slice(0, 8);
    const originalTitle = `Acceptance toasted pecan bite ${runId}`;
    const revisedTitle = `Corrected toasted pecan bite ${runId}`;

    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes/new");
    await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]{36}$/i);
    const originalDraftId = new URL(page.url()).pathname.split("/").at(-1)!;
    await completeOriginalDraft(page, originalTitle);

    await page.getByRole("button", { name: "Finish recipe", exact: true }).click();
    const originalDialog = page.getByRole("dialog", {
      name: `Ready to share your recipe?`,
    });
    await originalDialog
      .getByRole("checkbox", {
        name: /right to share this recipe.*community rules/i,
      })
      .check();
    const originalPublication = await publishPreparedDraft(
      page,
      originalDraftId,
      originalDialog.getByRole("button", {
        name: "Review and publish",
        exact: true,
      }),
      /reviewed these similar recipes.*publish my recipe anyway/i,
      "Publish recipe",
    );
    expect(originalPublication.status()).toBe(201);
    const originalPublicationBody = (await originalPublication.json()) as {
      location?: unknown;
      recipe_version_id?: unknown;
    };
    expect(originalPublicationBody.recipe_version_id).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    const originalVersionId = originalPublicationBody.recipe_version_id as string;
    expect(originalPublicationBody.location).toBe(
      `/recipes/${originalVersionId}`,
    );
    expect(originalPublication.headers().location).toBe(
      originalPublicationBody.location,
    );
    await expect(page).toHaveURL(`/recipes/${originalVersionId}`);

    const originalDetailResponse = await page.request.get(
      new URL(`/api/recipes/${originalVersionId}`, baseUrl).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(
      originalDetailResponse.status(),
      await originalDetailResponse.text(),
    ).toBe(200);
    const originalDetail = (await originalDetailResponse.json()) as {
      edition_number?: unknown;
      id?: unknown;
      is_current?: unknown;
      recipe_id?: unknown;
      relation_kind?: unknown;
    };
    expect(originalDetail).toMatchObject({
      edition_number: 1,
      id: originalVersionId,
      is_current: true,
      relation_kind: "original",
    });
    expect(originalDetail.recipe_id).toMatch(/^[0-9a-f-]{36}$/i);
    const stableRecipeId = originalDetail.recipe_id as string;

    await sourceDrafts.assertFresh("alice", originalVersionId);
    const stablePath = `/recipes/current/${stableRecipeId}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(stablePath);
    await expect(
      page.getByRole("heading", { name: originalTitle, level: 1 }),
    ).toBeVisible();
    const edit = page.getByRole("button", {
      name: "Edit recipe",
      exact: true,
    });
    await expect(edit).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Make your own version",
        exact: true,
      }),
    ).toHaveCount(0);

    const creationRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/recipe-drafts",
    );
    const creationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/recipe-drafts",
    );
    await activateWithKeyboard(edit);
    expect((await creationRequest).postDataJSON()).toEqual({
      draft_kind: "revision",
      source_version_id: originalVersionId,
    });
    const created = await creationResponse;
    expect(created.status(), await created.text()).toBe(201);
    const revisionDraft = (await created.json()) as {
      draft_kind?: unknown;
      id?: unknown;
      revision?: unknown;
      source_version_id?: unknown;
      title?: unknown;
    };
    expect(revisionDraft).toMatchObject({
      draft_kind: "revision",
      revision: 1,
      source_version_id: originalVersionId,
      title: originalTitle,
    });
    expect(revisionDraft.id).toMatch(/^[0-9a-f-]{36}$/i);
    const revisionDraftId = revisionDraft.id as string;
    await expect(page).toHaveURL(stablePath);
    const title = page.getByLabel("Title", { exact: true });
    await expect(title).toHaveValue(originalTitle);
    await expect(title).toBeFocused();

    await title.fill(revisedTitle);
    const saveRequest = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname ===
          `/api/recipe-drafts/${revisionDraftId}`,
    );
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname ===
          `/api/recipe-drafts/${revisionDraftId}`,
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const savePayload = (await saveRequest).postDataJSON() as {
      revision?: unknown;
      title?: unknown;
    };
    expect(savePayload).toMatchObject({ revision: 1, title: revisedTitle });
    const saved = await saveResponse;
    expect(saved.status(), await saved.text()).toBe(200);
    expect(await saved.json()).toMatchObject({
      draft_kind: "revision",
      id: revisionDraftId,
      revision: 2,
      source_version_id: originalVersionId,
      title: revisedTitle,
    });
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);

    await page
      .getByRole("button", { name: "Publish changes", exact: true })
      .click();
    const revisionDialog = page.getByRole("dialog", {
      name: "Ready to publish your changes?",
    });
    const reason = revisionDialog.getByRole("group", {
      name: "Why are you publishing changes? (optional)",
    });
    await reason
      .getByRole("radio", { name: "I’m correcting a mistake" })
      .check();
    const withdraw = revisionDialog.getByRole("checkbox", {
      name: /Withdraw the previous edition when these changes publish/i,
    });
    await expect(withdraw).not.toBeChecked();
    await revisionDialog
      .getByRole("checkbox", {
        name: /right to share this recipe.*community rules/i,
      })
      .check();

    const revisionPublicationRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          `/api/recipe-drafts/${revisionDraftId}/publish`,
    );
    const revisionPublication = await publishPreparedDraft(
      page,
      revisionDraftId,
      revisionDialog.getByRole("button", {
        name: "Review and publish changes",
        exact: true,
      }),
      /reviewed these similar recipes.*publish my changes anyway/i,
      "Publish changes",
    );
    const revisionPublicationPayload = (
      await revisionPublicationRequest
    ).postDataJSON() as {
      declared_change_reason?: unknown;
      revision?: unknown;
      withdraw_predecessor?: unknown;
    };
    expect(revisionPublicationPayload).toMatchObject({
      declared_change_reason: "correction",
      revision: 2,
      withdraw_predecessor: false,
    });
    expect(revisionPublication.status()).toBe(201);
    const revisionPublicationBody = (await revisionPublication.json()) as {
      location?: unknown;
      recipe_version_id?: unknown;
    };
    expect(revisionPublicationBody.recipe_version_id).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    const revisedVersionId = revisionPublicationBody.recipe_version_id as string;
    expect(revisedVersionId).not.toBe(originalVersionId);
    expect(revisionPublicationBody.location).toBe(
      `/recipes/${revisedVersionId}`,
    );
    expect(revisionPublication.headers().location).toBe(
      revisionPublicationBody.location,
    );
    await expect(page).toHaveURL(`/recipes/${revisedVersionId}`);
    await expect(
      page.getByRole("heading", { name: revisedTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Recipe version notice" }),
    ).toHaveCount(0);

    const revisedDetailResponse = await page.request.get(
      new URL(`/api/recipes/${revisedVersionId}`, baseUrl).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(
      revisedDetailResponse.status(),
      await revisedDetailResponse.text(),
    ).toBe(200);
    expect(await revisedDetailResponse.json()).toMatchObject({
      declared_change_reason: "correction",
      edition_number: 2,
      id: revisedVersionId,
      is_current: true,
      previous_version_id: originalVersionId,
      recipe_id: stableRecipeId,
      relation_kind: "revision",
    });

    await page.goto(`/recipes/${originalVersionId}`);
    const versionNotice = page.getByRole("complementary", {
      name: "Recipe version notice",
    });
    await expect(versionNotice).toContainText(
      "You’re viewing an older published version of this recipe.",
    );
    const viewCurrent = versionNotice.getByRole("link", {
      name: "View the current version",
      exact: true,
    });
    await expect(viewCurrent).toHaveAttribute("href", stablePath);
    await expect(
      page.getByRole("button", {
        name: "Make your own version",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit recipe", exact: true }),
    ).toHaveCount(0);

    await page.getByRole("tab", { name: "Family", exact: true }).click();
    const history = page.getByRole("region", { name: "Recipe history" });
    const revisedSelector = history.getByRole("button", {
      name: `Show ${revisedTitle} in recipe history`,
      exact: true,
    });
    await activateWithKeyboard(revisedSelector);
    await expect(
      history.getByRole("heading", { name: "Recipe history", level: 2 }),
    ).toBeFocused();
    const selectedRevision = history.getByRole("article", {
      name: `Selected published recipe: ${revisedTitle}`,
      exact: true,
    });
    await expect(selectedRevision).toContainText("Published version 2");
    await expect(selectedRevision).toContainText(
      "Author marked this version as a correction.",
    );
    await expect(
      selectedRevision.getByRole("link", {
        name: `Compare with ${originalTitle} →`,
        exact: true,
      }),
    ).toHaveAttribute(
      "href",
      `/recipes/${revisedVersionId}/compare?base_version_id=${originalVersionId}`,
    );
    await expectNoHorizontalOverflow(page);
    await expectNoAccessibilityViolations(page);

    await activateWithKeyboard(viewCurrent);
    await expect(page).toHaveURL(stablePath);
    await expect(
      page.getByRole("heading", { name: revisedTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Recipe version notice" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Edit recipe", exact: true }),
    ).toBeVisible();
  });
});
