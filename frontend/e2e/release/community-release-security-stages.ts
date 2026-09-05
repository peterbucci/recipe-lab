import { expect } from "@playwright/test";

import {
  captureRcp32SessionCookie,
  expectRcp32SessionRevoked,
  rcp32CsrfToken,
  readRcp32Session,
  signInExistingRcp32IdentityAfterSignOut,
} from "./community-release-oidc";
import {
  grantCommunityModerator,
  revokeCommunityModerator,
} from "./community-release-operator";
import {
  authenticatedMutationHeaders,
  baseUrl,
  childTitle,
  expectAnonymousDiscoveryExcludes,
  expectFreshAnonymousRecipeSafe,
  expectNoAccessibilityViolations,
  expectNoHorizontalOverflow,
  expectPublicPayloadSafe,
  isRecord,
  jsonRecord,
  moderatorNoteCanary,
  reportCanary,
  requireUuid,
  rootTitle,
  viewerStateFromRecipe,
  waitForPreDeletionBackup,
  writeManifest,
  type CommunityReleaseJourney,
} from "./community-release-gate-support";

export async function verifyCrossUserAuthorization(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { alice, bob } = journey;
  expect(
    (
      await alice.request.get(`/api/recipe-drafts/${journey.bobChildDraftId}`)
    ).status(),
  ).toBe(404);
  const unauthorizedWithdrawal = await alice.request.put(
    `/api/recipes/${journey.childRecipeVersionId}/visibility`,
    {
      data: { state: "author_withdrawn" },
      headers: {
        ...(await authenticatedMutationHeaders(alice)),
        "Content-Type": "application/json",
      },
    },
  );
  expect(unauthorizedWithdrawal.status()).toBe(404);
  expect(
    (await alice.request.get("/api/moderation/recipe-reports")).status(),
  ).toBe(403);
  await alice.goto("/account/recipes?view=published");
  await expect(
    alice.getByRole("article", { name: childTitle, exact: true }),
  ).toHaveCount(0);

  const aliceRecommendations = await alice.request.get(
    "/api/recommendations?limit=50",
  );
  const bobRecommendations = await bob.request.get(
    "/api/recommendations?limit=50",
  );
  expect(aliceRecommendations.status()).toBe(200);
  expect(bobRecommendations.status()).toBe(200);
  const aliceRecommendationPayload =
    await jsonRecord(aliceRecommendations);
  const bobRecommendationPayload = await jsonRecord(bobRecommendations);
  const recommendationIds = (
    payload: Record<string, unknown>,
  ): string[] =>
    Array.isArray(payload.items)
      ? payload.items.flatMap((item) =>
          isRecord(item) &&
          isRecord(item.recipe) &&
          typeof item.recipe.id === "string"
            ? [item.recipe.id]
            : [],
        )
      : [];
  expect(aliceRecommendationPayload.personalized).toBe(true);
  expect(bobRecommendationPayload.personalized).toBe(true);
  expect(recommendationIds(aliceRecommendationPayload)).toContain(
    journey.childRecipeVersionId,
  );
  expect(recommendationIds(bobRecommendationPayload)).not.toContain(
    journey.childRecipeVersionId,
  );
  expect(recommendationIds(bobRecommendationPayload)).not.toContain(
    journey.rootRecipeVersionId,
  );
  expectPublicPayloadSafe(aliceRecommendationPayload);
  expectPublicPayloadSafe(bobRecommendationPayload);
}

