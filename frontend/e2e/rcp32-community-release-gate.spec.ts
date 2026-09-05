import { access, link, mkdir, open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

import {
  createAndOnboardRcp32Identity,
  installRcp32DeterministicUuids,
  rcp32CsrfToken,
  readRcp32Session,
  signInExistingRcp32Identity,
  type Rcp32Identity,
} from "./rcp32-oidc";
import {
  assertRcp32AcceptanceDatabase,
  grantCatalogCurator,
  grantCommunityModerator,
  revokeCatalogCurator,
  revokeCommunityModerator,
} from "./rcp32-operator";

const acceptanceEnabled =
  process.env.RCP32_ACCEPTANCE === "1" &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const rootTitle = "RCP32 Atlas Leaf Knot";
const rootDescription =
  "A deterministic community-gate recipe built around one reviewed leaf.";
const rootDirection =
  "Knead the atlas leaf into one compact knot for ten minutes.";
const exactTitle = "RCP32 Atlas Leaf Knot Exact Fork";
const childTitle = "RCP32 Double Atlas Leaf Knot";
const childDirection =
  "Knead the doubled atlas leaf into one compact knot for twenty minutes.";
const requestedIngredient = "RCP32 Atlas leaf";
const requestContextCanary = "RCP32_PRIVATE_REQUEST_CONTEXT_CANARY";
const curatorDecisionReasonCanary =
  "RCP32_PRIVATE_CURATOR_DECISION_REASON_CANARY";
const curatorProvenanceCanary = "RCP32_PRIVATE_CURATOR_PROVENANCE_CANARY";
const reportCanary = "RCP32_PRIVATE_REPORT_CANARY";
const moderatorNoteCanary = "RCP32_PRIVATE_MODERATOR_NOTE_CANARY";
const providerPrivateValues = [
  "alice@rcp32.recipe-lab.invalid",
  "bob@rcp32.recipe-lab.invalid",
  "curator@rcp32.recipe-lab.invalid",
  "moderator@rcp32.recipe-lab.invalid",
  "rcp32-alice",
  "rcp32-bob",
  "rcp32-curator",
  "rcp32-moderator",
  requestContextCanary,
  curatorDecisionReasonCanary,
  curatorProvenanceCanary,
  reportCanary,
  moderatorNoteCanary,
] as const;

interface PreflightPayload {
  acknowledgement: { preflight_id: string };
  classification: "distinct" | "exact_duplicate" | "probable_duplicate";
  same_lineage_no_change: boolean;
}

interface PublicationPayload {
  location: string;
  recipe_version_id: string;
}

interface ViewerState {
  rating: number | null;
  recipe_version_id: string;
  saved: boolean;
}

interface Rcp32Manifest {
  version: 1;
  alice_user_id: string;
  bob_user_id: string;
  curator_user_id: string;
  moderator_user_id: string;
  root_recipe_version_id: string;
  child_recipe_version_id: string;
  ingredient_request_id: string;
  approved_ingredient_id: string;
  exact_preflight_id: string;
  probable_preflight_id: string;
  report_id: string;
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error(`The RCP-32 ${label} was not a UUID.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonRecord(
  response: APIResponse | Response,
): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!isRecord(value)) {
    throw new Error(
      "An RCP-32 API response did not satisfy its object contract.",
    );
  }
  return value;
}

async function createRcp32Context(
  browser: Browser,
  identity: Rcp32Identity,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: baseUrl });
  await installRcp32DeterministicUuids(context, identity);
  return context;
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map((violation) => ({
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

async function activateWithKeyboard(
  page: Page,
  control: Locator,
  key: "Enter" | "Space" = "Enter",
): Promise<void> {
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press(key);
}

function containsPrivatePublicKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsPrivatePublicKey);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.toLowerCase();
    if (
      nested !== null &&
      (normalized.includes("email") ||
        normalized.includes("subject") ||
        normalized.includes("token") ||
        normalized.includes("session") ||
        normalized.includes("csrf"))
    ) {
      return true;
    }
    return containsPrivatePublicKey(nested);
  });
}

function expectPublicPayloadSafe(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const privateValue of providerPrivateValues) {
    expect(serialized.includes(privateValue)).toBe(false);
  }
  expect(containsPrivatePublicKey(value)).toBe(false);
}

async function expectFreshAnonymousRecipeSafe(
  browser: Browser,
  recipeVersionId: string,
  title: string,
): Promise<void> {
  const publicContext = await browser.newContext({ baseURL: baseUrl });
  const publicPage = await publicContext.newPage();
  try {
    const sessionResponse = await publicPage.request.get("/api/auth/session");
    expect(sessionResponse.status()).toBe(200);
    expect(await sessionResponse.json()).toEqual({ status: "anonymous" });
    const recipeResponse = await publicPage.request.get(
      `/api/recipes/${recipeVersionId}`,
    );
    expect(recipeResponse.status()).toBe(200);
    expectPublicPayloadSafe(await jsonRecord(recipeResponse));
    await publicPage.goto(`/recipes/${recipeVersionId}`);
    await expect(
      publicPage.getByRole("heading", { name: title, level: 1 }),
    ).toBeVisible();
    await expect(
      publicPage.getByText(reportCanary, { exact: true }),
    ).toHaveCount(0);
    await expect(
      publicPage.getByText(moderatorNoteCanary, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await publicContext.close();
  }
}

async function expectAnonymousDiscoveryExcludes(
  page: Page,
  recipeVersionId: string,
  title: string,
): Promise<void> {
  const response = await page.request.get(
    `/api/recipes?q=${encodeURIComponent(title)}&page=1&page_size=100`,
  );
  expect(response.status()).toBe(200);
  const payload = await jsonRecord(response);
  expectPublicPayloadSafe(payload);
  if (!Array.isArray(payload.items)) {
    throw new Error(
      "The RCP-32 discovery response did not contain an item list.",
    );
  }
  expect(
    payload.items.some((item) => isRecord(item) && item.id === recipeVersionId),
  ).toBe(false);

  await page.goto(`/recipes?q=${encodeURIComponent(title)}`);
  await expect(
    page.getByRole("article", { name: title, exact: true }),
  ).toHaveCount(0);
}

async function authenticatedMutationHeaders(
  page: Page,
): Promise<Record<string, string>> {
  return {
    Accept: "application/json",
    Origin: baseUrl,
    "X-CSRF-Token": await rcp32CsrfToken(page),
  };
}

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

async function publicationPayload(
  response: Response,
): Promise<PublicationPayload> {
  expect(response.status()).toBe(201);
  const body = await jsonRecord(response);
  const recipeVersionId = requireUuid(
    body.recipe_version_id,
    "published recipe version ID",
  );
  const location = body.location;
  if (location !== `/recipes/${recipeVersionId}`) {
    throw new Error(
      "The RCP-32 publication Location contract was not satisfied.",
    );
  }
  expect(response.headers().location).toBe(location);
  return { location, recipe_version_id: recipeVersionId };
}

async function publishDistinctOriginal(
  page: Page,
  draftId: string,
): Promise<string> {
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
    .getByRole("button", { name: "Review and publish", exact: true })
    .click();
  const preflight = await preflightResponse;
  expect(preflight.status()).toBe(201);
  const preflightBody = (await preflight.json()) as PreflightPayload;
  expectPublicPayloadSafe(preflightBody);
  expect(preflightBody.classification).toBe("distinct");
  expect(preflightBody.same_lineage_no_change).toBe(false);
  const published = await publicationPayload(await publishResponse);
  await expect(page).toHaveURL(published.location);
  return published.recipe_version_id;
}

async function publishReviewedFork(
  page: Page,
  draftId: string,
  classification: "exact_duplicate" | "probable_duplicate",
): Promise<{ preflightId: string; recipeVersionId: string }> {
  const preflightResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(`/api/recipe-drafts/${draftId}/duplicate-preflights`),
  );
  await confirmPublicationRequirements(page);
  await page
    .getByRole("button", { name: "Review and publish version", exact: true })
    .click();
  const preflight = await preflightResponse;
  expect(preflight.status()).toBe(201);
  const preflightBody = (await preflight.json()) as PreflightPayload;
  expectPublicPayloadSafe(preflightBody);
  expect(preflightBody.classification).toBe(classification);
  expect(preflightBody.same_lineage_no_change).toBe(
    classification === "exact_duplicate",
  );
  const preflightId = requireUuid(
    preflightBody.acknowledgement?.preflight_id,
    `${classification} preflight ID`,
  );

  const review = page.getByRole("region", {
    name:
      classification === "exact_duplicate"
        ? "This version is very close to its source"
        : "This version is similar to another public recipe",
  });
  await expect(review).toBeVisible();
  const acknowledgement = review.getByRole("checkbox", {
    name:
      classification === "exact_duplicate"
        ? /closely matches its source.*publish it separately/i
        : /reviewed these similar recipes/i,
  });
  await activateWithKeyboard(page, acknowledgement, "Space");
  await expect(acknowledgement).toBeChecked();
  const continueButton = review.getByRole("button", {
    name: "Publish version",
    exact: true,
  });
  await expect(continueButton).toBeEnabled();
  const publishResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/recipe-drafts/${draftId}/publish`),
  );
  await activateWithKeyboard(page, continueButton);
  const published = await publicationPayload(await publishResponse);
  await expect(page).toHaveURL(published.location);
  return { preflightId, recipeVersionId: published.recipe_version_id };
}

