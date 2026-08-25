import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

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

async function openCarrotFork(page: Page): Promise<void> {
  await page.goto("/recipes?q=carrot");
  await page
    .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Make your own version", exact: true })
    .click();
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
  test.skip(
    true,
    "Duplicate preflight is a publication concern deferred to RCP-27/RCP-28; RCP-26 Save draft never invokes it.",
  );

  test("reviews and acknowledges a direct-parent structural match before creating", async ({
    page,
  }) => {
    await useAcceptanceMember(page, "alice");
    await openCarrotFork(page);

    const preflightResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/duplicate-preflights"),
    );
    await page.getByRole("button", { name: "Create my version", exact: true }).click();
    expect((await preflightResponse).status()).toBe(201);

    const review = page.getByRole("region", {
      name: "This version keeps the same recipe structure",
    });
    await expect(review).toBeVisible();
    await expect(
      review.getByRole("heading", {
        name: "This version keeps the same recipe structure",
      }),
    ).toBeFocused();
    await expect(review).toContainText(/advisory/i);
    await expect(review).not.toContainText(/plagiar|copied|stolen/i);
    const continueButton = review.getByRole("button", {
      name: "Create my version anyway",
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
      name: /reviewed these advisory results/i,
    });
    await acknowledgement.focus();
    await page.keyboard.press("Space");
    await expect(acknowledgement).toBeChecked();
    await expect(continueButton).toBeEnabled();
    const decisionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/recipe-duplicate-preflights/") &&
        response.url().endsWith("/decision"),
    );
    const variantResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith("/variants"),
    );
    await continueButton.focus();
    await page.keyboard.press("Enter");
    expect((await decisionResponse).status()).toBe(201);
    expect((await variantResponse).status()).toBe(201);
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
    await page.route("**/api/recipes/*/duplicate-preflights", async (route) => {
      expect(route.request().method()).toBe("POST");
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(probableResponse(candidateId)),
      });
    });
    await page.route("**/api/recipe-duplicate-preflights/*/decision", async (route) => {
      const payload = route.request().postDataJSON() as { decision?: unknown };
      expect(payload.decision).toBe("revise");
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          preflight_id: PREFLIGHT_ID,
          decision: "revise",
          recorded_at: "2026-08-25T12:00:00Z",
        }),
      });
    });

    await page.getByRole("button", { name: "Create my version", exact: true }).click();
    const review = page.getByRole("region", { name: "Review similar recipe structures" });
    await expect(review).toBeVisible();
    await expect(
      review.getByRole("heading", { name: "Review similar recipe structures" }),
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

  test("removes a disappeared candidate and exposes only generic recovery", async ({ page }) => {
    await useAcceptanceMember(page, "alice");
    const candidateId = await publicRecipeVersionId(
      page,
      PUBLIC_CANDIDATE_TITLE,
      "pecan carrot",
    );
    await openCarrotFork(page);
    let preflightAttempts = 0;
    await page.route("**/api/recipes/*/duplicate-preflights", async (route) => {
      preflightAttempts += 1;
      if (preflightAttempts === 1) {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(probableResponse(candidateId)),
        });
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "duplicate_preflight_unavailable",
            message: "Private draft Family Supper was removed by owner secret@example.test.",
            issues: [{ private_recipe_title: "Family Supper" }],
          },
        }),
      });
    });
    await page.route("**/api/recipe-duplicate-preflights/*/decision", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "duplicate_preflight_stale",
            message: "Private draft Family Supper is no longer publicly readable.",
            issues: [{ owner_email: "secret@example.test" }],
          },
        }),
      });
    });

    const title = page.getByLabel("Title", { exact: true });
    await title.fill("Keep this disappearing-candidate draft");
    await page.getByRole("button", { name: "Create my version", exact: true }).click();
    const review = page.getByRole("region", { name: "Review similar recipe structures" });
    await expect(review.getByRole("link", { name: new RegExp(PUBLIC_CANDIDATE_TITLE) })).toBeVisible();
    await review
      .getByRole("checkbox", { name: /reviewed these advisory results/i })
      .check();
    await review.getByRole("button", { name: "Create my version anyway" }).click();

    const alert = page.locator(".variant-error-summary");
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await expect(page.getByRole("link", { name: new RegExp(PUBLIC_CANDIDATE_TITLE) })).toHaveCount(
      0,
    );
    await expect(page.getByText(/Family Supper|secret@example\.test/i)).toHaveCount(0);
    await expect(title).toHaveValue("Keep this disappearing-candidate draft");

    await page.getByRole("button", { name: "Create my version", exact: true }).click();
    const unavailable = page.getByRole("region", {
      name: "Similarity review could not be completed",
    });
    await expect(unavailable).toBeVisible();
    await expect(
      unavailable.getByRole("heading", {
        name: "Similarity review could not be completed",
      }),
    ).toBeFocused();
    await expect(unavailable).toContainText("does not mean your version is distinct");
    await expect(unavailable.getByRole("button", { name: "Retry similarity review" })).toBeVisible();
    await expect(
      unavailable.getByRole("button", { name: "Create without similarity review" }),
    ).toBeVisible();
    await expect(page.getByText(/Family Supper|secret@example\.test/i)).toHaveCount(0);
    await expect(title).toHaveValue("Keep this disappearing-candidate draft");
  });
});
