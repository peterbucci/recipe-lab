import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type MockSession =
  | { status: "anonymous" }
  | {
      status: "onboarding_required" | "authenticated";
      user: { id: string; display_name: string; handle: string | null };
    };

const aliceSession: MockSession = {
  status: "authenticated",
  user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
};

async function mockSession(page: Page, readSession: () => MockSession) {
  await page.route(/\/api\/auth\/session(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readSession()),
    });
  });
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("keeps browsing anonymous and starts sign-in with a keyboard", async ({ page }) => {
  await mockSession(page, () => ({ status: "anonymous" }));
  await page.goto("/");

  const signIn = page.getByRole("link", { name: "Sign in", exact: true });
  await expect(signIn).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore recipes", exact: true }).first()).toBeVisible();
  await signIn.focus();
  await expect(signIn).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/sign-in");
  await expect(page).toHaveTitle("Sign in · Recipe Lab");
  await expect(page.getByRole("heading", { name: "Sign in to Recipe Lab" })).toBeVisible();
  await expect(page.getByText(/sign in to save and rate recipes/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Keep browsing" })).toHaveAttribute(
    "href",
    "/recipes",
  );
  await expectNoSeriousAccessibilityViolations(page);
});

test("opens the signed-in account menu and signs out on a phone", async ({ page }) => {
  let session: MockSession = aliceSession;
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page, () => session);
  await page.route("**/api/auth/logout", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-value");
    session = { status: "anonymous" };
    await route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/");
  await page.evaluate(() => {
    document.cookie = "recipe_lab_csrf=csrf-value; Path=/; SameSite=Lax";
  });

  const accountMenu = page.getByLabel("Account menu for Alice Cook");
  await expect(accountMenu).toBeVisible();
  await accountMenu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("@alice", { exact: true })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("validates onboarding and completes account setup", async ({ page }) => {
  let session: MockSession = {
    status: "onboarding_required",
    user: { id: "cook-id", display_name: "Alice Cook", handle: null },
  };
  await mockSession(page, () => session);
  await page.route("**/api/auth/session/profile", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-value");
    expect(route.request().postDataJSON()).toEqual({
      display_name: "Alice B. Cook",
      handle: "alice_cook",
    });
    session = {
      status: "authenticated",
      user: { id: "cook-id", display_name: "Alice B. Cook", handle: "alice_cook" },
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session),
    });
  });
  await page.goto("/onboarding?return_to=%2F");
  await page.evaluate(() => {
    document.cookie = "recipe_lab_csrf=csrf-value; Path=/; SameSite=Lax";
  });

  await page.getByLabel("Handle").fill("-a");
  await page.getByRole("button", { name: "Finish account setup" }).click();
  await expect(page.getByText("Handle must be between 3 and 30 characters.")).toBeVisible();

  await page.getByLabel("Display name").fill("Alice B. Cook");
  await page.getByLabel("Handle").fill("Alice_Cook");
  await page.getByRole("button", { name: "Finish account setup" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByLabel("Account menu for Alice B. Cook")).toBeVisible();
});

test("shows a safe callback error without reflecting provider input", async ({ page }) => {
  await mockSession(page, () => ({ status: "anonymous" }));
  await page.goto("/auth/callback?error=provider-secret-value");

  await expect(page.getByRole("heading", { name: "Connecting your account" })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "We couldn’t sign you in." }),
  ).toContainText("Sign-in could not be completed. Please try again.");
  await expect(page.getByText("provider-secret-value")).toHaveCount(0);
});
