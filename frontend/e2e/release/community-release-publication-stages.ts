import { expect } from "@playwright/test";

import {
  createAndOnboardRcp32Identity,
  readRcp32Session,
} from "./community-release-oidc";
import {
  grantCatalogCurator,
  revokeCatalogCurator,
} from "./community-release-operator";
import {
  activateWithKeyboard,
  authenticatedMutationHeaders,
  baseUrl,
  childDirection,
  childTitle,
  curatorDecisionReasonCanary,
  curatorProvenanceCanary,
  exactTitle,
  expectNoAccessibilityViolations,
  expectPublicPayloadSafe,
  jsonRecord,
  publishDistinctOriginal,
  publishReviewedFork,
  requestContextCanary,
  requestedIngredient,
  requireUuid,
  rootDescription,
  rootDirection,
  rootTitle,
  viewerStateFromRecipe,
  type CommunityReleaseJourney,
} from "./community-release-gate-support";

export async function onboardCommunityMembers(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { alice, bob, curator, moderator } = journey;
  const aliceSession = await createAndOnboardRcp32Identity(
    alice,
    "alice",
  );
  const bobSession = await createAndOnboardRcp32Identity(bob, "bob");
  const curatorSession = await createAndOnboardRcp32Identity(
    curator,
    "curator",
  );
  const moderatorSession = await createAndOnboardRcp32Identity(
    moderator,
    "moderator",
  );
  journey.aliceUserId = aliceSession.user.id;
  journey.bobUserId = bobSession.user.id;
  journey.curatorUserId = curatorSession.user.id;
  journey.moderatorUserId = moderatorSession.user.id;
  expect(
    new Set([journey.aliceUserId, journey.bobUserId, journey.curatorUserId, journey.moderatorUserId])
      .size,
  ).toBe(4);
  for (const session of [
    aliceSession,
    bobSession,
    curatorSession,
    moderatorSession,
  ]) {
    expect(session.capabilities.review_ingredient_requests).toBe(false);
    expect(session.capabilities.moderate_recipe_reports).toBe(false);
  }

  for (const page of [alice, bob]) {
    const forbiddenQueue = await page.request.get(
      "/api/ingredient-requests?status=pending&page=1&page_size=20",
    );
    expect(forbiddenQueue.status()).toBe(403);
    await page.goto("/catalog/ingredient-requests");
    await expect(
      page.getByRole("heading", {
        name: "We couldn’t find that page.",
        level: 1,
      }),
    ).toBeVisible();
  }
}

