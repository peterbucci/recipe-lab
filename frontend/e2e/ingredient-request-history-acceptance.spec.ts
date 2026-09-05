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
  expect(
    ingredient,
    `${canonicalName} must be present in the seeded catalog.`,
  ).toBeDefined();
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

async function activateWithKeyboard(
  page: Page,
  control: Locator,
): Promise<void> {
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
    const duplicateContext =
      "Alice suspects this garnish is the same sapphire leaf.";
    const rejectedContext = "Alice cannot identify this herb beyond its color.";
    const pendingContext = "Alice is waiting for a trusted catalog decision.";
    const approvedReason =
      "The proposal is a distinct, well-described ingredient.";
    const duplicateReason =
      "The approved sapphire-leaf identity covers this garnish.";
    const rejectedReason =
      "The proposal is not specific enough to curate safely.";

    const approved = await submitRequest(page, approvedName, approvedContext);
    const duplicate = await submitRequest(
      page,
      duplicateName,
      duplicateContext,
    );
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
    for (const status of [
      "pending",
      "approved",
      "rejected",
      "duplicate",
    ] as const) {
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
    await page.getByRole("link", { name: "Requests", exact: true }).click();
    await expect(page).toHaveURL("/account/ingredient-requests");
    await expect(
      page.getByRole("heading", { name: "Ingredient Requests", level: 1 }),
    ).toBeVisible();

    const search = page.getByRole("searchbox", {
      name: "Search my ingredient requests",
    });
    const statusFilters = page.getByRole("navigation", {
      name: "Ingredient request status",
    });
    for (const label of ["All", "Pending", "Approved", "Matched", "Rejected"]) {
      await expect(statusFilters.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await search.fill(searchPrefix);
    await search.press("Enter");

    const results = page.getByRole("region", {
      name: "My ingredient requests",
    });
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
        status: "Matched",
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
      await expect(article.getByText(item.status, { exact: true })).toBeVisible();
      await expect(
        article.getByText(`Context: ${item.context}`, { exact: true }),
      ).toBeVisible();
      if (item.reason) {
        await expect(
          article.getByText(item.reason, { exact: true }),
        ).toBeVisible();
      } else {
        await expect(article.getByText("Waiting for curator review.", { exact: true })).toBeVisible();
      }
      if (item.resolution) {
        await expect(
          article.getByText(item.resolution, { exact: true }),
        ).toBeVisible();
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
    await expect(
      results.getByRole("button", { name: /^Use .+ for / }),
    ).toHaveCount(0);

    for (const item of visibleRequests) {
      const statusFilter = statusFilters.getByRole("button", {
        name: item.status,
        exact: true,
      });
      await statusFilter.focus();
      await statusFilter.click();
      await expect(results.getByRole("article")).toHaveCount(1);
      await expect(ingredientRequestArticle(results, item.name)).toBeVisible();
      await expect(statusFilter).toBeFocused();
    }
    await statusFilters.getByRole("button", { name: "All", exact: true }).click();
    await expect(results.getByRole("article")).toHaveCount(4);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await expectNoAccessibilityViolations(page);

    await applyAcceptanceMember(page, "bob");
    await page.goto("/account/ingredient-requests");
    await expect(
      page.getByRole("heading", { name: "Ingredient Requests", level: 1 }),
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

  test("keeps request states in one picker and uses only trusted resolutions", async ({
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
    const pecan = await findCatalogIngredient(page, "Pecan");

    await applyAcceptanceMember(page, "alice");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/recipes?q=carrot");
    await page
      .getByRole("article", { name: "Carrot Walnut Snack Cake", exact: true })
      .filter({ hasNot: page.locator(".recipe-card__parent") })
      .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
      .click();
    const sourceRecipeUrl = page.url();
    const createdDraft = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/recipe-drafts",
    );
    await page
      .getByRole("button", { name: "Make your own version", exact: true })
      .click();
    const draftId = String(
      ((await (await createdDraft).json()) as { id: string }).id,
    );
    expect(draftId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(page).toHaveURL(sourceRecipeUrl);
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Opening your recipe…", { exact: true }),
    ).toHaveCount(0);

    const draftTitle = `Acceptance trusted-request carrot cake ${runId}`;
    const draftDescription =
      "A carefully preserved draft around a reviewed ingredient.";
    const draftInstruction =
      "Heat the oven, prepare the pan, and keep this edited instruction intact.";
    await page.getByLabel("Title", { exact: true }).fill(draftTitle);
    await page
      .getByLabel("Description", { exact: true })
      .fill(draftDescription);
    await page.getByLabel("Makes", { exact: true }).fill("6");

    const sugarLabel = "Ingredient 3";
    const rejectedLabel = "Ingredient 5";
    const walnutLabel = "Ingredient 6";
    const pendingLabel = "Ingredient 7";
    const sugarRow = page.getByRole("group", { name: sugarLabel, exact: true });
    const rejectedRow = page.getByRole("group", {
      name: rejectedLabel,
      exact: true,
    });
    const walnutRow = page.getByRole("group", {
      name: walnutLabel,
      exact: true,
    });
    const pendingRow = page.getByRole("group", {
      name: pendingLabel,
      exact: true,
    });
    const eggRow = page.getByRole("group", {
      name: "Ingredient 4",
      exact: true,
    });
    await sugarRow
      .getByRole("button", {
        name: "Edit amount for ingredient 3",
        exact: true,
      })
      .click();
    const sugarAmountEditor = sugarRow.getByRole("dialog", {
      name: "Amount for ingredient 3",
      exact: true,
    });
    await sugarAmountEditor
      .getByRole("textbox", { name: "Amount", exact: true })
      .fill("135");
    const selectedSugarUnitId = await sugarAmountEditor
      .getByRole("combobox", { name: "Unit", exact: true })
      .inputValue();
    await sugarAmountEditor
      .getByRole("button", { name: "Done", exact: true })
      .click();
    await walnutRow
      .getByRole("button", {
        name: "Edit amount for ingredient 6",
        exact: true,
      })
      .click();
    const walnutAmountEditor = walnutRow.getByRole("dialog", {
      name: "Amount for ingredient 6",
      exact: true,
    });
    await walnutAmountEditor
      .getByRole("textbox", { name: "Amount", exact: true })
      .fill("95");
    const selectedWalnutUnitId = await walnutAmountEditor
      .getByRole("combobox", { name: "Unit", exact: true })
      .inputValue();
    await walnutAmountEditor
      .getByRole("button", { name: "Done", exact: true })
      .click();
    await page
      .getByLabel("Instruction", { exact: true })
      .first()
      .fill(draftInstruction);

    const expectDraftPreserved = async (): Promise<void> => {
      await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
        draftTitle,
      );
      await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
        draftDescription,
      );
      await expect(page.getByLabel("Makes", { exact: true })).toHaveValue(
        "6",
      );
      await sugarRow
        .getByRole("button", {
          name: "Edit amount for ingredient 3",
          exact: true,
        })
        .click();
      const persistedSugarAmount = sugarRow.getByRole("dialog", {
        name: "Amount for ingredient 3",
        exact: true,
      });
      await expect(
        persistedSugarAmount.getByRole("textbox", {
          name: "Amount",
          exact: true,
        }),
      ).toHaveValue("135");
      await expect(
        persistedSugarAmount
          .getByRole("combobox", { name: "Unit", exact: true })
          .locator("option:checked"),
      ).toHaveText("gram (g)");
      await persistedSugarAmount
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await walnutRow
        .getByRole("button", {
          name: "Edit amount for ingredient 6",
          exact: true,
        })
        .click();
      const persistedWalnutAmount = walnutRow.getByRole("dialog", {
        name: "Amount for ingredient 6",
        exact: true,
      });
      await expect(
        persistedWalnutAmount.getByRole("textbox", {
          name: "Amount",
          exact: true,
        }),
      ).toHaveValue("95");
      await expect(
        persistedWalnutAmount
          .getByRole("combobox", { name: "Unit", exact: true })
          .locator("option:checked"),
      ).toHaveText("gram (g)");
      await persistedWalnutAmount
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await expect(
        page.getByLabel("Instruction", { exact: true }).first(),
      ).toHaveValue(draftInstruction);
      await expect(eggRow.getByText("Egg", { exact: true })).toBeVisible();
      await eggRow
        .getByRole("button", {
          name: "Edit amount for ingredient 4",
          exact: true,
        })
        .click();
      const eggAmountEditor = eggRow.getByRole("dialog", {
        name: "Amount for ingredient 4",
        exact: true,
      });
      await expect(
        eggAmountEditor.getByRole("textbox", { name: "Amount", exact: true }),
      ).toHaveValue("2");
      await eggAmountEditor
        .getByRole("button", { name: "Done", exact: true })
        .click();
    };

    const submitFromPicker = async (
      row: Locator,
      proposedName: string,
      context: string,
    ): Promise<CreatedRequest> => {
      const input = row.getByRole("combobox", {
        name: "Ingredient",
        exact: true,
      });
      await input.fill(proposedName);
      const requestAction = row.getByRole("button", {
        name: "Request missing ingredient",
        exact: true,
      });
      await expect(requestAction).toBeVisible();
      await activateWithKeyboard(page, requestAction);
      const requestDialog = page.getByRole("dialog", {
        name: "Request a missing ingredient",
        exact: true,
      });
      await expect(requestDialog.getByLabel("Proposed ingredient name")).toBeFocused();
      await requestDialog.getByLabel("Short context (optional)").fill(context);
      const submitted = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/ingredient-requests",
      );
      await requestDialog.getByRole("button", { name: "Submit catalog request" }).click();
      const response = await submitted;
      expect(response.status(), await response.text()).toBe(201);
      await expect(input).toHaveValue(proposedName);
      await expect(row.getByRole("status")).toContainText("Pending review");
      return (await response.json()) as CreatedRequest;
    };

    const approved = await submitFromPicker(
      walnutRow,
      approvedName,
      "Alice wants to use this reviewed leaf in a recipe draft.",
    );
    const duplicate = await submitFromPicker(
      sugarRow,
      duplicateName,
      "Alice thinks this garnish is the cataloged pecan.",
    );
    const rejected = await submitFromPicker(
      rejectedRow,
      rejectedName,
      "Alice cannot identify this sprig precisely.",
    );
    const pending = await submitFromPicker(
      pendingRow,
      pendingName,
      "Alice is still waiting for a curator decision.",
    );
    await expectDraftPreserved();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();

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

    await applyAcceptanceMember(page, "alice");
    await page.goto(`/recipes/drafts/${draftId}`);
    await expectDraftPreserved();

    const approvedInput = walnutRow.getByRole("combobox", {
      name: "Ingredient",
      exact: true,
    });
    await expect(approvedInput).toHaveValue(approvedName);
    await approvedInput.focus();
    const approvedOption = walnutRow
      .getByRole("listbox", { name: "Ingredient suggestions" })
      .getByRole("option", {
        name: `${approvedCanonical} Approved from your ingredient request`,
        exact: true,
      });
    await expect(approvedOption).toBeVisible();
    await activateWithKeyboard(page, approvedOption);
    await expect(approvedInput).toBeFocused();
    await expect(approvedInput).toHaveValue(approvedCanonical);

    const duplicateInput = sugarRow.getByRole("combobox", {
      name: "Ingredient",
      exact: true,
    });
    await expect(duplicateInput).toHaveValue(duplicateName);
    await duplicateInput.focus();
    const duplicateOption = sugarRow
      .getByRole("listbox", { name: "Ingredient suggestions" })
      .getByRole("option", {
        name: "Pecan Approved from your ingredient request",
        exact: true,
      });
    await activateWithKeyboard(page, duplicateOption);
    await expect(duplicateInput).toHaveValue("Pecan");

    const rejectedInput = rejectedRow.getByRole("combobox", {
      name: "Ingredient",
      exact: true,
    });
    await expect(rejectedInput).toHaveValue(rejectedName);
    await expect(rejectedRow.getByRole("status")).toContainText("Not approved");
    await rejectedInput.focus();
    await expect(
      rejectedRow.getByRole("button", {
        name: "Request missing ingredient",
        exact: true,
      }),
    ).toBeVisible();
    await expect(rejectedRow.getByRole("option")).toHaveCount(0);

    const pendingInput = pendingRow.getByRole("combobox", {
      name: "Ingredient",
      exact: true,
    });
    await expect(pendingInput).toHaveValue(pendingName);
    await expect(pendingRow.getByRole("status")).toContainText(
      "Pending review",
    );
    await pendingInput.focus();
    const pendingResults = pendingRow.getByRole("region", {
      name: "Pending ingredient requests",
    });
    await expect(pendingResults).toContainText(pendingName);
    await expect(pendingResults).toContainText(
      "Pending review · not available yet",
    );
    await expect(pendingRow.getByRole("option")).toHaveCount(0);
    await expect(
      pendingRow.getByRole("button", {
        name: "Request missing ingredient",
        exact: true,
      }),
    ).toBeVisible();

    await expect(
      page.getByText("Selected ingredient", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /use a requested ingredient/i }),
    ).toHaveCount(0);
    await expectDraftPreserved();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await expectNoAccessibilityViolations(page);

    const draftRequest = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        /\/api\/recipe-drafts\/[0-9a-f-]+$/i.test(
          new URL(request.url()).pathname,
        ),
    );
    const draftResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        /\/api\/recipe-drafts\/[0-9a-f-]+$/i.test(
          new URL(response.url()).pathname,
        ),
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const payload = (await draftRequest).postDataJSON() as {
      description: string | null;
      ingredients: Array<{
        selection: {
          kind: string;
          ingredient_id?: string;
          ingredient_request_id?: string;
          display_name?: string;
        };
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
    const rejectedRequest = payload.ingredients.find(
      (item) => item.selection.ingredient_request_id === rejected.id,
    );
    const pendingRequest = payload.ingredients.find(
      (item) => item.selection.ingredient_request_id === pending.id,
    );
    expect(approvedReplacement?.selection).toMatchObject({
      ingredient_id: approvedReview.resolved_ingredient_id,
      kind: "catalog",
    });
    expect(duplicateReplacement?.selection).toMatchObject({
      ingredient_id: pecan.id,
      kind: "catalog",
    });
    expect(rejectedRequest?.selection).toEqual({
      ingredient_request_id: rejected.id,
      kind: "request",
    });
    expect(pendingRequest?.selection).toEqual({
      ingredient_request_id: pending.id,
      kind: "request",
    });
    expect(approvedReplacement?.measure).toMatchObject({
      kind: "exact",
      unit_id: selectedWalnutUnitId,
      value: "95",
    });
    expect(duplicateReplacement?.measure).toMatchObject({
      kind: "exact",
      unit_id: selectedSugarUnitId,
      value: "135",
    });
    expect(payload.instructions[0]).toMatchObject({ text: draftInstruction });
    const serializedPayload = JSON.stringify(payload);
    for (const unsafeValue of [
      approvedName,
      duplicateName,
      rejectedName,
      pendingName,
    ]) {
      expect(serializedPayload).not.toContain(unsafeValue);
    }
    expect((await draftResponse).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      draftTitle,
    );
    await expect(
      page
        .getByRole("group", { name: walnutLabel, exact: true })
        .getByRole("combobox", { name: "Ingredient", exact: true }),
    ).toHaveValue(approvedCanonical);
    await expect(
      page
        .getByRole("group", { name: sugarLabel, exact: true })
        .getByRole("combobox", { name: "Ingredient", exact: true }),
    ).toHaveValue("Pecan");
  });
});
