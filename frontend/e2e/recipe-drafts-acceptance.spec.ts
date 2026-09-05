import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

const acceptanceEnabled =
  process.env.MVP_ACCEPTANCE === "1" &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

function isDraftCreationRequest(request: Request): boolean {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/api/recipe-drafts"
  );
}

async function activeDraftIds(page: Page): Promise<Set<string>> {
  const response = await page.request.get(
    new URL("/api/recipe-drafts?page=1&page_size=100", baseUrl).toString(),
    { headers: { Accept: "application/json" } },
  );
  expect(response.status(), await response.text()).toBe(200);
  const payload = (await response.json()) as {
    items?: Array<{ id?: unknown }>;
  };
  expect(Array.isArray(payload.items)).toBe(true);
  return new Set(
    payload.items?.map((item) => {
      expect(item.id).toMatch(/^[0-9a-f-]{36}$/i);
      return String(item.id);
    }) ?? [],
  );
}

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

  test("creates, protects, resumes, and discards an incomplete private draft", async ({
    page,
  }) => {
    const alice = await useAcceptanceMember(page, "alice");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/account/recipe-drafts");
    await expect(page).toHaveURL("/account/recipes?view=drafts");
    await expect(
      page.getByRole("link", { name: "Drafts", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const startOriginal = page
      .getByRole("link", { name: "Start a new recipe", exact: true })
      .first();
    await startOriginal.focus();
    await expect(startOriginal).toBeFocused();
    const creationRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/recipe-drafts",
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
    const creationKey = (await creationRequest).headers()["idempotency-key"];
    expect(creationKey).toMatch(/^[0-9a-f-]{36}$/i);
    const draftId = new URL(page.url()).pathname.split("/").at(-1);
    expect(draftId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);

    await page.getByLabel("Title").fill("Acceptance pantry soup");
    await dismissUnsavedChangesDialog(page, () =>
      page.getByRole("link", { name: "Explore recipes" }).click(),
    );
    await expect(page.getByLabel("Title")).toHaveValue(
      "Acceptance pantry soup",
    );

    await dismissUnsavedChangesDialog(page, () =>
      page.evaluate(() => window.history.back()),
    );
    await expect(page.getByLabel("Title")).toHaveValue(
      "Acceptance pantry soup",
    );

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel("Title")).toHaveValue(
      "Acceptance pantry soup",
    );

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
    await expect(
      page.getByRole("link", { name: "Sign in in a new tab" }),
    ).toHaveAttribute("target", "_blank");
    await expect(page.getByLabel("Title")).toHaveValue(
      "Acceptance interrupted soup",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    const interruptedAccessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(interruptedAccessibility.violations).toEqual([]);

    await page.getByRole("button", { name: "Keep editing for now" }).click();
    await expect(
      page.getByText(/Sign-in is still required before saving/),
    ).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue(
      "Acceptance interrupted soup",
    );
    await page.getByRole("button", { name: "Resume sign-in" }).click();
    await useAcceptanceMember(page, "alice");
    await page.getByRole("button", { name: "Check sign-in" }).click();
    await expect(interruption).toHaveCount(0);
    await expect(page.getByLabel("Title")).toHaveValue(
      "Acceptance interrupted soup",
    );

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel("Title")).toHaveValue(
      "Acceptance interrupted soup",
    );

    await useAcceptanceMember(page, "bob");
    const crossOwner = await page.request.get(
      new URL(`/api/recipe-drafts/${draftId}`, baseUrl).toString(),
      { headers: { Accept: "application/json" } },
    );
    expect(crossOwner.status()).toBe(404);
    expect(await crossOwner.json()).toMatchObject({
      error: { code: "recipe_draft_not_found" },
    });

    await useAcceptanceMember(page, "alice");
    await page.goto(`/recipes/drafts/${draftId}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("Title")).toHaveValue(
      "Acceptance interrupted soup",
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);

    await page.getByRole("link", { name: "Return" }).click();
    await expect(page).toHaveURL("/account/recipes?view=drafts");
    const savedDraft = page.getByRole("article", {
      name: "Acceptance interrupted soup",
    });
    await savedDraft.getByRole("button", { name: "Discard" }).click();
    const discardConfirmation = savedDraft.getByRole("group", {
      name: "Discard Acceptance interrupted soup",
      exact: true,
    });
    await expect(
      discardConfirmation.getByText(
        "This permanently deletes this private draft. It cannot be restored.",
        { exact: true },
      ),
    ).toBeVisible();
    await discardConfirmation
      .getByRole("button", { name: "Discard permanently", exact: true })
      .click();
    await expect(page).toHaveURL("/account/recipes?view=drafts");
    await expect(page.getByText("Acceptance interrupted soup")).toHaveCount(0);

    const discardedReplay = await page.request.post(
      new URL("/api/recipe-drafts", baseUrl).toString(),
      {
        data: { source_version_id: null },
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": creationKey!,
          Origin: baseUrl,
          "X-CSRF-Token": alice.csrf_token,
        },
      },
    );
    expect(discardedReplay.status()).toBe(409);
    expect(await discardedReplay.json()).toMatchObject({
      error: { code: "idempotency_key_conflict" },
    });

    const terminalStorageKey =
      `recipe-lab:draft-creation-attempt:v1:${encodeURIComponent(alice.user_id)}:` +
      encodeURIComponent("blank");
    await page.evaluate(
      ({ actorId, key, storageKey }) => {
        window.sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            actor_id: actorId,
            idempotency_key: key,
            intent: "blank",
            version: 1,
          }),
        );
      },
      {
        actorId: alice.user_id,
        key: creationKey!,
        storageKey: terminalStorageKey,
      },
    );
    const replacementAttempts: string[] = [];
    const recordReplacement = (request: Request) => {
      if (isDraftCreationRequest(request)) {
        replacementAttempts.push(request.headers()["idempotency-key"] ?? "");
      }
    };
    page.on("request", recordReplacement);
    await page.goto("/recipes/new");
    await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
    page.off("request", recordReplacement);
    expect(replacementAttempts).toHaveLength(2);
    expect(replacementAttempts[0]).toBe(creationKey);
    expect(replacementAttempts[1]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(replacementAttempts[1]).not.toBe(creationKey);
  });

  test("rapid activation creates one bound private draft", async ({ page }) => {
    await useAcceptanceMember(page, "alice");
    await page.goto("/account/recipes?view=drafts");
    const before = await activeDraftIds(page);
    const attempts: Array<{ body: unknown; key: string | undefined }> = [];
    const recordAttempt = (request: Request) => {
      if (!isDraftCreationRequest(request)) return;
      attempts.push({
        body: request.postDataJSON(),
        key: request.headers()["idempotency-key"],
      });
    };
    page.on("request", recordAttempt);

    const startOriginal = page
      .getByRole("link", { name: "Start a new recipe", exact: true })
      .first();
    await startOriginal.evaluate((link) => {
      (link as HTMLElement).click();
      (link as HTMLElement).click();
    });

    await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
    page.off("request", recordAttempt);
    const draftId = new URL(page.url()).pathname.split("/").at(-1)!;
    expect(attempts.length).toBeGreaterThan(0);
    expect(new Set(attempts.map((attempt) => attempt.key))).toEqual(
      new Set([attempts[0]?.key]),
    );
    expect(attempts[0]?.key).toMatch(/^[0-9a-f-]{36}$/i);
    for (const attempt of attempts) {
      expect(attempt.body).toEqual({ source_version_id: null });
    }

    const after = await activeDraftIds(page);
    const createdIds = [...after].filter((id) => !before.has(id));
    expect(createdIds).toEqual([draftId]);
  });

  test("recovers a lost creation response after a route remount", async ({
    page,
  }) => {
    await useAcceptanceMember(page, "alice");
    const attempts: Array<{ body: unknown; key: string | undefined }> = [];
    let lostDraftId = "";
    let releaseFirstRequest!: () => void;
    let markFirstRequestSeen!: () => void;
    const firstRequestReleased = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    const firstRequestSeen = new Promise<void>((resolve) => {
      markFirstRequestSeen = resolve;
    });

    await page.route("**/api/recipe-drafts", async (route) => {
      const request = route.request();
      if (!isDraftCreationRequest(request)) {
        await route.continue();
        return;
      }
      attempts.push({
        body: request.postDataJSON(),
        key: request.headers()["idempotency-key"],
      });
      if (attempts.length === 1) {
        markFirstRequestSeen();
        await firstRequestReleased;
        const upstream = await route.fetch();
        const created = (await upstream.json()) as { id?: unknown };
        expect(upstream.status(), JSON.stringify(created)).toBe(201);
        expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
        lostDraftId = String(created.id);
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/recipes/new");
    await firstRequestSeen;
    await expect(
      page.getByRole("main").getByRole("status"),
    ).toHaveText("Preparing a private workspace for your new recipe.");
    await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "true");
    await expect(
      page.getByRole("button", { name: /create private draft|start writing/i }),
    ).toHaveCount(0);
    releaseFirstRequest();

    await expect(
      page.getByRole("heading", {
        name: "We couldn’t open your private draft",
        level: 1,
      }),
    ).toBeVisible();
    const retry = page.getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeFocused();
    await page.reload();
    await expect(page).toHaveURL(`/recipes/drafts/${lostDraftId}`);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(attempts[1]).toEqual(attempts[0]);
  });

  test("keeps authentication recovery in the same tab and reuses the creation action", async ({
    page,
  }) => {
    await useAcceptanceMember(page, "alice");
    const attempts: Array<{ body: unknown; key: string | undefined }> = [];

    await page.route("**/api/recipe-drafts", async (route) => {
      const request = route.request();
      if (!isDraftCreationRequest(request)) {
        await route.continue();
        return;
      }
      attempts.push({
        body: request.postDataJSON(),
        key: request.headers()["idempotency-key"],
      });
      if (attempts.length === 1) {
        await route.fulfill({
          body: JSON.stringify({
            error: {
              code: "authentication_required",
              issues: [],
              message: "This hostile backend message must not be shown.",
            },
          }),
          contentType: "application/json",
          status: 401,
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/recipes/new");
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "Your session expired. Sign in again, then try again to recover the same private draft.",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("This hostile backend message must not be shown."),
    ).toHaveCount(0);

    await page.context().clearCookies({ name: "recipe_lab_session" });
    const continueSignIn = page.getByRole("link", {
      name: "Continue to sign in",
      exact: true,
    });
    await expect(continueSignIn).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Frecipes%2Fnew",
    );
    expect(
      await continueSignIn.evaluate((link) => link.hasAttribute("target")),
    ).toBe(false);
    expect(page.context().pages()).toHaveLength(1);
    const anonymousSessionCheck = page.waitForResponse((response) => {
      const request = response.request();
      return (
        request.method() === "GET" &&
        new URL(response.url()).pathname === "/api/auth/session"
      );
    });
    await continueSignIn.click();
    await expect(page).toHaveURL("/sign-in?return_to=%2Frecipes%2Fnew");
    const anonymousSessionResponse = await anonymousSessionCheck;
    expect(anonymousSessionResponse.status()).toBe(200);
    await expect(anonymousSessionResponse.json()).resolves.toMatchObject({
      status: "anonymous",
    });
    expect(page.context().pages()).toHaveLength(1);
    const persistedKeys = await page.evaluate(() =>
      Object.entries(window.sessionStorage)
        .filter(([key]) =>
          key.startsWith("recipe-lab:draft-creation-attempt:v1:"),
        )
        .map(([, value]) => {
          const parsed = JSON.parse(value) as { idempotency_key?: unknown };
          return parsed.idempotency_key;
        }),
    );
    expect(persistedKeys).toContain(attempts[0]?.key);

    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes/new");
    await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(attempts[1]).toEqual(attempts[0]);
  });
});
