import { expect, type Locator, type Page } from "@playwright/test";

export async function activateWithKeyboard(
  page: Page,
  control: Locator,
): Promise<void> {
  await reachWithKeyboard(page, control);
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");
}

export async function reachWithKeyboard(page: Page, control: Locator): Promise<void> {
  for (let step = 0; step < 80; step += 1) {
    if (
      await control.evaluate(
        (element) => element === element.ownerDocument.activeElement,
      )
    ) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(
    "The expected control was not reachable through keyboard navigation.",
  );
}

export function carrotRootCard(page: Page): Locator {
  return page.getByRole("article", {
    name: "Carrot Walnut Snack Cake",
    exact: true,
  });
}

export async function openCarrotRoot(page: Page): Promise<string> {
  await page.goto("/recipes?q=carrot");
  await carrotRootCard(page)
    .getByRole("link", { name: "Carrot Walnut Snack Cake", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Carrot Walnut Snack Cake", level: 1 }),
  ).toBeVisible();

  const match = new URL(page.url()).pathname.match(/^\/recipes\/([^/]+)$/);
  if (!match) {
    throw new Error("Could not read the current recipe version identifier.");
  }
  return decodeURIComponent(match[1]);
}

export async function expectCarrotComparisonToExplainItsChanges(page: Page) {
  const summary = page.getByRole("list", { name: "Changes at a glance" });
  await expect(summary).toBeVisible();
  await expect(
    summary.getByText("Use 100 g Pecan instead of 100 g Walnut.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    summary.getByText("Change White sugar from 180 g to 140 g.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", {
      name: "Use Pecan instead of Walnut",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", {
      name: "Change White sugar from 180 g to 140 g",
      exact: true,
    }),
  ).toBeVisible();

  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(
    /\bversion\s+\d+\b|catalog name|ingredient \d+:|structured cooking actions|(^|\n)ingredient inputs changed($|\n)|(^|\n)actions changed($|\n)/im,
  );
  expect(visibleText).not.toMatch(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  );

  return summary;
}
