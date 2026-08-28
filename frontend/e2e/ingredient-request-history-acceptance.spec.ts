import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  type MemberName,
  useAcceptanceMember as applyAcceptanceMember,
} from "./acceptance-session";

const acceptanceEnabled =
  process.env.MVP_ACCEPTANCE === "1" &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

type RequestStatus = "pending" | "approved" | "rejected" | "duplicate";

interface CatalogIngredient {
  aliases: string[];
  canonical_name: string;
  id: string;
}

interface CreatedRequest {
  context: string | null;
  id: string;
  proposed_name: string;
}

interface MemberIngredientRequest extends CreatedRequest {
  created_at: string;
  decision_reason: string | null;
  resolved_ingredient: CatalogIngredient | null;
  resolved_ingredient_id: string | null;
  reviewed_at: string | null;
  status: RequestStatus;
}

interface MemberRequestPage {
  items: MemberIngredientRequest[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

interface ReviewResult {
  resolved_ingredient_id: string | null;
}

function apiUrl(path: string): string {
  return new URL(path, baseUrl).toString();
}

async function memberGet(
  page: Page,
  memberName: MemberName,
  path: string,
): Promise<APIResponse> {
  await applyAcceptanceMember(page, memberName);
  return page.request.get(apiUrl(path), {
    headers: { Accept: "application/json" },
  });
}

async function memberPost(
  page: Page,
  memberName: MemberName,
  path: string,
  payload: Record<string, unknown>,
): Promise<APIResponse> {
  const member = await applyAcceptanceMember(page, memberName);
  return page.request.post(apiUrl(path), {
    data: payload,
    headers: {
      Accept: "application/json",
      Origin: baseUrl,
      "X-CSRF-Token": member.csrf_token,
    },
  });
}

async function submitRequest(
  page: Page,
  proposedName: string,
  context: string,
): Promise<CreatedRequest> {
  const response = await memberPost(page, "alice", "/api/ingredient-requests", {
    proposed_name: proposedName,
    context,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as CreatedRequest;
}

async function reviewRequest(
  page: Page,
  requestId: string,
  payload: Record<string, unknown>,
): Promise<ReviewResult> {
  const response = await memberPost(
    page,
    "curator",
    `/api/ingredient-requests/${requestId}/review`,
    payload,
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ReviewResult;
}

async function findCatalogIngredient(
  page: Page,
  canonicalName: string,
): Promise<CatalogIngredient> {
  const response = await page.request.get(
    apiUrl(`/api/ingredients?q=${encodeURIComponent(canonicalName)}`),
    { headers: { Accept: "application/json" } },
  );
  expect(response.status(), await response.text()).toBe(200);
  const payload = (await response.json()) as { items: CatalogIngredient[] };
  const ingredient = payload.items.find(
    (item) => item.canonical_name === canonicalName,
  );
  expect(ingredient, `${canonicalName} must be present in the seeded catalog.`).toBeDefined();
  return ingredient!;
}

function expectSafeMemberRequestShape(request: MemberIngredientRequest): void {
  expect(Object.keys(request).sort()).toEqual([
    "context",
    "created_at",
    "decision_reason",
    "id",
    "proposed_name",
    "resolved_ingredient",
    "resolved_ingredient_id",
    "reviewed_at",
    "status",
  ]);
  if (request.resolved_ingredient) {
    expect(Object.keys(request.resolved_ingredient).sort()).toEqual([
      "aliases",
      "canonical_name",
      "id",
    ]);
  }
}

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

async function activateWithKeyboard(page: Page, control: Locator): Promise<void> {
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");
}

function ingredientRequestArticle(
  container: Locator,
  proposedName: string,
): Locator {
  return container.getByRole("article", {
    name: `Ingredient request: ${proposedName}`,
  });
}

test.describe("member ingredient-request acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    !acceptanceEnabled,
    "Ingredient-request history requires the isolated, freshly seeded acceptance database.",
  );

  test("shows one member every request status without leaking curator-only data", async ({
    page,
  }) => {
    const runId = Date.now().toString(36);
    const searchPrefix = `Acceptance account history ${runId}`;
    const approvedName = `${searchPrefix} sapphire leaf`;
    const approvedCanonical = `Acceptance account sapphire leaf ${runId}`;
    const approvedAlias = `Acceptance account blue leaf ${runId}`;
    const duplicateName = `${searchPrefix} blue garnish`;
    const rejectedName = `${searchPrefix} mystery herb`;
    const pendingName = `${searchPrefix} waiting herb`;
    const approvedContext = "Alice uses this leaf in a chilled summer soup.";
    const duplicateContext = "Alice suspects this garnish is the same sapphire leaf.";
    const rejectedContext = "Alice cannot identify this herb beyond its color.";
    const pendingContext = "Alice is waiting for a trusted catalog decision.";
    const approvedReason = "The proposal is a distinct, well-described ingredient.";
    const duplicateReason = "The approved sapphire-leaf identity covers this garnish.";
    const rejectedReason = "The proposal is not specific enough to curate safely.";

    const approved = await submitRequest(page, approvedName, approvedContext);
    const duplicate = await submitRequest(page, duplicateName, duplicateContext);
    const rejected = await submitRequest(page, rejectedName, rejectedContext);
    const pending = await submitRequest(page, pendingName, pendingContext);

    const approvedReview = await reviewRequest(page, approved.id, {
      decision: "approve",
      canonical_name: approvedCanonical,
      aliases: [approvedAlias],
      reason: approvedReason,
      provenance: "RCP-25A.2 member-history acceptance fixture.",
    });
    await reviewRequest(page, duplicate.id, {
      decision: "duplicate",
      request_id: approved.id,
      reason: duplicateReason,
    });
    await reviewRequest(page, rejected.id, {
      decision: "reject",
      reason: rejectedReason,
    });

    const expectedByStatus: Record<RequestStatus, CreatedRequest> = {
      approved,
      duplicate,
      pending,
      rejected,
    };
    const memberRequests = new Map<RequestStatus, MemberIngredientRequest>();
    for (const status of ["pending", "approved", "rejected", "duplicate"] as const) {
      const response = await memberGet(
        page,
        "alice",
        `/api/ingredient-requests/mine?status=${status}&q=${encodeURIComponent(searchPrefix)}`,
      );
      expect(response.status(), await response.text()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      const payload = (await response.json()) as MemberRequestPage;
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]).toMatchObject({
        id: expectedByStatus[status].id,
        proposed_name: expectedByStatus[status].proposed_name,
        status,
      });
      expectSafeMemberRequestShape(payload.items[0]);
      memberRequests.set(status, payload.items[0]);
    }

    expect(memberRequests.get("approved")?.resolved_ingredient).toEqual({
      aliases: [approvedAlias],
      canonical_name: approvedCanonical,
      id: approvedReview.resolved_ingredient_id,
    });
    expect(memberRequests.get("duplicate")?.resolved_ingredient).toEqual(
      memberRequests.get("approved")?.resolved_ingredient,
    );
    for (const status of ["pending", "rejected"] as const) {
      expect(memberRequests.get(status)).toMatchObject({
        resolved_ingredient: null,
        resolved_ingredient_id: null,
      });
    }

    await applyAcceptanceMember(page, "alice");
    await page.goto("/");
    await page.getByLabel("Account menu for Alice Cook").click();
    await page.getByRole("link", { name: "My ingredient requests" }).click();
    await expect(page).toHaveURL("/account/ingredient-requests");
    await expect(
      page.getByRole("heading", { name: "My ingredient requests", level: 1 }),
    ).toBeVisible();

    const search = page.getByRole("searchbox", {
      name: "Search my ingredient requests",
    });
    const statusFilter = page.getByRole("combobox", { name: "Request status" });
    await expect(statusFilter.locator("option")).toHaveText([
      "All",
      "Pending",
      "Approved",
      "Rejected",
      "Duplicate",
    ]);
    await search.fill(searchPrefix);
    await search.press("Enter");

    const results = page.getByRole("region", { name: "My ingredient requests" });
    await expect(results.getByRole("article")).toHaveCount(4);
    await expect(search).toBeFocused();
    const visibleRequests = [
      {
        context: approvedContext,
        name: approvedName,
        reason: approvedReason,
        resolution: approvedCanonical,
        status: "Approved",
      },
      {
        context: duplicateContext,
        name: duplicateName,
        reason: duplicateReason,
        resolution: approvedCanonical,
        status: "Duplicate",
      },
      {
        context: rejectedContext,
        name: rejectedName,
        reason: rejectedReason,
        resolution: null,
        status: "Rejected",
      },
      {
        context: pendingContext,
        name: pendingName,
        reason: null,
        resolution: null,
        status: "Pending",
      },
    ];
    for (const item of visibleRequests) {
      const article = ingredientRequestArticle(results, item.name);
      await expect(article).toBeVisible();
      for (const label of ["Status", "Requested", "Context"]) {
        await expect(article.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(article.locator("dd").filter({ hasText: item.status }).first()).toBeVisible();
      await expect(article.getByText(item.context, { exact: true })).toBeVisible();
      if (item.reason) {
        await expect(article.getByText("Reviewed", { exact: true })).toBeVisible();
        await expect(article.getByText("Decision reason", { exact: true })).toBeVisible();
        await expect(article.getByText(item.reason, { exact: true })).toBeVisible();
      } else {
        await expect(article.getByText("Reviewed", { exact: true })).toHaveCount(0);
        await expect(article.getByText("Decision reason", { exact: true })).toHaveCount(0);
      }
      if (item.resolution) {
        await expect(article.getByText("Resolved ingredient", { exact: true })).toBeVisible();
        await expect(article.getByText(item.resolution, { exact: true })).toBeVisible();
      } else {
        await expect(article.getByText("Resolved ingredient", { exact: true })).toHaveCount(0);
      }
    }

    for (const label of [
      "Approval provenance",
      "Requester user ID",
      "Reviewer user ID",
      "OIDC subject",
      "Session token",
    ]) {
      await expect(results.getByText(label, { exact: true })).toHaveCount(0);
    }
    await expect(results.getByRole("button", { name: /^Use .+ for / })).toHaveCount(0);

    for (const item of visibleRequests) {
      await statusFilter.focus();
      await statusFilter.selectOption({ label: item.status });
      await expect(results.getByRole("article")).toHaveCount(1);
      await expect(ingredientRequestArticle(results, item.name)).toBeVisible();
      await expect(statusFilter).toBeFocused();
    }
    await statusFilter.selectOption({ label: "All" });
    await expect(results.getByRole("article")).toHaveCount(4);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await expectNoAccessibilityViolations(page);

    await applyAcceptanceMember(page, "bob");
    await page.goto("/account/ingredient-requests");
    await expect(
      page.getByRole("heading", { name: "My ingredient requests", level: 1 }),
    ).toBeVisible();
    const bobSearch = page.getByRole("searchbox", {
      name: "Search my ingredient requests",
    });
    await bobSearch.fill(searchPrefix);
    await bobSearch.press("Enter");
    await expect(
      page
        .getByRole("region", { name: "My ingredient requests" })
        .getByRole("article"),
    ).toHaveCount(0);

    const bobList = await memberGet(
      page,
      "bob",
      `/api/ingredient-requests/mine?q=${encodeURIComponent(searchPrefix)}`,
    );
    expect(bobList.status(), await bobList.text()).toBe(200);
    expect(((await bobList.json()) as MemberRequestPage).items).toEqual([]);

    const bobDetail = await memberGet(
      page,
      "bob",
      `/api/ingredient-requests/${approved.id}`,
    );
    expect(bobDetail.status()).toBe(404);
  });

  test("uses only trusted resolutions in one picker and preserves the whole draft", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    const runId = Date.now().toString(36);
    const searchPrefix = `Acceptance draft request ${runId}`;
    const approvedName = `${searchPrefix} silver leaf`;
    const approvedCanonical = `Acceptance draft silver leaf ${runId}`;
    const duplicateName = `${searchPrefix} pecan garnish`;
    const rejectedName = `${searchPrefix} unknown sprig`;
    const pendingName = `${searchPrefix} waiting flower`;
    const staleName = `${searchPrefix} stale leaf`;
    const staleCanonical = `Acceptance draft stale leaf ${runId}`;
    const pecan = await findCatalogIngredient(page, "Pecan");

    const approved = await submitRequest(
      page,
      approvedName,
      "Alice wants to use this reviewed leaf in a recipe draft.",
    );
    const duplicate = await submitRequest(
      page,
      duplicateName,
      "Alice thinks this garnish is the cataloged pecan.",
    );
    const rejected = await submitRequest(
      page,
      rejectedName,
      "Alice cannot identify this sprig precisely.",
    );
    const pending = await submitRequest(
      page,
      pendingName,
      "Alice is still waiting for a curator decision.",
    );
    const stale = await submitRequest(
      page,
      staleName,
      "Alice will exercise owner revalidation before selection.",
    );

    const approvedReview = await reviewRequest(page, approved.id, {
      decision: "approve",
      canonical_name: approvedCanonical,
      aliases: [`Acceptance draft moon leaf ${runId}`],
      reason: "The proposal is safe to add as a distinct catalog identity.",
      provenance: "RCP-25A.2 trusted-selection acceptance fixture.",
    });
    expect(approvedReview.resolved_ingredient_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    await reviewRequest(page, duplicate.id, {
      decision: "duplicate",
      ingredient_id: pecan.id,
      reason: "The curated Pecan identity already covers this request.",
    });
    await reviewRequest(page, rejected.id, {
      decision: "reject",
      reason: "The proposal cannot be identified safely.",
    });
    await reviewRequest(page, stale.id, {
      decision: "approve",
      canonical_name: staleCanonical,
      aliases: [],
      reason: "This is a separate catalog identity used for revalidation coverage.",
      provenance: "RCP-25A.2 stale-selection acceptance fixture.",
    });

    await applyAcceptanceMember(page, "alice");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/recipes?q=carrot");
    await page
      .getByRole("article", { name: "Carrot Walnut Snack Cake", exact: true })
      .filter({ hasNot: page.locator(".recipe-card__parent") })
      .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Make your own version", exact: true })
      .click();
    await expect(page).toHaveURL(/\/account\/recipe-drafts\/[0-9a-f-]+$/i);

    const draftTitle = `Acceptance trusted-request carrot cake ${runId}`;
    const draftDescription = "A carefully preserved draft around a reviewed ingredient.";
    const draftInstruction =
      "Heat the oven, prepare the pan, and keep this edited instruction intact.";
    await page.getByLabel("Title", { exact: true }).fill(draftTitle);
    await page.getByLabel("Description", { exact: true }).fill(draftDescription);
    await page.getByLabel("Servings", { exact: true }).fill("6");

    const sugarLabel = "Ingredient 3";
    const walnutLabel = "Ingredient 6";
    const sugarRow = page.getByRole("group", { name: sugarLabel, exact: true });
    const walnutRow = page.getByRole("group", { name: walnutLabel, exact: true });
    const eggRow = page.getByRole("group", { name: "Ingredient 4", exact: true });
    await sugarRow.getByRole("textbox", { name: "Amount", exact: true }).fill("135");
    const selectedSugarUnitId = await sugarRow
      .getByRole("combobox", { name: "Unit", exact: true })
      .inputValue();
    await walnutRow.getByRole("textbox", { name: "Amount", exact: true }).fill("95");
    const selectedWalnutUnitId = await walnutRow
      .getByRole("combobox", { name: "Unit", exact: true })
      .inputValue();
    await page.getByLabel("Human-readable direction", { exact: true }).first().fill(draftInstruction);

    const expectDraftPreserved = async (): Promise<void> => {
      await expect(page.getByLabel("Title", { exact: true })).toHaveValue(draftTitle);
      await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
        draftDescription,
      );
      await expect(page.getByLabel("Servings", { exact: true })).toHaveValue("6");
      await expect(
        sugarRow.getByRole("textbox", { name: "Amount", exact: true }),
      ).toHaveValue("135");
      await expect(
        sugarRow.getByRole("combobox", { name: "Unit", exact: true }).locator("option:checked"),
      ).toHaveText("gram (g)");
      await expect(
        walnutRow.getByRole("textbox", { name: "Amount", exact: true }),
      ).toHaveValue("95");
      await expect(
        walnutRow
          .getByRole("combobox", { name: "Unit", exact: true })
          .locator("option:checked"),
      ).toHaveText("gram (g)");
      await expect(page.getByLabel("Human-readable direction", { exact: true }).first()).toHaveValue(
        draftInstruction,
      );
      await expect(eggRow.getByText("Egg", { exact: true })).toBeVisible();
      await expect(eggRow.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("2");
    };

    const walnutTrigger = walnutRow.getByRole("button", {
      name: new RegExp(
        `^(?:Choose from|Hide) my ingredient requests for ${walnutLabel}$`,
      ),
    });
    await activateWithKeyboard(page, walnutTrigger);
    await expect(walnutTrigger).toHaveAttribute("aria-expanded", "true");
    const walnutRequests = walnutRow.getByRole("region", {
      name: `Choose from my ingredient requests for ${walnutLabel}`,
    });
    await expect(walnutRequests).toBeVisible();
    const filterRequestPanel = async (
      panel: Locator,
      rowLabel: string,
    ): Promise<void> => {
      const requestSearch = panel.getByRole("searchbox", {
        name: `Search my ingredient requests for ${rowLabel}`,
      });
      await requestSearch.fill(searchPrefix);
      await requestSearch.press("Enter");
      await expect(panel.getByRole("article")).toHaveCount(5);
    };
    await filterRequestPanel(walnutRequests, walnutLabel);

    const approvedCard = ingredientRequestArticle(walnutRequests, approvedName);
    const duplicateCard = ingredientRequestArticle(walnutRequests, duplicateName);
    const rejectedCard = ingredientRequestArticle(walnutRequests, rejectedName);
    const pendingCard = ingredientRequestArticle(walnutRequests, pendingName);
    const staleCard = ingredientRequestArticle(walnutRequests, staleName);
    await expect(
      approvedCard.getByRole("button", {
        name: `Use ${approvedCanonical} for ${walnutLabel}`,
      }),
    ).toBeVisible();
    await expect(
      duplicateCard.getByRole("button", { name: `Use Pecan for ${walnutLabel}` }),
    ).toBeVisible();
    await expect(rejectedCard.getByRole("button", { name: /^Use / })).toHaveCount(0);
    await expect(pendingCard.getByRole("button", { name: /^Use / })).toHaveCount(0);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await expectNoAccessibilityViolations(page);

    const approvedDetail = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/api/ingredient-requests/${approved.id}`,
    );
    await activateWithKeyboard(
      page,
      approvedCard.getByRole("button", {
        name: `Use ${approvedCanonical} for ${walnutLabel}`,
      }),
    );
    expect((await approvedDetail).status()).toBe(200);
    await expect(walnutTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(walnutTrigger).toBeFocused();
    const walnutSelection = walnutRow
      .getByText("Selected catalog ingredient", { exact: true })
      .locator("..");
    await expect(walnutSelection).toBeVisible();
    await expect(
      walnutSelection.getByText(approvedCanonical, { exact: true }),
    ).toBeVisible();
    await expectDraftPreserved();

    await activateWithKeyboard(page, walnutTrigger);
    await expect(walnutRequests).toBeVisible();
    await filterRequestPanel(walnutRequests, walnutLabel);
    await page.context().clearCookies({ name: "recipe_lab_session" });
    const expiredDetail = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/api/ingredient-requests/${stale.id}`,
    );
    await activateWithKeyboard(
      page,
      staleCard.getByRole("button", {
        name: `Use ${staleCanonical} for ${walnutLabel}`,
      }),
    );
    expect((await expiredDetail).status()).toBe(401);
    await expect(walnutRequests).toBeVisible();
    await expect(walnutRequests.getByRole("alert")).toContainText(
      "Your session expired. Your recipe was not changed.",
    );
    await expect(
      walnutRequests.getByRole("link", { name: "Sign in in a new tab" }),
    ).toHaveAttribute("target", "_blank");
    await expect(
      page.getByRole("heading", { name: draftTitle, level: 1 }),
    ).toBeVisible();
    await expectDraftPreserved();

    await applyAcceptanceMember(page, "alice");
    await walnutRequests.getByRole("button", { name: "Refresh my requests" }).click();
    await expect(walnutRequests.getByRole("article")).toHaveCount(5);
    await expect(
      walnutRequests.getByRole("link", { name: "Sign in in a new tab" }),
    ).toHaveCount(0);
    await applyAcceptanceMember(page, "bob");
    const staleDetail = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/api/ingredient-requests/${stale.id}`,
    );
    await activateWithKeyboard(
      page,
      staleCard.getByRole("button", {
        name: `Use ${staleCanonical} for ${walnutLabel}`,
      }),
    );
    expect((await staleDetail).status()).toBe(404);
    await expect(walnutRequests).toBeVisible();
    await expect(
      walnutSelection.getByText(approvedCanonical, { exact: true }),
    ).toBeVisible();
    await expectDraftPreserved();

    await applyAcceptanceMember(page, "alice");
    await walnutTrigger.click();
    await expect(walnutTrigger).toHaveAttribute("aria-expanded", "false");

    const sugarTrigger = sugarRow.getByRole("button", {
      name: new RegExp(
        `^(?:Choose from|Hide) my ingredient requests for ${sugarLabel}$`,
      ),
    });
    await activateWithKeyboard(page, sugarTrigger);
    const sugarRequests = sugarRow.getByRole("region", {
      name: `Choose from my ingredient requests for ${sugarLabel}`,
    });
    await filterRequestPanel(sugarRequests, sugarLabel);
    const duplicateDetail = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/api/ingredient-requests/${duplicate.id}`,
    );
    await activateWithKeyboard(
      page,
      ingredientRequestArticle(sugarRequests, duplicateName).getByRole("button", {
        name: `Use Pecan for ${sugarLabel}`,
      }),
    );
    expect((await duplicateDetail).status()).toBe(200);
    await expect(sugarTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(sugarTrigger).toBeFocused();
    const sugarSelection = sugarRow
      .getByText("Selected catalog ingredient", { exact: true })
      .locator("..");
    await expect(sugarSelection).toBeVisible();
    await expect(sugarSelection.getByText("Pecan", { exact: true })).toBeVisible();
    await expectDraftPreserved();

    const draftRequest = page.waitForRequest(
      (request) =>
        request.method() === "PUT" && /\/api\/recipe-drafts\/[0-9a-f-]+$/i.test(new URL(request.url()).pathname),
    );
    const draftResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" && /\/api\/recipe-drafts\/[0-9a-f-]+$/i.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const payload = (await draftRequest).postDataJSON() as {
      description: string | null;
      ingredients: Array<{
        selection: { kind: string; ingredient_id?: string; display_name?: string };
        measure: Record<string, unknown>;
      }>;
      instructions: Array<{ text: string }>;
      servings: string;
      title: string;
    };
    expect(payload).toMatchObject({
      description: draftDescription,
      servings: "6",
      title: draftTitle,
    });
    expect(payload.ingredients).toHaveLength(9);
    const approvedReplacement = payload.ingredients.find(
      (item) => item.selection.display_name === approvedCanonical,
    );
    const duplicateReplacement = payload.ingredients.find(
      (item) => item.selection.display_name === "Pecan",
    );
    expect(approvedReplacement?.selection).toMatchObject({
      ingredient_id: approvedReview.resolved_ingredient_id,
      kind: "catalog",
    });
    expect(duplicateReplacement?.selection).toMatchObject({
      ingredient_id: pecan.id,
      kind: "catalog",
    });
    expect(approvedReplacement?.measure).toMatchObject({
      kind: "exact", unit_id: selectedWalnutUnitId, value: "95",
    });
    expect(duplicateReplacement?.measure).toMatchObject({
      kind: "exact", unit_id: selectedSugarUnitId, value: "135",
    });
    expect(payload.instructions[0]).toMatchObject({ text: draftInstruction });
    const serializedPayload = JSON.stringify(payload);
    for (const unsafeValue of [
      approved.id,
      approvedName,
      duplicate.id,
      duplicateName,
      rejected.id,
      pending.id,
      stale.id,
    ]) {
      expect(serializedPayload).not.toContain(unsafeValue);
    }
    expect((await draftResponse).status()).toBe(200);
    await expect(page.getByText("Draft saved privately.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(draftTitle);
    await expect(page.getByRole("group", { name: walnutLabel, exact: true }).getByText(approvedCanonical, { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: sugarLabel, exact: true }).getByText("Pecan", { exact: true })).toBeVisible();
  });
});
