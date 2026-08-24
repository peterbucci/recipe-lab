import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

import {
  type MemberName,
  useAcceptanceMember as applyAcceptanceMember,
} from "./acceptance-session";

const acceptanceEnabled =
  process.env.MVP_ACCEPTANCE === "1" &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

interface CreatedRequest {
  id: string;
  proposed_name: string;
}

async function memberPost(
  page: Page,
  memberName: MemberName,
  path: string,
  payload: Record<string, unknown>,
): Promise<APIResponse> {
  const member = await applyAcceptanceMember(page, memberName);
  return page.request.post(new URL(path, baseUrl).toString(), {
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

test.describe("ingredient curator acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    !acceptanceEnabled,
    "Catalog review requires the isolated, freshly seeded acceptance database.",
  );

  test("reviews requests through the curator-only real-stack workspace", async ({ page }) => {
    const approvedName = "Acceptance sapphire herb";
    const approvedAlias = "Acceptance blue herb";
    const rejectedName = "Acceptance amber herb";
    const duplicateName = "Lapis garnish";
    const staleName = "Acceptance stale herb";

    const approvedRequest = await submitRequest(
      page,
      approvedName,
      "A distinct herb proposed by the acceptance author.",
    );
    const rejectedRequest = await submitRequest(
      page,
      rejectedName,
      "The author could not provide a precise botanical identity.",
    );
    const duplicateRequest = await submitRequest(
      page,
      duplicateName,
      "This may match the sapphire herb request.",
    );
    const staleRequest = await submitRequest(
      page,
      staleName,
      "Used to prove that two terminal decisions cannot be applied.",
    );

    await applyAcceptanceMember(page, "curator");
    await page.goto("/");
    await page.getByLabel("Account menu for Casey Curator").click();
    await page.getByRole("link", { name: "Review ingredient requests" }).click();
    await expect(
      page.getByRole("heading", { name: "Review ingredient requests.", level: 1 }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page);

    const queueItemFor = (proposedName: string) =>
      page.getByRole("button").filter({
        has: page.getByText(proposedName, { exact: true }),
      });

    const approvedQueueItem = queueItemFor(approvedRequest.proposed_name);
    await approvedQueueItem.focus();
    await page.keyboard.press("Enter");
    const approvedHeading = page.getByRole("heading", {
      name: approvedName,
      level: 2,
    });
    await expect(approvedHeading).toBeVisible();
    await expect(approvedHeading).toBeFocused();
    await page.getByRole("button", { name: "Add alias" }).click();
    await page.getByLabel("Alias 1").fill(approvedAlias);
    await page.getByLabel("Decision reason").fill(
      "Reviewed as a distinct ingredient for the acceptance catalog.",
    );
    await page.getByLabel("Approval provenance").fill(
      "RCP-25A.1 isolated real-stack acceptance review.",
    );
    await page.getByRole("button", { name: "Save approve decision" }).click();
    await expect(
      page.getByText(`${approvedName} is now approved.`, { exact: true }),
    ).toBeVisible();

    const catalogSearch = await page.request.get(
      new URL(`/api/ingredients?q=${encodeURIComponent(approvedAlias)}`, baseUrl).toString(),
    );
    expect(catalogSearch.status()).toBe(200);
    const catalogPayload = (await catalogSearch.json()) as {
      items: Array<{ canonical_name: string }>;
    };
    expect(catalogPayload.items).toEqual([
      expect.objectContaining({ canonical_name: approvedName }),
    ]);

    await queueItemFor(rejectedRequest.proposed_name).click();
    await page.getByRole("radio", { name: /Reject/i }).check();
    await page.getByLabel("Decision reason").fill(
      "Rejected because the proposal is not specific enough for the catalog.",
    );
    await page.getByRole("button", { name: "Save reject decision" }).click();
    await expect(
      page.getByText(`${rejectedName} is now rejected.`, { exact: true }),
    ).toBeVisible();

    await queueItemFor(duplicateRequest.proposed_name).click();
    await page.getByRole("radio", { name: /Duplicate/i }).check();
    const searchedDuplicateTarget = page.getByRole("radio", {
      name: new RegExp(`${approvedName}.*Existing catalog ingredient`, "i"),
    });
    await expect(searchedDuplicateTarget).toHaveCount(0);
    await page.getByLabel("Search duplicate targets").fill(approvedName);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText(/possible duplicate targets? found/i)).toBeVisible();
    await searchedDuplicateTarget.check();
    await page.getByLabel("Decision reason").fill(
      "The approved sapphire herb identity already covers this proposal.",
    );
    await page.getByRole("button", { name: "Save duplicate decision" }).click();
    await expect(
      page.getByText(`${duplicateName} is now duplicate.`, { exact: true }),
    ).toBeVisible();

    await queueItemFor(staleRequest.proposed_name).click();
    const staleCanonical = page.getByLabel("Reviewed canonical name");
    const staleReason = page.getByLabel("Decision reason");
    const staleProvenance = page.getByLabel("Approval provenance");
    await staleCanonical.fill("Acceptance reviewed stale herb");
    await staleReason.fill("This text must survive the stale-decision conflict.");
    await staleProvenance.fill("Acceptance provenance that must remain in the form.");

    const outOfBandReview = await memberPost(
      page,
      "curator",
      `/api/ingredient-requests/${staleRequest.id}/review`,
      {
        decision: "reject",
        reason: "A concurrent curator rejected this proposal first.",
      },
    );
    expect(outOfBandReview.status(), await outOfBandReview.text()).toBe(200);
    await page.getByRole("button", { name: "Save approve decision" }).click();
    await expect(
      page.getByText(/changed while you were reviewing it.*entered review is still here/i),
    ).toBeVisible();
    await expect(staleCanonical).toHaveValue("Acceptance reviewed stale herb");
    await expect(staleReason).toHaveValue(
      "This text must survive the stale-decision conflict.",
    );
    await expect(staleProvenance).toHaveValue(
      "Acceptance provenance that must remain in the form.",
    );
    await page.getByRole("button", { name: "Load current request" }).click();
    await expect(page.getByRole("heading", { name: "Recorded decision" })).toBeVisible();
    await expect(page.getByText("Rejected", { exact: true }).last()).toBeVisible();
    await expect(staleCanonical).toHaveValue("Acceptance reviewed stale herb");

    await page.getByRole("button", { name: "Approved", exact: true }).click();
    await expect(
      queueItemFor(approvedName),
    ).toBeVisible();
    await page.getByRole("button", { name: "Rejected", exact: true }).click();
    await expect(
      queueItemFor(rejectedName),
    ).toBeVisible();
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    await expect(
      queueItemFor(duplicateName),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await expectNoAccessibilityViolations(page);

    await applyAcceptanceMember(page, "bob");
    await page.goto("/");
    await page.getByLabel("Account menu for Bob Cook").click();
    await expect(
      page.getByRole("link", { name: "Review ingredient requests" }),
    ).toHaveCount(0);

    const curatorReads: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        /\/api\/ingredient-requests(?:\?|\/)/.test(request.url())
      ) {
        curatorReads.push(request.url());
      }
    });
    await page.goto("/catalog/ingredient-requests");
    await expect(
      page.getByRole("heading", { name: "We couldn’t find that page.", level: 1 }),
    ).toBeVisible();
    expect(curatorReads).toEqual([]);

    const forbiddenQueue = await page.request.get(
      new URL("/api/ingredient-requests?status=pending&page=1&page_size=20", baseUrl).toString(),
    );
    expect(forbiddenQueue.status()).toBe(403);

    await page.context().clearCookies();
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "Review ingredient requests" }),
    ).toHaveCount(0);

    const anonymousCuratorReads: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        /\/api\/ingredient-requests(?:\?|\/)/.test(request.url())
      ) {
        anonymousCuratorReads.push(request.url());
      }
    });
    await page.goto("/catalog/ingredient-requests");
    await expect(
      page.getByRole("heading", { name: "We couldn’t find that page.", level: 1 }),
    ).toBeVisible();
    expect(anonymousCuratorReads).toEqual([]);

    const anonymousQueue = await page.request.get(
      new URL("/api/ingredient-requests?status=pending&page=1&page_size=20", baseUrl).toString(),
    );
    expect(anonymousQueue.status()).toBe(401);
  });
});