function viewerStateFromRecipe(
  value: Record<string, unknown>,
  recipeVersionId: string,
): ViewerState {
  const state = value.viewer_state;
  if (
    !isRecord(state) ||
    state.recipe_version_id !== recipeVersionId ||
    typeof state.saved !== "boolean" ||
    (state.rating !== null && typeof state.rating !== "number")
  ) {
    throw new Error("The RCP-32 viewer-state contract was not satisfied.");
  }
  return {
    rating: state.rating as number | null,
    recipe_version_id: recipeVersionId,
    saved: state.saved,
  };
}

async function writeManifest(manifest: Rcp32Manifest): Promise<void> {
  const configuredPath = process.env.RCP32_MANIFEST_PATH?.trim();
  if (!configuredPath) {
    throw new Error(
      "RCP32_MANIFEST_PATH is required for the guarded release gate.",
    );
  }
  const expectedKeys = [
    "version",
    "alice_user_id",
    "bob_user_id",
    "curator_user_id",
    "moderator_user_id",
    "root_recipe_version_id",
    "child_recipe_version_id",
    "ingredient_request_id",
    "approved_ingredient_id",
    "exact_preflight_id",
    "probable_preflight_id",
    "report_id",
  ].sort();
  const actualKeys = Object.keys(manifest).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("The RCP-32 manifest schema changed unexpectedly.");
  }
  for (const [key, value] of Object.entries(manifest)) {
    if (key !== "version" && !uuidPattern.test(String(value))) {
      throw new Error("The RCP-32 manifest contains a non-UUID identifier.");
    }
  }

  const manifestPath = resolve(configuredPath);
  await mkdir(dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.rcp32-${process.pid}.tmp`;
  const stable = Object.fromEntries(
    Object.entries(manifest).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(`${JSON.stringify(stable)}\n`, {
        encoding: "utf8",
      });
      await handle.chmod(0o600);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, manifestPath);
    await unlink(temporaryPath);
    temporaryCreated = false;
  } finally {
    if (temporaryCreated) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

function requirePrivateCheckpointPath(value: string, label: string): string {
  const root = resolve(process.env.RUNNER_TEMP ?? tmpdir());
  const path = resolve(value);
  const pathFromRoot = relative(root, path);
  if (
    pathFromRoot === "" ||
    pathFromRoot.startsWith("..") ||
    resolve(root, pathFromRoot) !== path
  ) {
    throw new Error(
      `The RCP-33G ${label} must be a file inside the private temporary directory.`,
    );
  }
  return path;
}

async function waitForPreDeletionBackup(): Promise<void> {
  const configuredReadyPath =
    process.env.RCP33G_BACKUP_READY_PATH?.trim() ?? "";
  const configuredContinuePath =
    process.env.RCP33G_BACKUP_CONTINUE_PATH?.trim() ?? "";
  if (!configuredReadyPath && !configuredContinuePath) {
    return;
  }
  if (!configuredReadyPath || !configuredContinuePath) {
    throw new Error("RCP-33G requires both private backup checkpoint paths.");
  }

  const readyPath = requirePrivateCheckpointPath(
    configuredReadyPath,
    "ready marker",
  );
  const continuePath = requirePrivateCheckpointPath(
    configuredContinuePath,
    "continue marker",
  );
  if (readyPath === continuePath) {
    throw new Error(
      "The RCP-33G backup checkpoint paths must be different files.",
    );
  }

  await mkdir(dirname(readyPath), { recursive: true, mode: 0o700 });
  const handle = await open(readyPath, "wx", 0o600);
  try {
    await handle.writeFile("ready\n", { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }

  for (let attempt = 0; attempt < 1_800; attempt += 1) {
    try {
      await access(continuePath);
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw new Error("The RCP-33G continue marker could not be checked.");
      }
    }
    await delay(100);
  }
  throw new Error("The RCP-33G pre-deletion backup checkpoint timed out.");
}

test.describe("RCP-32 two-user community release gate", () => {
  test.describe.configure({ retries: 0, timeout: 420_000 });
  test.skip(
    !acceptanceEnabled,
    "RCP-32 requires the explicitly guarded disposable acceptance database.",
  );

  test("proves the complete real-provider community lifecycle", async ({
    browser,
  }) => {
    assertRcp32AcceptanceDatabase();
    if (!process.env.RCP32_MANIFEST_PATH?.trim()) {
      throw new Error(
        "RCP32_MANIFEST_PATH is required before starting the RCP-32 journey.",
      );
    }

    const aliceContext = await createRcp32Context(browser, "alice");
    const bobContext = await createRcp32Context(browser, "bob");
    const curatorContext = await createRcp32Context(browser, "curator");
    const moderatorContext = await createRcp32Context(browser, "moderator");
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    const curator = await curatorContext.newPage();
    const moderator = await moderatorContext.newPage();

    let aliceUserId = "";
    let bobUserId = "";
    let curatorUserId = "";
    let moderatorUserId = "";
    let ingredientRequestId = "";
    let approvedIngredientId = "";
    let gramUnitId = "";
    let rootRecipeVersionId = "";
    let exactRecipeVersionId = "";
    let childRecipeVersionId = "";
    let exactPreflightId = "";
    let probablePreflightId = "";
    let reportId = "";

    try {
      await test.step("onboard four independent members through the real OIDC UI", async () => {
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
        aliceUserId = aliceSession.user.id;
        bobUserId = bobSession.user.id;
        curatorUserId = curatorSession.user.id;
        moderatorUserId = moderatorSession.user.id;
        expect(
          new Set([aliceUserId, bobUserId, curatorUserId, moderatorUserId])
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
      });

      let aliceDraftId = "";
      await test.step("preserve Alice's draft while she requests a missing ingredient", async () => {
        await alice.goto("/recipes/new");
        await expect(alice).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
        aliceDraftId = requireUuid(
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
        gramUnitId = await unit.inputValue();
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
        await activateWithKeyboard(alice, requestButton);
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
        ingredientRequestId = requireUuid(
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
          "4.00",
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
          `/api/recipe-drafts/${aliceDraftId}`,
        );
        expect(bobCannotReadDraft.status()).toBe(404);
        for (const page of [alice, bob]) {
          const forbiddenQueue = await page.request.get(
            "/api/ingredient-requests?status=pending&page=1&page_size=20",
          );
          expect(forbiddenQueue.status()).toBe(403);
        }
      });

      await test.step("grant only curator access, approve through the UI, then revoke it", async () => {
        await grantCatalogCurator(curatorUserId);
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
        await activateWithKeyboard(curator, requestItem);
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
                `/api/ingredient-requests/${ingredientRequestId}/review`,
              ),
        );
        await curator
          .getByRole("button", { name: "Approve request" })
          .click();
        const reviewResponse = await reviewed;
        expect(reviewResponse.status()).toBe(200);
        approvedIngredientId = requireUuid(
          (await jsonRecord(reviewResponse)).resolved_ingredient_id,
          "approved ingredient ID",
        );
        await expect(
          curator.getByText(`${requestedIngredient} is now approved.`, {
            exact: true,
          }),
        ).toBeVisible();
        await expectNoAccessibilityViolations(curator);

        await revokeCatalogCurator(curatorUserId);
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
      });

      await test.step("resolve, structure, save, reload, and publish Alice's immutable root", async () => {
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
        await search.focus();
        const useResolution = ingredient
          .getByRole("listbox", { name: "Ingredient suggestions" })
          .getByRole("option", {
            name: `${requestedIngredient} Approved from your ingredient request`,
            exact: true,
          });
        await expect(useResolution).toBeVisible();
        await activateWithKeyboard(alice, useResolution);
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
          "4.00",
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
        ).toHaveValue(gramUnitId);
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
          "4.00",
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

        rootRecipeVersionId = await publishDistinctOriginal(
          alice,
          aliceDraftId,
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
            await alice.request.get(`/api/recipe-drafts/${aliceDraftId}`)
          ).status(),
        ).toBe(404);
      });

      let bobRootState: ViewerState;
      await test.step("let Bob discover, view, save, rate, and idempotently re-save the root", async () => {
        await bob.goto(`/recipes?q=${encodeURIComponent(rootTitle)}`);
        const rootCard = bob.getByRole("article", {
          name: rootTitle,
          exact: true,
        });
        await expect(rootCard).toBeVisible();
        const viewResponse = bob.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().endsWith(`/api/recipes/${rootRecipeVersionId}/view`),
        );
        await Promise.all([
          bob.waitForURL("/recipes/" + rootRecipeVersionId),
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
            response.url().endsWith(`/api/recipes/${rootRecipeVersionId}/save`),
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
              .endsWith(`/api/recipes/${rootRecipeVersionId}/rating`),
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
          `/api/recipes/${rootRecipeVersionId}/save`,
          { headers: idempotentHeaders },
        );
        expect(firstReplayableSave.status()).toBe(200);
        const secondReplayableSave = await bob.request.put(
          `/api/recipes/${rootRecipeVersionId}/save`,
          { headers: idempotentHeaders },
        );
        expect(secondReplayableSave.status()).toBe(200);
        expect(await firstReplayableSave.json()).toEqual(
          await secondReplayableSave.json(),
        );

        const bobRoot = await bob.request.get(
          `/api/recipes/${rootRecipeVersionId}`,
        );
        expect(bobRoot.status()).toBe(200);
        const bobRootPayload = await jsonRecord(bobRoot);
        bobRootState = viewerStateFromRecipe(
          bobRootPayload,
          rootRecipeVersionId,
        );
        expect(bobRootState).toEqual({
          rating: 4,
          recipe_version_id: rootRecipeVersionId,
          saved: true,
        });
        const aliceRoot = await alice.request.get(
          `/api/recipes/${rootRecipeVersionId}`,
        );
        expect(aliceRoot.status()).toBe(200);
        expect(
          viewerStateFromRecipe(
            await jsonRecord(aliceRoot),
            rootRecipeVersionId,
          ),
        ).toEqual({
          rating: null,
          recipe_version_id: rootRecipeVersionId,
          saved: false,
        });
        await expectNoAccessibilityViolations(bob);
      });

      await test.step("record Bob's explicit exact unchanged-fork continue decision", async () => {
        await bob.goto(`/recipes/${rootRecipeVersionId}/fork`);
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
        exactPreflightId = exactPublication.preflightId;
        exactRecipeVersionId = exactPublication.recipeVersionId;
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
        ).toHaveAttribute("href", `/recipes/${rootRecipeVersionId}`);
      });

      let bobChildDraftId = "";
      await test.step("publish Bob's real probable duplicate with controlled amount and action changes", async () => {
        await bob.goto(`/recipes/${rootRecipeVersionId}/fork`);
        await expect(bob).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
        bobChildDraftId = requireUuid(
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
              `/api/recipe-drafts/${bobChildDraftId}`,
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
        ).toHaveValue("20.000000");
        await resumedAction
          .getByRole("button", { name: "Done", exact: true })
          .click();

        expect(
          (
            await alice.request.get(`/api/recipe-drafts/${bobChildDraftId}`)
          ).status(),
        ).toBe(404);
        const bobDraftBeforeEdit = await bob.request.get(
          `/api/recipe-drafts/${bobChildDraftId}`,
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
          `/api/recipe-drafts/${bobChildDraftId}`,
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
          `/api/recipe-drafts/${bobChildDraftId}`,
        );
        expect(bobDraftAfterEdit.status()).toBe(200);
        const bobDraftAfterEditPayload = await jsonRecord(bobDraftAfterEdit);
        expect(bobDraftAfterEditPayload.title).toBe(childTitle);
        expect(bobDraftAfterEditPayload.revision).toBe(bobDraftRevision);
        const childPublication = await publishReviewedFork(
          bob,
          bobChildDraftId,
          "probable_duplicate",
        );
        probablePreflightId = childPublication.preflightId;
        childRecipeVersionId = childPublication.recipeVersionId;
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
        ).toHaveAttribute("href", `/recipes/${rootRecipeVersionId}`);
        expect(
          (
            await alice.request.get(`/api/recipe-drafts/${bobChildDraftId}`)
          ).status(),
        ).toBe(404);
      });

      await test.step("prove immutable authorship, full direct-parent diff, and safe public payloads", async () => {
        const publicContext = await browser.newContext({ baseURL: baseUrl });
        const publicPage = await publicContext.newPage();
        try {
          const rootResponse = await publicPage.request.get(
            `/api/recipes/${rootRecipeVersionId}`,
          );
          expect(rootResponse.status()).toBe(200);
          const rootPayload = await jsonRecord(rootResponse);
          expect(rootPayload.title).toBe(rootTitle);
          expect(rootPayload.parent_version_id).toBeNull();
          expect(rootPayload.viewer_state).toBeNull();
          expectPublicPayloadSafe(rootPayload);

          const childResponse = await publicPage.request.get(
            `/api/recipes/${childRecipeVersionId}`,
          );
          expect(childResponse.status()).toBe(200);
          const childPayload = await jsonRecord(childResponse);
          expect(childPayload.title).toBe(childTitle);
          expect(childPayload.parent_version_id).toBe(rootRecipeVersionId);
          expect(childPayload.viewer_state).toBeNull();
          expectPublicPayloadSafe(childPayload);

          const exactResponse = await publicPage.request.get(
            `/api/recipes/${exactRecipeVersionId}`,
          );
          expect(exactResponse.status()).toBe(200);
          const exactPayload = await jsonRecord(exactResponse);
          expect(exactPayload.parent_version_id).toBe(rootRecipeVersionId);
          expect(exactPayload.title).toBe(exactTitle);
          expectPublicPayloadSafe(exactPayload);

          await publicPage.goto(`/recipes/${rootRecipeVersionId}`);
          await expect(
            publicPage
              .getByRole("link", { name: "Alice Cook", exact: true })
              .first(),
          ).toHaveAttribute("href", "/cooks/rcp32_alice");
          await publicPage.goto(`/recipes/${childRecipeVersionId}`);
          await expect(
            publicPage
              .getByRole("link", { name: "Bob Cook", exact: true })
              .first(),
          ).toHaveAttribute("href", "/cooks/rcp32_bob");
          await publicPage
            .locator(".recipe-detail__parent-context")
            .getByRole("link", { name: rootTitle, exact: true })
            .click();
          await expect(publicPage).toHaveURL(`/recipes/${rootRecipeVersionId}`);
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
            `/recipes/${childRecipeVersionId}/compare?base_version_id=${rootRecipeVersionId}`;
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
      });

      await test.step("deny Alice cross-user draft, withdrawal, author, and moderation powers", async () => {
        expect(
          (
            await alice.request.get(`/api/recipe-drafts/${bobChildDraftId}`)
          ).status(),
        ).toBe(404);
        const unauthorizedWithdrawal = await alice.request.put(
          `/api/recipes/${childRecipeVersionId}/visibility`,
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
          childRecipeVersionId,
        );
        expect(recommendationIds(bobRecommendationPayload)).not.toContain(
          childRecipeVersionId,
        );
        expect(recommendationIds(bobRecommendationPayload)).not.toContain(
          rootRecipeVersionId,
        );
        expectPublicPayloadSafe(aliceRecommendationPayload);
        expectPublicPayloadSafe(bobRecommendationPayload);
      });

      await test.step("sign Bob out for real, reject a later write, and preserve state after OIDC re-login", async () => {
        const staleCsrf = await rcp32CsrfToken(bob);
        const badCsrf = await bob.request.put(
          `/api/recipes/${rootRecipeVersionId}/rating`,
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
          `/api/recipes/${rootRecipeVersionId}/rating`,
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
        await bob.goto(`/recipes/${childRecipeVersionId}`);
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

        await bob.goto(`/recipes/${childRecipeVersionId}`);
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
          `/api/recipes/${rootRecipeVersionId}/rating`,
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

        const reauthenticated = await signInExistingRcp32Identity(bob, "bob");
        expect(reauthenticated.user.id).toBe(bobUserId);
        const unchanged = await bob.request.get(
          `/api/recipes/${rootRecipeVersionId}`,
        );
        expect(unchanged.status()).toBe(200);
        expect(
          viewerStateFromRecipe(
            await jsonRecord(unchanged),
            rootRecipeVersionId,
          ),
        ).toEqual(bobRootState);
      });

      await test.step("submit one private report and keep ordinary members and curators out", async () => {
        await bob.goto(`/recipes/${rootRecipeVersionId}`);
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
              .endsWith(`/api/recipes/${rootRecipeVersionId}/reports`),
        );
        await bob
          .getByRole("button", { name: "Submit private report", exact: true })
          .click();
        const reportReceipt = await reportResponse;
        expect(reportReceipt.status()).toBe(201);
        reportId = requireUuid(
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
          rootRecipeVersionId,
          rootTitle,
        );
      });

      await test.step("grant the separate moderator role, hide safely, restore, resolve, and revoke", async () => {
        await grantCommunityModerator(moderatorUserId);
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
                `/api/moderation/recipe-reports/${rootRecipeVersionId}/actions`,
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
                `/api/recipes/${rootRecipeVersionId}`,
              )
            ).status(),
          ).toBe(404);
          await expectAnonymousDiscoveryExcludes(
            publicPage,
            rootRecipeVersionId,
            rootTitle,
          );
          const survivingChild = await publicPage.request.get(
            `/api/recipes/${childRecipeVersionId}`,
          );
          expect(survivingChild.status()).toBe(200);
          const survivingPayload = await jsonRecord(survivingChild);
          expect(survivingPayload.parent_version_id).toBe(rootRecipeVersionId);
          expect(survivingPayload.parent).toBeNull();
          expectPublicPayloadSafe(survivingPayload);
          await publicPage.goto(`/recipes/${childRecipeVersionId}`);
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
            "This recipe is hidden by moderation. Its visibility cannot be changed here.",
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
                `/api/moderation/recipe-reports/${rootRecipeVersionId}/actions`,
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
          rootRecipeVersionId,
          rootTitle,
        );

        const resolveResponse = moderator.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response
              .url()
              .endsWith(
                `/api/moderation/recipe-reports/${rootRecipeVersionId}/actions`,
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
        await revokeCommunityModerator(moderatorUserId);
        const revoked = await readRcp32Session(moderator);
        expect(revoked.capabilities.moderate_recipe_reports).toBe(false);
        expect(revoked.capabilities.review_ingredient_requests).toBe(false);
        expect(
          (
            await moderator.request.get("/api/moderation/recipe-reports")
          ).status(),
        ).toBe(403);
      });

      await test.step("withdraw only Alice's parent while every public child survives", async () => {
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
              .endsWith(`/api/recipes/${rootRecipeVersionId}/visibility`),
        );
        await rootCard
          .getByRole("button", { name: `Confirm withdrawal of ${rootTitle}` })
          .click();
        expect((await withdrawalResponse).status()).toBe(200);
        await expect(alice.getByRole("status")).toHaveText(
          `${rootTitle} moved to Withdrawn.`,
        );
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
                `/api/recipes/${rootRecipeVersionId}`,
              )
            ).status(),
          ).toBe(404);
          await expectAnonymousDiscoveryExcludes(
            publicPage,
            rootRecipeVersionId,
            rootTitle,
          );
          for (const retainedVersionId of [
            exactRecipeVersionId,
            childRecipeVersionId,
          ]) {
            const retained = await publicPage.request.get(
              `/api/recipes/${retainedVersionId}`,
            );
            expect(retained.status()).toBe(200);
            const retainedPayload = await jsonRecord(retained);
            expect(retainedPayload.parent_version_id).toBe(rootRecipeVersionId);
            expect(retainedPayload.parent).toBeNull();
            expectPublicPayloadSafe(retainedPayload);
          }
          await publicPage.goto(`/recipes/${childRecipeVersionId}`);
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
      });

      await test.step("run the read-only phone release check", async () => {
        const phoneContext = await browser.newContext({
          baseURL: baseUrl,
          viewport: { width: 390, height: 844 },
        });
        const phone = await phoneContext.newPage();
        try {
          await phone.goto(`/recipes/${childRecipeVersionId}`);
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
      });
      await test.step("emit recovery evidence and allow an older backup before deletion", async () => {
        await writeManifest({
          version: 1,
          alice_user_id: aliceUserId,
          bob_user_id: bobUserId,
          curator_user_id: curatorUserId,
          moderator_user_id: moderatorUserId,
          root_recipe_version_id: rootRecipeVersionId,
          child_recipe_version_id: childRecipeVersionId,
          ingredient_request_id: ingredientRequestId,
          approved_ingredient_id: approvedIngredientId,
          exact_preflight_id: exactPreflightId,
          probable_preflight_id: probablePreflightId,
          report_id: reportId,
        });
        await waitForPreDeletionBackup();
      });

      await test.step("delete Bob last and retain tombstoned public lineage", async () => {
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
            `/api/recipes/${childRecipeVersionId}`,
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
          expect(childPayload.parent_version_id).toBe(rootRecipeVersionId);
          expect(childPayload.parent).toBeNull();
          expectPublicPayloadSafe(childPayload);
          await publicPage.goto(`/recipes/${childRecipeVersionId}`);
          await expect(
            publicPage.getByRole("heading", { name: childTitle, level: 1 }),
          ).toBeVisible();
          await expect(
            publicPage
              .locator(".recipe-detail__attribution")
              .getByText("Deleted cook", { exact: true }),
          ).toBeVisible();
          await expect(
            publicPage.getByRole("link", { name: "Deleted cook" }),
          ).toHaveCount(0);
          await expect(
            publicPage
              .locator(".recipe-detail__parent-context")
              .getByRole("link"),
          ).toHaveCount(0);
          await expect(
            publicPage.locator(".recipe-detail__parent-context"),
          ).toHaveText("Source unavailable");
          await expect(
            publicPage.locator(".recipe-detail__parent-context"),
          ).toBeVisible();
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
      });
    } finally {
      await Promise.allSettled([
        aliceContext.close(),
        bobContext.close(),
        curatorContext.close(),
        moderatorContext.close(),
      ]);
    }
  });
});