export async function verifyLogoutAndFreshSignIn(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { bob } = journey;
  const staleCsrf = await rcp32CsrfToken(bob);
  const signedOutSessionCookie = await captureRcp32SessionCookie(bob);
  const badCsrf = await bob.request.put(
    `/api/recipes/${journey.rootRecipeVersionId}/rating`,
    {
      data: { rating: 1 },
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": "32000000-0000-4000-8000-000000000202",
        Origin: baseUrl,
        "X-CSRF-Token": "invalid-rcp32-csrf-evidence",
      },
    },
  );
  expect(badCsrf.status()).toBe(403);
  const badOrigin = await bob.request.put(
    `/api/recipes/${journey.rootRecipeVersionId}/rating`,
    {
      data: { rating: 1 },
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": "32000000-0000-4000-8000-000000000203",
        Origin: "https://untrusted.rcp32.invalid",
        "X-CSRF-Token": staleCsrf,
      },
    },
  );
  expect(badOrigin.status()).toBe(403);
  await bob.goto(`/recipes/${journey.childRecipeVersionId}`);
  await bob.getByLabel("Account menu for Bob Cook").click();
  const signOutResponse = bob.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/auth/logout",
  );
  await bob
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  expect((await signOutResponse).status()).toBe(204);
  await expect(bob).toHaveURL("/recipes");
  await expect(
    bob
      .getByRole("banner")
      .getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(bob.getByLabel("Account menu for Bob Cook")).toHaveCount(
    0,
  );
  const anonymousSession = await bob.request.get("/api/auth/session");
  expect(anonymousSession.status()).toBe(200);
  expect(await anonymousSession.json()).toEqual({ status: "anonymous" });
  await expectRcp32SessionRevoked(bob, signedOutSessionCookie);

  await bob.goto(`/recipes/${journey.childRecipeVersionId}`);
  await expect(
    bob.getByRole("link", { name: "Make your own version", exact: true }),
  ).toBeVisible();
  await expect(
    bob.getByRole("button", { name: "Save recipe", exact: true }),
  ).toBeVisible();
  await bob
    .getByRole("button", { name: "Rate recipe", exact: true })
    .click();
  await expect(
    bob.getByRole("dialog", { name: "Sign in to rate recipes" }),
  ).toBeVisible();
  await expect(
    bob.getByRole("button", { name: "Report recipe", exact: true }),
  ).toHaveCount(0);

  const signedOutWrite = await bob.request.put(
    `/api/recipes/${journey.rootRecipeVersionId}/rating`,
    {
      data: { rating: 1 },
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": "32000000-0000-4000-8000-000000000201",
        Origin: baseUrl,
        "X-CSRF-Token": staleCsrf,
      },
    },
  );
  expect(signedOutWrite.status()).toBe(401);

  const reauthenticated = await signInExistingRcp32IdentityAfterSignOut(
    bob,
    "bob",
  );
  expect(reauthenticated.user.id).toBe(journey.bobUserId);
  const unchanged = await bob.request.get(
    `/api/recipes/${journey.rootRecipeVersionId}`,
  );
  expect(unchanged.status()).toBe(200);
  expect(
    viewerStateFromRecipe(
      await jsonRecord(unchanged),
      journey.rootRecipeVersionId,
    ),
  ).toEqual(journey.bobRootState);
}

