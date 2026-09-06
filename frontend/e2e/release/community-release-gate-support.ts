import { access, link, mkdir, open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

import {
  installRcp32DeterministicUuids,
  rcp32CsrfToken,
  type Rcp32Identity,
} from "./community-release-oidc";
export const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const rootTitle = "RCP32 Atlas Leaf Knot";
export const rootDescription =
  "A deterministic community-gate recipe built around one reviewed leaf.";
export const rootDirection =
  "Knead the atlas leaf into one compact knot for ten minutes.";
export const exactTitle = "RCP32 Atlas Leaf Knot Exact Fork";
export const childTitle = "RCP32 Double Atlas Leaf Knot";
export const childDirection =
  "Knead the doubled atlas leaf into one compact knot for twenty minutes.";
export const requestedIngredient = "RCP32 Atlas leaf";
export const requestContextCanary = "RCP32_PRIVATE_REQUEST_CONTEXT_CANARY";
export const curatorDecisionReasonCanary =
  "RCP32_PRIVATE_CURATOR_DECISION_REASON_CANARY";
export const curatorProvenanceCanary = "RCP32_PRIVATE_CURATOR_PROVENANCE_CANARY";
export const reportCanary = "RCP32_PRIVATE_REPORT_CANARY";
export const moderatorNoteCanary = "RCP32_PRIVATE_MODERATOR_NOTE_CANARY";
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

export interface ViewerState {
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

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error(`The RCP-32 ${label} was not a UUID.`);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function jsonRecord(
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

export async function expectNoAccessibilityViolations(page: Page): Promise<void> {
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

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
}

export async function activateWithKeyboard(
  control: Locator,
  key: "Enter" | "Space" = "Enter",
): Promise<void> {
  await expect(control).toBeEnabled();
  await control.press(key);
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

export function expectPublicPayloadSafe(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const privateValue of providerPrivateValues) {
    expect(serialized.includes(privateValue)).toBe(false);
  }
  expect(containsPrivatePublicKey(value)).toBe(false);
}

export async function expectFreshAnonymousRecipeSafe(
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

export async function expectAnonymousDiscoveryExcludes(
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

export async function authenticatedMutationHeaders(
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

export async function publishDistinctOriginal(
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

export async function publishReviewedFork(
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
  await activateWithKeyboard(acknowledgement, "Space");
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
  await activateWithKeyboard(continueButton);
  const published = await publicationPayload(await publishResponse);
  await expect(page).toHaveURL(published.location);
  return { preflightId, recipeVersionId: published.recipe_version_id };
}

export function viewerStateFromRecipe(
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

export async function writeManifest(manifest: Rcp32Manifest): Promise<void> {
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

export async function waitForPreDeletionBackup(): Promise<void> {
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

export interface CommunityReleaseJourney {
  browser: Browser;
  aliceContext: BrowserContext;
  bobContext: BrowserContext;
  curatorContext: BrowserContext;
  moderatorContext: BrowserContext;
  alice: Page;
  bob: Page;
  curator: Page;
  moderator: Page;
  aliceUserId: string;
  bobUserId: string;
  curatorUserId: string;
  moderatorUserId: string;
  ingredientRequestId: string;
  approvedIngredientId: string;
  gramUnitId: string;
  rootRecipeVersionId: string;
  exactRecipeVersionId: string;
  childRecipeVersionId: string;
  exactPreflightId: string;
  probablePreflightId: string;
  reportId: string;
  aliceDraftId: string;
  bobChildDraftId: string;
  bobRootState: ViewerState | null;
}

export async function createCommunityReleaseJourney(
  browser: Browser,
): Promise<CommunityReleaseJourney> {
  const aliceContext = await createRcp32Context(browser, "alice");
  const bobContext = await createRcp32Context(browser, "bob");
  const curatorContext = await createRcp32Context(browser, "curator");
  const moderatorContext = await createRcp32Context(browser, "moderator");
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const curator = await curatorContext.newPage();
  const moderator = await moderatorContext.newPage();

  return {
    browser,
    aliceContext,
    bobContext,
    curatorContext,
    moderatorContext,
    alice,
    bob,
    curator,
    moderator,
    aliceUserId: "",
    bobUserId: "",
    curatorUserId: "",
    moderatorUserId: "",
    ingredientRequestId: "",
    approvedIngredientId: "",
    gramUnitId: "",
    rootRecipeVersionId: "",
    exactRecipeVersionId: "",
    childRecipeVersionId: "",
    exactPreflightId: "",
    probablePreflightId: "",
    reportId: "",
    aliceDraftId: "",
    bobChildDraftId: "",
    bobRootState: null,
  };
}

export async function closeCommunityReleaseJourney(
  journey: CommunityReleaseJourney,
): Promise<void> {
  await Promise.allSettled([
    journey.aliceContext.close(),
    journey.bobContext.close(),
    journey.curatorContext.close(),
    journey.moderatorContext.close(),
  ]);
}
