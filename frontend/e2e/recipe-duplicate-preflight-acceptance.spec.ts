import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

async function confirmPublicationRequirements(page: Page): Promise<void> {
  await page.getByRole("checkbox", { name: /agree to the community rules/i }).check();
  await page.getByRole("checkbox", { name: /right to share it/i }).check();
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
  const href = await page.getByRole("link", { name: title, exact: true }).getAttribute("href");
  const match = href ? new URL(href, page.url()).pathname.match(recipePathPattern) : null;
  if (!match?.[1]) {
    throw new Error(`Could not resolve the public recipe version for ${title}.`);
  }
  return match[1];
}

async function openCarrotFork(page: Page): Promise<string> {
  await page.goto("/recipes?q=carrot");
  const rootRecipeCard = page
    .getByRole("article", {
      name: "Carrot Walnut Snack Cake",
      exact: true,
    })
    .filter({ hasNot: page.locator(".recipe-card__parent") });
  await expect(rootRecipeCard).toHaveCount(1);
  await rootRecipeCard
    .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Make your own version", exact: true })
    .click();
  await page.getByRole("button", { name: "Create private draft", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/recipe-drafts\/[0-9a-f-]+$/i);
  return new URL(page.url()).pathname.split("/").at(-1)!;
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
            message: "The same canonical ingredients occur with the same multiplicity.",
          },
          {
            code: "proportionally_scaled_quantities",
            message:
              "All matched ingredient quantities use one consistent proportional scale.",
          },
          {
            code: "matching_structured_actions",
            message: "Structured actions, inputs, durations, and temperatures match.",
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
  }) => {
    await useAcceptanceMember(page, "alice");
    const draftId = await openCarrotFork(page);

    const preflightResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/recipe-drafts/${draftId}/duplicate-preflights`),
    );
    await confirmPublicationRequirements(page);
    await page.getByRole("button", { name: "Review and publish version", exact: true }).click();
    expect((await preflightResponse).status()).toBe(201);

    const review = page.getByRole("region", {
      name: "Your version matches the recipe it is based on",
    });
    await expect(review).toBeVisible();
    await expect(
      review.getByRole("heading", {
        name: "Your version matches the recipe it is based on",
      }),
    ).toBeFocused();
    await expect(review).toContainText(
      "Recipe Lab compared this saved draft with the recipe it is based on.",
    );
    await expect(review).not.toContainText(/canonical|direct parent|immutable/i);
    await expect(review).not.toContainText(/plagiar|copied|stolen/i);
    const continueButton = review.getByRole("button", {
      name: "Publish version anyway",
    });
    await expect(continueButton).toBeDisabled();

    await page.setViewportSize({ width: 390, height: 844 });
    const reviewBox = await review.boundingBox();
    expect(reviewBox).not.toBeNull();
    expect(reviewBox!.x).toBeGreaterThanOrEqual(0);
    expect(reviewBox!.x + reviewBox!.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
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
      name: /matches the recipe it is based on.*publish it anyway/i,
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
    expect((await publicationResponse).status()).toBe(201);
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/i);
  });

  test("shows a probable public candidate and preserves navigation to its recipe", async ({
    page,
  }) => {
    await useAcceptanceMember(page, "alice");
    const candidateId = await publicRecipeVersionId(
      page,
      PUBLIC_CANDIDATE_TITLE,
      "pecan carrot",
    );
    await openCarrotFork(page);
    await page.route("**/api/recipe-drafts/*/duplicate-preflights", async (route) => {
      expect(route.request().method()).toBe("POST");
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(probableResponse(candidateId)),
      });
    });
    await confirmPublicationRequirements(page);
    await page.getByRole("button", { name: "Review and publish version", exact: true }).click();
    const review = page.getByRole("region", { name: "Review similar recipes" });
    await expect(review).toBeVisible();
    await expect(
      review.getByRole("heading", { name: "Review similar recipes" }),
    ).toBeFocused();
    const candidateLink = review.getByRole("link", {
      name: new RegExp(PUBLIC_CANDIDATE_TITLE, "i"),
    });
    await expect(candidateLink).toHaveAttribute("href", `/recipes/${candidateId}`);
    await expect(candidateLink).toHaveAttribute("target", "_blank");

    const candidatePagePromise = page.waitForEvent("popup");
    await candidateLink.click();
    const candidatePage = await candidatePagePromise;
    await expect(candidatePage).toHaveURL(new RegExp(`/recipes/${candidateId}$`, "i"));
    await expect(
      candidatePage.getByRole("heading", { name: PUBLIC_CANDIDATE_TITLE, level: 1 }),
    ).toBeVisible();
    await candidatePage.close();
    await page.bringToFront();

    await review.getByRole("button", { name: "Keep editing" }).click();
    await expect(review).toHaveCount(0);
  });

  test("preserves a fork draft when its source becomes unavailable during publication", async ({ page }) => {
    await useAcceptanceMember(page, "alice");
    const candidateId = await publicRecipeVersionId(
      page,
      PUBLIC_CANDIDATE_TITLE,
      "pecan carrot",
    );
    await openCarrotFork(page);
    await page.route("**/api/recipe-drafts/*/duplicate-preflights", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(probableResponse(candidateId)),
      });
    });
    await page.route("**/api/recipe-drafts/*/publish", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "recipe_fork_source_unavailable",
            message: "The public source recipe is no longer available. Your private draft is unchanged.",
            issues: [],
          },
        }),
      });
    });

    const title = page.getByLabel("Title", { exact: true });
    await title.fill("Keep this disappearing-candidate draft");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Draft saved privately.", { exact: true })).toBeVisible();
    await confirmPublicationRequirements(page);
    await page.getByRole("button", { name: "Review and publish version", exact: true }).click();
    const review = page.getByRole("region", { name: "Review similar recipes" });
    await expect(review.getByRole("link", { name: new RegExp(PUBLIC_CANDIDATE_TITLE) })).toBeVisible();
    await review
      .getByRole("checkbox", { name: /publish my version anyway/i })
      .check();
    await review.getByRole("button", { name: "Publish version anyway" }).click();

    const alert = page.locator(".draft-publication__alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      "The recipe this version is based on is no longer available",
    );
    await expect(page.getByRole("link", { name: new RegExp(PUBLIC_CANDIDATE_TITLE) })).toHaveCount(
      0,
    );
    await expect(page.getByText(/Family Supper|secret@example\.test/i)).toHaveCount(0);
    await expect(title).toHaveValue("Keep this disappearing-candidate draft");

    await expect(page.getByRole("button", { name: "Check source and retry" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Check source page" })).toBeVisible();
    await expect(page.getByText(/Family Supper|secret@example\.test/i)).toHaveCount(0);
    await expect(title).toHaveValue("Keep this disappearing-candidate draft");
  });
});