export async function submitPrivateReport(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { browser, alice, bob, curator } = journey;
  await bob.goto(`/recipes/${journey.rootRecipeVersionId}`);
  await bob
    .getByRole("button", { name: "Report recipe", exact: true })
    .click();
  await bob
    .getByRole("radio", {
      name: "Spam or misleading content",
      exact: true,
    })
    .check();
  await bob
    .getByLabel("Additional details (optional)")
    .fill(reportCanary);
  const reportResponse = bob.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(`/api/recipes/${journey.rootRecipeVersionId}/reports`),
  );
  await bob
    .getByRole("button", { name: "Submit private report", exact: true })
    .click();
  const reportReceipt = await reportResponse;
  expect(reportReceipt.status()).toBe(201);
  journey.reportId = requireUuid(
    (await jsonRecord(reportReceipt)).id,
    "private report ID",
  );
  await expect(
    bob.getByText(
      "Report received. Thank you for helping keep Recipe Lab safe.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();

  expect(
    (await bob.request.get("/api/moderation/recipe-reports")).status(),
  ).toBe(403);
  expect(
    (await alice.request.get("/api/moderation/recipe-reports")).status(),
  ).toBe(403);
  expect(
    (
      await curator.request.get("/api/moderation/recipe-reports")
    ).status(),
  ).toBe(403);
  await curator.goto("/moderation/recipes");
  await expect(
    curator.getByRole("heading", {
      name: "We couldn’t find that page.",
      level: 1,
    }),
  ).toBeVisible();
  await expectFreshAnonymousRecipeSafe(
    browser,
    journey.rootRecipeVersionId,
    rootTitle,
  );
}

export async function moderateReportedRecipe(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { browser, alice, moderator } = journey;
  await grantCommunityModerator(journey.moderatorUserId);
  const granted = await readRcp32Session(moderator);
  expect(granted.capabilities.moderate_recipe_reports).toBe(true);
  expect(granted.capabilities.review_ingredient_requests).toBe(false);
  await moderator.goto("/");
  await moderator.getByLabel("Account menu for Morgan Moderator").click();
  await moderator.getByRole("link", { name: "Staff tools" }).click();
  await moderator
    .getByRole("link", { name: "Open recipe reports" })
    .click();
  await expect(moderator).toHaveURL("/moderation/recipes");
  await expect(
    moderator.getByRole("heading", { name: "Recipe reports", level: 1 }),
  ).toBeVisible();
  await expect(
    moderator.getByRole("heading", { name: rootTitle, level: 2 }),
  ).toBeVisible();
  await expect(
    moderator.getByText(reportCanary, { exact: true }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(moderator);

  await moderator
    .locator("summary")
    .filter({ hasText: "Private moderator note" })
    .click();
  await moderator
    .getByLabel("Private note (optional)")
    .fill(moderatorNoteCanary);
  const hideResponse = moderator.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(
          `/api/moderation/recipe-reports/${journey.rootRecipeVersionId}/actions`,
        ),
  );
  await moderator
    .getByRole("button", { name: "Hide recipe", exact: true })
    .click();
  expect((await hideResponse).status()).toBe(200);
  await expect(
    moderator.getByText(
      /Recipe hidden\. The moderation record was updated\./,
    ),
  ).toBeVisible();

  const publicContext = await browser.newContext({ baseURL: baseUrl });
  const publicPage = await publicContext.newPage();
  try {
    expect(
      (
        await publicPage.request.get(
          `/api/recipes/${journey.rootRecipeVersionId}`,
        )
      ).status(),
    ).toBe(404);
    await expectAnonymousDiscoveryExcludes(
      publicPage,
      journey.rootRecipeVersionId,
      rootTitle,
    );
    const survivingChild = await publicPage.request.get(
      `/api/recipes/${journey.childRecipeVersionId}`,
    );
    expect(survivingChild.status()).toBe(200);
    const survivingPayload = await jsonRecord(survivingChild);
    expect(survivingPayload.parent_version_id).toBe(journey.rootRecipeVersionId);
    expect(survivingPayload.parent).toBeNull();
    expectPublicPayloadSafe(survivingPayload);
    await publicPage.goto(`/recipes/${journey.childRecipeVersionId}`);
    await expect(
      publicPage.getByRole("heading", { name: childTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      publicPage.locator(".recipe-detail__parent-context").first(),
    ).toHaveText("Source unavailable");
    await expect(
      publicPage.getByText(rootTitle, { exact: true }),
    ).toHaveCount(0);
    await expect(
      publicPage.getByText(reportCanary, { exact: true }),
    ).toHaveCount(0);
    await expect(
      publicPage.getByText(moderatorNoteCanary, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await publicContext.close();
  }

  await alice.goto("/account/recipes?view=published");
  const hiddenAuthorCard = alice.getByRole("article", {
    name: rootTitle,
    exact: true,
  });
  await expect(
    hiddenAuthorCard.getByText("Original", { exact: true }),
  ).toBeVisible();
  await expect(
    hiddenAuthorCard.getByText(
      "This recipe is hidden from public view by moderation. Its visibility cannot be changed here.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    hiddenAuthorCard.getByRole("link", { name: rootTitle, exact: true }),
  ).toHaveCount(0);

  const restoreResponse = moderator.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(
          `/api/moderation/recipe-reports/${journey.rootRecipeVersionId}/actions`,
        ),
  );
  await moderator
    .getByRole("button", { name: "Restore recipe", exact: true })
    .click();
  expect((await restoreResponse).status()).toBe(200);
  await expect(
    moderator.getByText(
      /Recipe restored\. The moderation record was updated\./,
    ),
  ).toBeVisible();
  await expectFreshAnonymousRecipeSafe(
    browser,
    journey.rootRecipeVersionId,
    rootTitle,
  );

  const resolveResponse = moderator.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(
          `/api/moderation/recipe-reports/${journey.rootRecipeVersionId}/actions`,
        ),
  );
  await moderator
    .getByRole("button", { name: "Resolve case", exact: true })
    .click();
  expect((await resolveResponse).status()).toBe(200);
  await moderator
    .getByRole("button", { name: "Resolved", exact: true })
    .click();
  await expect(
    moderator.getByRole("heading", { name: rootTitle, level: 2 }),
  ).toBeVisible();
  const resolvedCaseStatus = moderator.locator(".moderation-detail__status-pill");
  await expect(resolvedCaseStatus).toBeVisible();
  await expect(resolvedCaseStatus).toHaveText("Resolved");

  await moderator.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(moderator);
  await expectNoAccessibilityViolations(moderator);
  await revokeCommunityModerator(journey.moderatorUserId);
  const revoked = await readRcp32Session(moderator);
  expect(revoked.capabilities.moderate_recipe_reports).toBe(false);
  expect(revoked.capabilities.review_ingredient_requests).toBe(false);
  expect(
    (
      await moderator.request.get("/api/moderation/recipe-reports")
    ).status(),
  ).toBe(403);
}

export async function withdrawRootRecipe(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { browser, alice } = journey;
  await alice.goto("/account/recipes?view=published");
  let rootCard = alice.getByRole("article", {
    name: rootTitle,
    exact: true,
  });
  await rootCard
    .getByRole("button", { name: `Withdraw ${rootTitle}` })
    .click();
  const withdrawalResponse = alice.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response
        .url()
        .endsWith(`/api/recipes/${journey.rootRecipeVersionId}/visibility`),
  );
  await rootCard
    .getByRole("button", { name: `Confirm withdrawal of ${rootTitle}` })
    .click();
  expect((await withdrawalResponse).status()).toBe(200);
  await expect(
    alice.locator(".member-library__content > .form-status"),
  ).toHaveText(`${rootTitle} moved to Withdrawn.`);
  await expect(rootCard).toHaveCount(0);

  await alice.goto("/account/recipes?view=withdrawn");
  rootCard = alice.getByRole("article", { name: rootTitle, exact: true });
  await expect(
    rootCard.getByText("Original", { exact: true }),
  ).toBeVisible();
  await expect(
    rootCard.getByRole("link", { name: rootTitle, exact: true }),
  ).toHaveCount(0);

  const publicContext = await browser.newContext({ baseURL: baseUrl });
  const publicPage = await publicContext.newPage();
  try {
    expect(
      (
        await publicPage.request.get(
          `/api/recipes/${journey.rootRecipeVersionId}`,
        )
      ).status(),
    ).toBe(404);
    await expectAnonymousDiscoveryExcludes(
      publicPage,
      journey.rootRecipeVersionId,
      rootTitle,
    );
    for (const retainedVersionId of [
      journey.exactRecipeVersionId,
      journey.childRecipeVersionId,
    ]) {
      const retained = await publicPage.request.get(
        `/api/recipes/${retainedVersionId}`,
      );
      expect(retained.status()).toBe(200);
      const retainedPayload = await jsonRecord(retained);
      expect(retainedPayload.parent_version_id).toBe(journey.rootRecipeVersionId);
      expect(retainedPayload.parent).toBeNull();
      expectPublicPayloadSafe(retainedPayload);
    }
    await publicPage.goto(`/recipes/${journey.childRecipeVersionId}`);
    await expect(
      publicPage.getByRole("heading", { name: childTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      publicPage.locator(".recipe-detail__parent-context").first(),
    ).toHaveText("Source unavailable");
    await expect(
      publicPage.getByText(rootTitle, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await publicContext.close();
  }
}

export async function verifyPhoneRelease(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { browser } = journey;
  const phoneContext = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 390, height: 844 },
  });
  const phone = await phoneContext.newPage();
  try {
    await phone.goto(`/recipes/${journey.childRecipeVersionId}`);
    await expect(
      phone.getByRole("heading", { name: childTitle, level: 1 }),
    ).toBeVisible();
    await expect(
      phone.locator(".recipe-detail__parent-context").first(),
    ).toHaveText("Source unavailable");
    await expectNoHorizontalOverflow(phone);
    await expectNoAccessibilityViolations(phone);
  } finally {
    await phoneContext.close();
  }
}

export async function emitRecoveryEvidence(
  journey: CommunityReleaseJourney,
): Promise<void> {
  await writeManifest({
    version: 1,
    alice_user_id: journey.aliceUserId,
    bob_user_id: journey.bobUserId,
    curator_user_id: journey.curatorUserId,
    moderator_user_id: journey.moderatorUserId,
    root_recipe_version_id: journey.rootRecipeVersionId,
    child_recipe_version_id: journey.childRecipeVersionId,
    ingredient_request_id: journey.ingredientRequestId,
    approved_ingredient_id: journey.approvedIngredientId,
    exact_preflight_id: journey.exactPreflightId,
    probable_preflight_id: journey.probablePreflightId,
    report_id: journey.reportId,
  });
  await waitForPreDeletionBackup();
}

export async function deleteBobAndVerifyTombstones(
  journey: CommunityReleaseJourney,
): Promise<void> {
  const { browser, bob } = journey;
  await bob.goto("/account/settings");
  await expect(
    bob.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await bob.getByRole("tab", { name: "Danger zone" }).click();
  await bob
    .getByRole("checkbox", { name: /account deletion is permanent/i })
    .check();
  await bob.getByLabel(/Type rcp32_bob to confirm/i).fill("rcp32_bob");
  const deletionResponse = bob.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith("/api/auth/account"),
  );
  await bob
    .getByRole("button", { name: "Permanently delete account" })
    .click();
  expect((await deletionResponse).status()).toBe(204);
  await expect(bob).toHaveURL("/account/deleted");
  await expect(
    bob.getByRole("heading", {
      name: "Your account has been deleted.",
      level: 1,
    }),
  ).toBeVisible();
  const deletedSession = await bob.request.get("/api/auth/session");
  expect(deletedSession.status()).toBe(200);
  expect(await deletedSession.json()).toEqual({ status: "anonymous" });

  const publicContext = await browser.newContext({ baseURL: baseUrl });
  const publicPage = await publicContext.newPage();
  try {
    const childResponse = await publicPage.request.get(
      `/api/recipes/${journey.childRecipeVersionId}`,
    );
    expect(childResponse.status()).toBe(200);
    const childPayload = await jsonRecord(childResponse);
    const author = childPayload.author;
    if (!isRecord(author)) {
      throw new Error(
        "The retained child lost its public author contract.",
      );
    }
    expect(author.display_name).toBe("Deleted cook");
    expect(author.handle).toBeNull();
    expect(childPayload.parent_version_id).toBe(journey.rootRecipeVersionId);
    expect(childPayload.parent).toBeNull();
    expectPublicPayloadSafe(childPayload);
    await publicPage.goto(`/recipes/${journey.childRecipeVersionId}`);
    await expect(
      publicPage.getByRole("heading", { name: childTitle, level: 1 }),
    ).toBeVisible();
    const visibleChildDetail = publicPage
      .locator("article.recipe-detail")
      .filter({
        has: publicPage.getByRole("heading", {
          name: childTitle,
          level: 1,
        }),
        visible: true,
      });
    await expect(visibleChildDetail).toHaveCount(1);
    const deletedCookAttribution = visibleChildDetail.locator(
      ".recipe-detail__author-identity",
    );
    await expect(deletedCookAttribution).toBeVisible();
    await expect(deletedCookAttribution).toContainText("Recipe by");
    await expect(deletedCookAttribution).toContainText("Deleted cook");
    await expect(
      deletedCookAttribution.getByRole("link", { name: "Deleted cook" }),
    ).toHaveCount(0);
    const unavailableParentContext = visibleChildDetail.locator(
      ".recipe-detail__parent-context",
    );
    await expect(unavailableParentContext.getByRole("link")).toHaveCount(0);
    await expect(unavailableParentContext).toHaveText("Source unavailable");
    await expect(unavailableParentContext).toBeVisible();
    await publicPage.goto("/cooks/rcp32_bob");
    await expect(
      publicPage.getByRole("heading", {
        name: "We couldn’t find that cook.",
        level: 1,
      }),
    ).toBeVisible();
    expect(
      (await publicPage.request.get("/api/cooks/rcp32_bob")).status(),
    ).toBe(404);
  } finally {
    await publicContext.close();
  }
}


