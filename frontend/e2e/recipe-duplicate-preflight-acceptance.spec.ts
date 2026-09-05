import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test, type SourceDraftScope } from "./acceptance-draft-isolation";
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

const PREFLIGHT_ID = "77777777-7777-4777-8777-777777777777";
const RESULT_DIGEST = "a".repeat(64);
const PUBLIC_CANDIDATE_TITLE = "Lower-Sugar Pecan Carrot Cake";
const recipePathPattern = /^\/recipes\/([0-9a-f-]+)$/i;

async function publicRecipeVersionId(
  page: Page,
  title: string,
  query: string,
): Promise<string> {
  await page.goto(`/recipes?q=${encodeURIComponent(query)}`);
  const href = await page
    .getByRole("link", { name: title, exact: true })
    .getAttribute("href");
  const match = href
    ? new URL(href, page.url()).pathname.match(recipePathPattern)
    : null;
  if (!match?.[1]) {
    throw new Error(
      `Could not resolve the public recipe version for ${title}.`,
    );
  }
  return match[1];
}

async function openCarrotFork(page: Page, sourceDrafts: SourceDraftScope): Promise<string> {
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
  const sourceVersionId = new URL(sourceRecipeUrl).pathname.split("/").at(-1);
  if (!sourceVersionId) throw new Error("Could not resolve the source recipe.");
  await sourceDrafts.assertFresh("alice", sourceVersionId);
  await page
    .getByRole("button", { name: "Make your own version", exact: true })
    .click();
  await expect(page).toHaveURL(sourceRecipeUrl);
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Opening your recipe…", { exact: true }),
  ).toHaveCount(0);
  const draftId = await page.evaluate(async (sourceId) => {
    const query = new URLSearchParams({
      page: "1",
      page_size: "1",
      source_version_id: sourceId,
    });
    const response = await fetch(`/api/recipe-drafts?${query.toString()}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      items?: Array<{ id?: unknown }>;
    };
    return payload.items?.[0]?.id ?? null;
  }, sourceVersionId);
  if (typeof draftId !== "string" || !/^[0-9a-f-]{36}$/i.test(draftId)) {
    throw new Error("Could not resolve the active private version draft.");
  }
  return draftId;
}

function probableResponse(publicRecipeVersionId: string) {
  return {
    classification: "probable_duplicate",
    same_lineage_no_change: false,
    candidates: [
      {
        public_recipe_version_id: publicRecipeVersionId,
        title: PUBLIC_CANDIDATE_TITLE,
        classification: "probable_duplicate",
        score: "0.875000",
        reasons: [
          {
            code: "same_ingredient_multiset",
            message:
              "The same canonical ingredients occur with the same multiplicity.",
          },
          {
            code: "proportionally_scaled_quantities",
            message:
              "All matched ingredient quantities use one consistent proportional scale.",
          },
          {
            code: "matching_structured_actions",
            message:
              "Structured actions, inputs, durations, and temperatures match.",
          },
        ],
      },
    ],
    warnings: [],
    acknowledgement: {
      preflight_id: PREFLIGHT_ID,
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: RESULT_DIGEST,
      required: true,
      allowed_decisions: ["continue", "revise"],
    },
  };
}

test.describe("recipe duplicate preflight acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    process.env.MVP_ACCEPTANCE !== "1" ||
      process.env.ACCEPTANCE_DATABASE_ISOLATED !== "1",
    "Recipe duplicate acceptance requires the isolated, freshly seeded database.",
  );
  test("reviews and acknowledges a direct-parent structural match before publishing", async ({
    page,
    sourceDrafts,
  }) => {
    await useAcceptanceMember(page, "alice");
    const draftId = await openCarrotFork(page, sourceDrafts);

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
    expect((await preflightResponse).status()).toBe(201);

    const review = page.getByRole("region", {
      name: "This version is very close to its source",
    });
    await expect(review).toBeVisible();
    await expect(
      review.getByRole("heading", {
        name: "This version is very close to its source",
      }),
    ).toBeFocused();
    await expect(review).toContainText(
      "You can still publish it as a separate version if that’s intentional.",
    );
    await expect(review).not.toContainText(
      /canonical|direct parent|immutable/i,
    );
    await expect(review).not.toContainText(/plagiar|copied|stolen/i);
    const continueButton = review.getByRole("button", {
      name: "Publish version",
      exact: true,
    });
    await expect(continueButton).toBeDisabled();

    await page.setViewportSize({ width: 390, height: 844 });
    const reviewBox = await review.boundingBox();
    expect(reviewBox).not.toBeNull();
    expect(reviewBox!.x).toBeGreaterThanOrEqual(0);
    expect(reviewBox!.x + reviewBox!.width).toBeLessThanOrEqual(390);
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
    expect(
      accessibility.violations,
      JSON.stringify(
        accessibility.violations.map((violation) => ({
          id: violation.id,
          help: violation.help,
          targets: violation.nodes.map((node) => node.target),
        })),
        null,
        2,
      ),
    ).toEqual([]);

    const acknowledgement = review.getByRole("checkbox", {
      name: /closely matches its source.*publish it separately/i,
    });
    await acknowledgement.focus();
    await page.keyboard.press("Space");
    await expect(acknowledgement).toBeChecked();
    await expect(continueButton).toBeEnabled();
    const publicationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${draftId}/publish`),
    );
    await continueButton.focus();
    await page.keyboard.press("Enter");
    const publication = await publicationResponse;
    expect(publication.status()).toBe(201);
    const published = (await publication.json()) as {
      location?: unknown;
      recipe_version_id?: unknown;
    };
    expect(published.recipe_version_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(published.location).toBe(`/recipes/${published.recipe_version_id}`);
    expect(publication.headers().location).toBe(published.location);
    await expect(page).toHaveURL(published.location as string);
  });

  test("shows a probable public candidate and preserves navigation to its recipe", async ({
    page,
    sourceDrafts,
  }) => {
    await useAcceptanceMember(page, "alice");
    const candidateId = await publicRecipeVersionId(
      page,
      PUBLIC_CANDIDATE_TITLE,
      "pecan carrot",
    );
    await openCarrotFork(page, sourceDrafts);
    await page.route(
      "**/api/recipe-drafts/*/duplicate-preflights",
      async (route) => {
        expect(route.request().method()).toBe("POST");
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(probableResponse(candidateId)),
        });
      },
    );
    await confirmPublicationRequirements(page);
    await page
      .getByRole("button", { name: "Review and publish version", exact: true })
      .click();
    const review = page.getByRole("region", {
      name: "This version is similar to another public recipe",
    });
    await expect(review).toBeVisible();
    await expect(
      review.getByRole("heading", {
        name: "This version is similar to another public recipe",
      }),
    ).toBeFocused();
    const candidateLink = review.getByRole("link", {
      name: new RegExp(PUBLIC_CANDIDATE_TITLE, "i"),
    });
    await expect(candidateLink).toHaveAttribute(
      "href",
      `/recipes/${candidateId}`,
    );
    await expect(candidateLink).toHaveAttribute("target", "_blank");

    const candidatePagePromise = page.waitForEvent("popup");
    await candidateLink.click();
    const candidatePage = await candidatePagePromise;
    await expect(candidatePage).toHaveURL(
      new RegExp(`/recipes/${candidateId}$`, "i"),
    );
    await expect(
      candidatePage.getByRole("heading", {
        name: PUBLIC_CANDIDATE_TITLE,
        level: 1,
      }),
    ).toBeVisible();
    await candidatePage.close();
    await page.bringToFront();

    await review.getByRole("button", { name: "Keep editing" }).click();
    await expect(review).toHaveCount(0);
  });

  test("retries an unavailable similarity check without losing the draft", async ({
    page,
    sourceDrafts,
  }) => {
    await useAcceptanceMember(page, "alice");
    const draftId = await openCarrotFork(page, sourceDrafts);
    const title = page.getByLabel("Title", { exact: true });
    await title.fill("Keep this unavailable-review draft");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();

    const preflightKeys: string[] = [];
    await page.route(
      "**/api/recipe-drafts/*/duplicate-preflights",
      async (route) => {
        preflightKeys.push(route.request().headers()["idempotency-key"] ?? "");
        if (preflightKeys.length === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "duplicate_preflight_unavailable",
                message: "Private upstream detail",
                issues: [],
              },
            }),
          });
          return;
        }
        await route.continue();
      },
    );

    await confirmPublicationRequirements(page);
    await page
      .getByRole("button", { name: "Review and publish version", exact: true })
      .click();
    const alert = page.locator(".draft-publication__alert");
    await expect(alert).toContainText("Similar-recipes check unavailable");
    await expect(alert).toContainText(/similar recipes could not be checked/i);
    await expect(alert).toContainText(/draft is still here/i);
    await expect(
      page.getByRole("button", { name: "Check similar recipes again" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /publish without/i }),
    ).toHaveCount(0);
    await expect(title).toHaveValue("Keep this unavailable-review draft");

    const retryResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/api/recipe-drafts/${draftId}/duplicate-preflights`) &&
        response.status() === 201,
    );
    await page
      .getByRole("button", { name: "Check similar recipes again" })
      .click();
    await retryResponse;
    await expect(
      page.getByRole("region", {
        name: "This version is very close to its source",
      }),
    ).toBeVisible();
    expect(preflightKeys).toHaveLength(2);
    expect(preflightKeys[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(preflightKeys[1]).toBe(preflightKeys[0]);
    await expect(title).toHaveValue("Keep this unavailable-review draft");
  });

  test("preserves a fork draft when its source becomes unavailable during publication", async ({
    page,
    sourceDrafts,
  }) => {
    await useAcceptanceMember(page, "alice");
    const candidateId = await publicRecipeVersionId(
      page,
      PUBLIC_CANDIDATE_TITLE,
      "pecan carrot",
    );
    await openCarrotFork(page, sourceDrafts);
    await page.route(
      "**/api/recipe-drafts/*/duplicate-preflights",
      async (route) => {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(probableResponse(candidateId)),
        });
      },
    );
    await page.route("**/api/recipe-drafts/*/publish", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "recipe_fork_source_unavailable",
            message:
              "The public source recipe is no longer available. Your private draft is unchanged.",
            issues: [],
          },
        }),
      });
    });

    const title = page.getByLabel("Title", { exact: true });
    await title.fill("Keep this disappearing-candidate draft");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Draft saved", exact: true }),
    ).toBeDisabled();
    await confirmPublicationRequirements(page);
    await page
      .getByRole("button", { name: "Review and publish version", exact: true })
      .click();
    const review = page.getByRole("region", {
      name: "This version is similar to another public recipe",
    });
    await expect(
      review.getByRole("link", { name: new RegExp(PUBLIC_CANDIDATE_TITLE) }),
    ).toBeVisible();
    await review
      .getByRole("checkbox", { name: /publish my version anyway/i })
      .check();
    await review
      .getByRole("button", { name: "Publish version", exact: true })
      .click();

    const alert = page.locator(".draft-publication__alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      "The recipe this version is based on is no longer available",
    );
    await expect(
      page.getByRole("link", { name: new RegExp(PUBLIC_CANDIDATE_TITLE) }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Family Supper|secret@example\.test/i),
    ).toHaveCount(0);
    await expect(title).toHaveValue("Keep this disappearing-candidate draft");

    await expect(
      page.getByRole("button", { name: "Check source and retry" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Check source page" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Family Supper|secret@example\.test/i),
    ).toHaveCount(0);
    await expect(title).toHaveValue("Keep this disappearing-candidate draft");
  });
});
