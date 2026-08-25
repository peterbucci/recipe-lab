import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { useAcceptanceMember } from "./acceptance-session";

test.describe("recipe duplicate preflight acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    process.env.MVP_ACCEPTANCE !== "1" ||
      process.env.ACCEPTANCE_DATABASE_ISOLATED !== "1",
    "Recipe duplicate acceptance requires the isolated, freshly seeded database.",
  );

  test("reviews and acknowledges a direct-parent structural match before creating", async ({
    page,
  }) => {
    await useAcceptanceMember(page, "alice");
    await page.goto("/recipes?q=carrot");
    await page
      .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Make your own version", exact: true })
      .click();

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
});