export async function requestMissingIngredient(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { alice, bob } = journey;
  await alice.goto("/recipes/new");
  await expect(alice).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
  journey.aliceDraftId = requireUuid(
    new URL(alice.url()).pathname.split("/").at(-1),
    "Alice draft ID",
  );
  await alice.getByLabel("Title", { exact: true }).fill(rootTitle);
  await alice
    .getByLabel("Description", { exact: true })
    .fill(rootDescription);
  await alice.getByLabel("Makes", { exact: true }).fill("4");
  await alice
    .getByRole("button", { name: "Add ingredient", exact: true })
    .click();
  const ingredient = alice.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  await ingredient
    .getByRole("button", {
      name: "Edit amount for ingredient 1",
      exact: true,
    })
    .click();
  const amountEditor = ingredient.getByRole("dialog", {
    name: "Amount for ingredient 1",
    exact: true,
  });
  await amountEditor
    .getByRole("textbox", { name: "Amount", exact: true })
    .fill("100");
  const unit = amountEditor.getByRole("combobox", {
    name: "Unit",
    exact: true,
  });
  await unit.selectOption({ label: "gram (g)" });
  journey.gramUnitId = await unit.inputValue();
  await amountEditor
    .getByRole("button", { name: "Done", exact: true })
    .click();
  const search = ingredient.getByRole("combobox", {
    name: "Ingredient",
    exact: true,
  });
  await search.focus();
  await search.fill(requestedIngredient);
  const requestButton = ingredient.getByRole("button", {
    name: "Request missing ingredient",
    exact: true,
  });
  await activateWithKeyboard(requestButton);
  const requestDialog = alice.getByRole("dialog", {
    name: "Request a missing ingredient",
    exact: true,
  });
  await expect(
    requestDialog.getByLabel("Proposed ingredient name"),
  ).toBeFocused();
  await requestDialog
    .getByLabel("Short context (optional)")
    .fill(requestContextCanary);
  const submitted = alice.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/ingredient-requests",
  );
  await requestDialog
    .getByRole("button", { name: "Submit catalog request" })
    .click();
  const submission = await submitted;
  expect(submission.status()).toBe(201);
  journey.ingredientRequestId = requireUuid(
    (await jsonRecord(submission)).id,
    "ingredient request ID",
  );
  await expect(search).toHaveValue(requestedIngredient);
  await expect(ingredient.getByRole("status")).toContainText(
    "Pending review",
  );
  await expect(alice.getByLabel("Title", { exact: true })).toHaveValue(
    rootTitle,
  );
  await expect(
    alice.getByLabel("Description", { exact: true }),
  ).toHaveValue(rootDescription);
  await expect(alice.getByLabel("Makes", { exact: true })).toHaveValue(
    "4",
  );
  await alice
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  await expect(
    alice.getByRole("button", { name: "Draft saved", exact: true }),
  ).toBeDisabled();
  await alice.reload();
  await expect(alice.getByLabel("Title", { exact: true })).toHaveValue(
    rootTitle,
  );
  await expect(
    alice.getByLabel("Description", { exact: true }),
  ).toHaveValue(rootDescription);
  await expect(alice.getByLabel("Makes", { exact: true })).toHaveValue(
    "4",
  );
  const persistedPendingIngredient = alice.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  const persistedSearch = persistedPendingIngredient.getByRole(
    "combobox",
    {
      name: "Ingredient",
      exact: true,
    },
  );
  await expect(persistedSearch).toHaveValue(requestedIngredient);
  await expect(
    persistedPendingIngredient.getByRole("status"),
  ).toContainText("Pending review");
  await persistedSearch.focus();
  await expect(
    persistedPendingIngredient.getByRole("region", {
      name: "Pending ingredient requests",
    }),
  ).toContainText(
    `${requestedIngredient}Pending review · not available yet`,
  );
  await expect(
    persistedPendingIngredient.getByRole("button", {
      name: "Request missing ingredient",
      exact: true,
    }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(alice);

  const bobCannotReadDraft = await bob.request.get(
    `/api/recipe-drafts/${journey.aliceDraftId}`,
  );
  expect(bobCannotReadDraft.status()).toBe(404);
  for (const page of [alice, bob]) {
    const forbiddenQueue = await page.request.get(
      "/api/ingredient-requests?status=pending&page=1&page_size=20",
    );
    expect(forbiddenQueue.status()).toBe(403);
  }
}

export async function approveMissingIngredient(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { curator } = journey;
  await grantCatalogCurator(journey.curatorUserId);
  const granted = await readRcp32Session(curator);
  expect(granted.capabilities.review_ingredient_requests).toBe(true);
  expect(granted.capabilities.moderate_recipe_reports).toBe(false);
  await curator.goto("/");
  await curator.getByLabel("Account menu for Casey Curator").click();
  await curator.getByRole("link", { name: "Staff tools" }).click();
  await curator
    .getByRole("link", { name: "Open ingredient catalog" })
    .click();
  await expect(
    curator.getByRole("heading", {
      name: "Ingredient requests",
      level: 1,
    }),
  ).toBeVisible();
  const requestItem = curator.getByRole("button").filter({
    has: curator.getByText(requestedIngredient, { exact: true }),
  });
  await activateWithKeyboard(requestItem);
  const requestHeading = curator.getByRole("heading", {
    name: requestedIngredient,
    level: 2,
  });
  await expect(requestItem).toHaveAttribute("aria-pressed", "true");
  await expect(requestHeading).toBeVisible();
  await curator
    .getByLabel("Canonical ingredient name")
    .fill(requestedIngredient);
  await curator
    .getByLabel("Decision reason")
    .fill(curatorDecisionReasonCanary);
  await curator
    .getByLabel("Approval provenance")
    .fill(curatorProvenanceCanary);
  const reviewed = curator.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(
          `/api/ingredient-requests/${journey.ingredientRequestId}/review`,
        ),
  );
  await curator
    .getByRole("button", { name: "Approve request" })
    .click();
  const reviewResponse = await reviewed;
  expect(reviewResponse.status()).toBe(200);
  journey.approvedIngredientId = requireUuid(
    (await jsonRecord(reviewResponse)).resolved_ingredient_id,
    "approved ingredient ID",
  );
  await expect(
    curator.getByText(`${requestedIngredient} is now approved.`, {
      exact: true,
    }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(curator);

  await revokeCatalogCurator(journey.curatorUserId);
  const revoked = await readRcp32Session(curator);
  expect(revoked.capabilities.review_ingredient_requests).toBe(false);
  expect(revoked.capabilities.moderate_recipe_reports).toBe(false);
  expect(
    (
      await curator.request.get(
        "/api/ingredient-requests?status=pending&page=1&page_size=20",
      )
    ).status(),
  ).toBe(403);
}

export async function publishRootRecipe(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { alice } = journey;
  await alice.reload();
  const ingredient = alice.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  const search = ingredient.getByRole("combobox", {
    name: "Ingredient",
    exact: true,
  });
  await expect(search).toHaveValue(requestedIngredient);
  const useResolution = ingredient
    .getByRole("listbox", { name: "Ingredient suggestions" })
    .getByRole("option", {
      name: `${requestedIngredient} Approved from your ingredient request`,
      exact: true,
    });
  await search.press("ArrowDown");
  await expect(useResolution).toBeVisible();
  const resolutionId = await useResolution.getAttribute("id");
  expect(resolutionId).not.toBeNull();
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    resolutionId!,
  );
  await search.press("Enter");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue(requestedIngredient);
  await expect(
    ingredient.getByText("Selected ingredient", { exact: true }),
  ).toHaveCount(0);
  await expect(
    ingredient.getByRole("button", {
      name: "Request missing ingredient",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(alice.getByLabel("Title", { exact: true })).toHaveValue(
    rootTitle,
  );
  await expect(
    alice.getByLabel("Description", { exact: true }),
  ).toHaveValue(rootDescription);
  await expect(alice.getByLabel("Makes", { exact: true })).toHaveValue(
    "4",
  );

  await ingredient
    .getByRole("button", {
      name: "Edit amount for ingredient 1",
      exact: true,
    })
    .click();
  const amount = ingredient.getByRole("dialog", {
    name: "Amount for ingredient 1",
    exact: true,
  });
  await expect(
    amount.getByRole("textbox", { name: "Amount", exact: true }),
  ).toHaveValue("100");
  await expect(
    amount.getByRole("combobox", { name: "Unit", exact: true }),
  ).toHaveValue(journey.gramUnitId);
  await amount.getByRole("button", { name: "Done", exact: true }).click();

  await alice
    .getByRole("button", { name: "Add instruction", exact: true })
    .click();
  const step = alice.getByRole("group", { name: "Step 1", exact: true });
  await step
    .getByLabel("Instruction", { exact: true })
    .fill(rootDirection);
  await alice
    .getByRole("tab", { name: "Cooking breakdown", exact: true })
    .click();
  await alice
    .getByRole("button", {
      name: "Add cooking detail to Step 1",
      exact: true,
    })
    .click();
  const action = alice.getByRole("dialog", {
    name: "Cooking detail 1 for Step 1",
    exact: true,
  });
  await action
    .getByRole("combobox", { name: "Cooking action" })
    .selectOption({
      label: "knead",
    });
  await action
    .getByRole("group", { name: "Ingredient inputs", exact: true })
    .getByRole("checkbox", {
      name: `Ingredient 1: ${requestedIngredient}`,
    })
    .check();
  await action
    .getByRole("checkbox", { name: "Include duration" })
    .check();
  const duration = action.getByRole("group", {
    name: /Duration for Cooking detail 1: knead/i,
  });
  await duration
    .getByRole("radio", { name: "Exact", exact: true })
    .check();
  await duration.getByRole("textbox", { name: "Duration" }).fill("10");
  await duration.getByRole("combobox", { name: "Unit" }).selectOption({
    label: "minute (min)",
  });
  await action.getByRole("button", { name: "Done", exact: true }).click();

  await alice
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  await expect(
    alice.getByRole("button", { name: "Draft saved", exact: true }),
  ).toBeDisabled();
  await alice.reload();
  await expect(alice.getByLabel("Title", { exact: true })).toHaveValue(
    rootTitle,
  );
  await expect(
    alice.getByLabel("Description", { exact: true }),
  ).toHaveValue(rootDescription);
  await expect(alice.getByLabel("Makes", { exact: true })).toHaveValue(
    "4",
  );
  const persistedIngredient = alice
    .getByRole("group", { name: "Ingredient 1", exact: true })
    .getByRole("combobox", { name: "Ingredient", exact: true });
  await expect(persistedIngredient).toBeVisible();
  await expect(persistedIngredient).toHaveValue(requestedIngredient);
  await expect(
    alice
      .getByRole("group", { name: "Step 1", exact: true })
      .getByLabel("Instruction"),
  ).toHaveValue(rootDirection);
  await expectNoAccessibilityViolations(alice);

  journey.rootRecipeVersionId = await publishDistinctOriginal(
    alice,
    journey.aliceDraftId,
  );
  await expect(
    alice.getByRole("heading", { name: rootTitle, level: 1 }),
  ).toBeVisible();
  await expect(alice.getByText("Version 1", { exact: true })).toHaveCount(
    0,
  );
  await expect(alice.getByText("Based on", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    alice.getByRole("link", { name: "Alice Cook", exact: true }).first(),
  ).toHaveAttribute("href", "/cooks/rcp32_alice");
  expect(
    (
      await alice.request.get(`/api/recipe-drafts/${journey.aliceDraftId}`)
    ).status(),
  ).toBe(404);
}

export async function interactWithRootRecipe(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { alice, bob } = journey;
  await bob.goto(`/recipes?q=${encodeURIComponent(rootTitle)}`);
  const rootCard = bob.getByRole("article", {
    name: rootTitle,
    exact: true,
  });
  await expect(rootCard).toBeVisible();
  const viewResponse = bob.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/recipes/${journey.rootRecipeVersionId}/view`),
  );
  await Promise.all([
    bob.waitForURL("/recipes/" + journey.rootRecipeVersionId),
    rootCard
      .getByRole("link", { name: rootTitle, exact: true })
      .click(),
  ]);
  await expect(
    bob.getByRole("heading", { name: rootTitle, level: 1 }),
  ).toBeVisible();
  expect((await viewResponse).status()).toBe(204);

  const saveResponse = bob.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith(`/api/recipes/${journey.rootRecipeVersionId}/save`),
  );
  await bob
    .getByRole("button", { name: "Save recipe", exact: true })
    .click();
  expect((await saveResponse).status()).toBe(200);
  await expect(
    bob.getByText("Saved to your account.", { exact: true }),
  ).toBeVisible();

  const ratingResponse = bob.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response
        .url()
        .endsWith(`/api/recipes/${journey.rootRecipeVersionId}/rating`),
  );
  await bob
    .getByRole("button", { name: "Rate recipe", exact: true })
    .click();
  await bob
    .getByRole("button", { name: "4 stars — Really good", exact: true })
    .click();
  expect((await ratingResponse).status()).toBe(200);
  await expect(
    bob.getByText("✓ Rated 4 stars", { exact: true }),
  ).toBeVisible();

  const idempotentHeaders = {
    ...(await authenticatedMutationHeaders(bob)),
    "Idempotency-Key": "32000000-0000-4000-8000-000000000101",
  };
  const firstReplayableSave = await bob.request.put(
    `/api/recipes/${journey.rootRecipeVersionId}/save`,
    { headers: idempotentHeaders },
  );
  expect(firstReplayableSave.status()).toBe(200);
  const secondReplayableSave = await bob.request.put(
    `/api/recipes/${journey.rootRecipeVersionId}/save`,
    { headers: idempotentHeaders },
  );
  expect(secondReplayableSave.status()).toBe(200);
  expect(await firstReplayableSave.json()).toEqual(
    await secondReplayableSave.json(),
  );

  const bobRoot = await bob.request.get(
    `/api/recipes/${journey.rootRecipeVersionId}`,
  );
  expect(bobRoot.status()).toBe(200);
  const bobRootPayload = await jsonRecord(bobRoot);
  journey.bobRootState = viewerStateFromRecipe(
    bobRootPayload,
    journey.rootRecipeVersionId,
  );
  expect(journey.bobRootState).toEqual({
    rating: 4,
    recipe_version_id: journey.rootRecipeVersionId,
    saved: true,
  });
  const aliceRoot = await alice.request.get(
    `/api/recipes/${journey.rootRecipeVersionId}`,
  );
  expect(aliceRoot.status()).toBe(200);
  expect(
    viewerStateFromRecipe(
      await jsonRecord(aliceRoot),
      journey.rootRecipeVersionId,
    ),
  ).toEqual({
    rating: null,
    recipe_version_id: journey.rootRecipeVersionId,
    saved: false,
  });
  await expectNoAccessibilityViolations(bob);
}

export async function publishExactFork(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { alice, bob } = journey;
  await bob.goto(`/recipes/${journey.rootRecipeVersionId}/fork`);
  await expect(bob).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
  const exactDraftId = requireUuid(
    new URL(bob.url()).pathname.split("/").at(-1),
    "exact fork draft ID",
  );
  await bob.getByLabel("Title", { exact: true }).fill(exactTitle);
  await bob
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  await expect(
    bob.getByRole("button", { name: "Draft saved", exact: true }),
  ).toBeDisabled();
  expect(
    (
      await alice.request.get(`/api/recipe-drafts/${exactDraftId}`)
    ).status(),
  ).toBe(404);
  const exactPublication = await publishReviewedFork(
    bob,
    exactDraftId,
    "exact_duplicate",
  );
  journey.exactPreflightId = exactPublication.preflightId;
  journey.exactRecipeVersionId = exactPublication.recipeVersionId;
  await expect(
    bob.getByRole("heading", { name: exactTitle, level: 1 }),
  ).toBeVisible();
  await expect(
    bob.locator(".recipe-detail__parent-context"),
  ).toContainText(`Based on ${rootTitle}`);
  await expect(
    bob
      .locator(".recipe-detail__parent-context")
      .getByRole("link", { name: rootTitle, exact: true }),
  ).toHaveAttribute("href", `/recipes/${journey.rootRecipeVersionId}`);
}

export async function publishChangedFork(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { alice, bob } = journey;
  await bob.goto(`/recipes/${journey.rootRecipeVersionId}/fork`);
  await expect(bob).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
  journey.bobChildDraftId = requireUuid(
    new URL(bob.url()).pathname.split("/").at(-1),
    "Bob child draft ID",
  );
  await bob.getByLabel("Title", { exact: true }).fill(childTitle);
  const ingredient = bob.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  await ingredient
    .getByRole("button", {
      name: "Edit amount for ingredient 1",
      exact: true,
    })
    .click();
  const amountEditor = ingredient.getByRole("dialog", {
    name: "Amount for ingredient 1",
    exact: true,
  });
  await amountEditor
    .getByRole("textbox", { name: "Amount", exact: true })
    .fill("200");
  await amountEditor
    .getByRole("button", { name: "Done", exact: true })
    .click();
  const step = bob.getByRole("group", { name: "Step 1", exact: true });
  await step
    .getByLabel("Instruction", { exact: true })
    .fill(childDirection);
  await bob
    .getByRole("tab", { name: "Cooking breakdown", exact: true })
    .click();
  await bob
    .getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
      exact: true,
    })
    .click();
  const action = bob.getByRole("dialog", {
    name: "Cooking detail 1 for Step 1",
    exact: true,
  });
  const duration = action.getByRole("group", {
    name: /Duration for Cooking detail 1: knead/i,
  });
  await duration
    .getByRole("textbox", { name: "Duration", exact: true })
    .fill("20");
  await action.getByRole("button", { name: "Done", exact: true }).click();
  const saveRequest = bob.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      new URL(request.url()).pathname ===
        `/api/recipe-drafts/${journey.bobChildDraftId}`,
  );
  await bob
    .getByRole("button", { name: "Save draft", exact: true })
    .click();
  const savedDocument = (await saveRequest).postDataJSON() as Record<
    string,
    unknown
  >;
  await expect(
    bob.getByRole("button", { name: "Draft saved", exact: true }),
  ).toBeDisabled();
  await bob.reload();
  await expect(bob.getByLabel("Title", { exact: true })).toHaveValue(
    childTitle,
  );
  const resumedIngredient = bob.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  await resumedIngredient
    .getByRole("button", {
      name: "Edit amount for ingredient 1",
      exact: true,
    })
    .click();
  const resumedAmountEditor = resumedIngredient.getByRole("dialog", {
    name: "Amount for ingredient 1",
    exact: true,
  });
  await expect(
    resumedAmountEditor.getByRole("textbox", {
      name: "Amount",
      exact: true,
    }),
  ).toHaveValue("200");
  await resumedAmountEditor
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await bob
    .getByRole("tab", { name: "Cooking breakdown", exact: true })
    .click();
  await bob
    .getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
      exact: true,
    })
    .click();
  const resumedAction = bob.getByRole("dialog", {
    name: "Cooking detail 1 for Step 1",
    exact: true,
  });
  await expect(
    resumedAction.getByRole("textbox", {
      name: "Duration",
      exact: true,
    }),
  ).toHaveValue("20");
  await resumedAction
    .getByRole("button", { name: "Done", exact: true })
    .click();

  expect(
    (
      await alice.request.get(`/api/recipe-drafts/${journey.bobChildDraftId}`)
    ).status(),
  ).toBe(404);
  const bobDraftBeforeEdit = await bob.request.get(
    `/api/recipe-drafts/${journey.bobChildDraftId}`,
  );
  expect(bobDraftBeforeEdit.status()).toBe(200);
  const bobDraftBeforeEditPayload = await jsonRecord(bobDraftBeforeEdit);
  const bobDraftRevision = bobDraftBeforeEditPayload.revision;
  if (typeof bobDraftRevision !== "number") {
    throw new Error(
      "Bob's active draft did not expose its numeric revision.",
    );
  }
  const forbiddenEdit = await alice.request.put(
    `/api/recipe-drafts/${journey.bobChildDraftId}`,
    {
      data: {
        ...savedDocument,
        revision: bobDraftRevision,
        title: "RCP32 forbidden cross-user edit",
      },
      headers: {
        ...(await authenticatedMutationHeaders(alice)),
        "Content-Type": "application/json",
        "Idempotency-Key": "32000000-0000-4000-8000-000000000301",
      },
    },
  );
  expect(forbiddenEdit.status()).toBe(404);
  const bobDraftAfterEdit = await bob.request.get(
    `/api/recipe-drafts/${journey.bobChildDraftId}`,
  );
  expect(bobDraftAfterEdit.status()).toBe(200);
  const bobDraftAfterEditPayload = await jsonRecord(bobDraftAfterEdit);
  expect(bobDraftAfterEditPayload.title).toBe(childTitle);
  expect(bobDraftAfterEditPayload.revision).toBe(bobDraftRevision);
  const childPublication = await publishReviewedFork(
    bob,
    journey.bobChildDraftId,
    "probable_duplicate",
  );
  journey.probablePreflightId = childPublication.preflightId;
  journey.childRecipeVersionId = childPublication.recipeVersionId;
  await expect(
    bob.getByRole("heading", { name: childTitle, level: 1 }),
  ).toBeVisible();
  await expect(
    bob.getByRole("link", { name: "Bob Cook", exact: true }).first(),
  ).toHaveAttribute("href", "/cooks/rcp32_bob");
  await expect(
    bob.locator(".recipe-detail__parent-context"),
  ).toContainText(`Based on ${rootTitle}`);
  await expect(
    bob
      .locator(".recipe-detail__parent-context")
      .getByRole("link", { name: rootTitle, exact: true }),
  ).toHaveAttribute("href", `/recipes/${journey.rootRecipeVersionId}`);
  expect(
    (
      await alice.request.get(`/api/recipe-drafts/${journey.bobChildDraftId}`)
    ).status(),
  ).toBe(404);
}

export async function verifyPublicLineage(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { browser } = journey;
  const publicContext = await browser.newContext({ baseURL: baseUrl });
  const publicPage = await publicContext.newPage();
  try {
    const rootResponse = await publicPage.request.get(
      `/api/recipes/${journey.rootRecipeVersionId}`,
    );
    expect(rootResponse.status()).toBe(200);
    const rootPayload = await jsonRecord(rootResponse);
    expect(rootPayload.title).toBe(rootTitle);
    expect(rootPayload.parent_version_id).toBeNull();
    expect(rootPayload.viewer_state).toBeNull();
    expectPublicPayloadSafe(rootPayload);

    const childResponse = await publicPage.request.get(
      `/api/recipes/${journey.childRecipeVersionId}`,
    );
    expect(childResponse.status()).toBe(200);
    const childPayload = await jsonRecord(childResponse);
    expect(childPayload.title).toBe(childTitle);
    expect(childPayload.parent_version_id).toBe(journey.rootRecipeVersionId);
    expect(childPayload.viewer_state).toBeNull();
    expectPublicPayloadSafe(childPayload);

    const exactResponse = await publicPage.request.get(
      `/api/recipes/${journey.exactRecipeVersionId}`,
    );
    expect(exactResponse.status()).toBe(200);
    const exactPayload = await jsonRecord(exactResponse);
    expect(exactPayload.parent_version_id).toBe(journey.rootRecipeVersionId);
    expect(exactPayload.title).toBe(exactTitle);
    expectPublicPayloadSafe(exactPayload);

    await publicPage.goto(`/recipes/${journey.rootRecipeVersionId}`);
    await expect(
      publicPage
        .getByRole("link", { name: "Alice Cook", exact: true })
        .first(),
    ).toHaveAttribute("href", "/cooks/rcp32_alice");
    await publicPage.goto(`/recipes/${journey.childRecipeVersionId}`);
    await expect(
      publicPage
        .getByRole("link", { name: "Bob Cook", exact: true })
        .first(),
    ).toHaveAttribute("href", "/cooks/rcp32_bob");
    await publicPage
      .locator(".recipe-detail__parent-context")
      .getByRole("link", { name: rootTitle, exact: true })
      .click();
    await expect(publicPage).toHaveURL(`/recipes/${journey.rootRecipeVersionId}`);
    await publicPage.getByRole("tab", { name: "Family", exact: true }).click();
    const family = publicPage.getByRole("tabpanel", {
      name: "Family",
      exact: true,
    });
    await family
      .getByRole("button", {
        name: `Show ${childTitle} in the family tree`,
        exact: true,
      })
      .click();
    const compare = family.getByRole("link", {
      name: `Compare with ${rootTitle} →`,
      exact: true,
    });
    const comparisonPath =
      `/recipes/${journey.childRecipeVersionId}/compare?base_version_id=${journey.rootRecipeVersionId}`;
    await expect(compare).toHaveAttribute("href", comparisonPath);
    await compare.click();
    await expect(publicPage).toHaveURL(comparisonPath);
    await expect(
      publicPage.getByRole("heading", {
        name: `How ${childTitle} changed`,
        level: 1,
      }),
    ).toBeVisible();
    const summary = publicPage.getByRole("list", {
      name: "Changes at a glance",
    });
    await expect(summary).toContainText(
      `Change ${requestedIngredient} from 100 g to 200 g.`,
    );
    await expect(summary).toContainText(
      `Update step 1: ${childDirection}`,
    );
    const ingredientChange = publicPage.getByRole("article", {
      name: `Change ${requestedIngredient} from 100 g to 200 g`,
    });
    await expect(ingredientChange).toContainText("Amount changed");
    await expect(ingredientChange).toContainText("100 g");
    await expect(ingredientChange).toContainText("200 g");
    const instructionChange = publicPage.getByRole("article", {
      name: "Update step 1",
    });
    await expect(instructionChange).toContainText("Wording changed");
    await expect(instructionChange).toContainText("Timing changed");
    await expect(instructionChange).toContainText(rootDirection);
    await expect(instructionChange).toContainText(childDirection);
    await expect(instructionChange).toContainText("10 min");
    await expect(instructionChange).toContainText("20 min");
    const titleChange = publicPage.getByRole("article", {
      name: "Title",
    });
    await expect(titleChange).toContainText(rootTitle);
    await expect(titleChange).toContainText(childTitle);
    await expectNoAccessibilityViolations(publicPage);
  } finally {
    await publicContext.close();
  }
}


