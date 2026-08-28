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

interface DraftResponse {
  id: string;
  revision: number;
}

interface MyRecipePage {
  items: Array<
    | { kind: "draft"; draft: { id: string; title: string } }
    | { kind: "published"; recipe: { id: string; title: string } }
  >;
}

function apiUrl(path: string): string {
  return new URL(path, baseUrl).toString();
}

async function memberGet(page: Page, memberName: MemberName, path: string): Promise<APIResponse> {
  await applyAcceptanceMember(page, memberName);
  return page.request.get(apiUrl(path), { headers: { Accept: "application/json" } });
}

async function csrfHeaders(page: Page, memberName: MemberName): Promise<Record<string, string>> {
  const member = await applyAcceptanceMember(page, memberName);
  return {
    Accept: "application/json",
    Origin: baseUrl,
    "X-CSRF-Token": member.csrf_token,
  };
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("cook profiles and member recipe libraries acceptance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    !acceptanceEnabled,
    "Recipe-library acceptance requires the isolated, freshly seeded database.",
  );

  test("attributes public cards and isolates one member’s private recipe library", async ({ page }) => {
    const runId = crypto.randomUUID().slice(0, 8);
    const title = `Acceptance private library soup ${runId}`;
    let draft: DraftResponse | null = null;

    try {
      const headers = await csrfHeaders(page, "alice");
      const created = await page.request.post(apiUrl("/api/recipe-drafts"), {
        data: { source_version_id: null },
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      });
      expect(created.status(), await created.text()).toBe(201);
      draft = (await created.json()) as DraftResponse;

      const saved = await page.request.put(apiUrl(`/api/recipe-drafts/${draft.id}`), {
        data: {
          revision: draft.revision,
          title,
          description: null,
          servings: null,
          ingredients: [],
          instructions: [],
        },
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      });
      expect(saved.status(), await saved.text()).toBe(200);
      draft = (await saved.json()) as DraftResponse;

      const aliceLibrary = await memberGet(page, "alice", "/api/my/recipes?page=1&page_size=100");
      expect(aliceLibrary.status(), await aliceLibrary.text()).toBe(200);
      expect(((await aliceLibrary.json()) as MyRecipePage).items).toContainEqual(
        expect.objectContaining({ kind: "draft", draft: expect.objectContaining({ id: draft.id, title }) }),
      );

      await page.goto("/account/recipes");
      const aliceList = page.getByRole("list", { name: "My recipes" });
      const aliceDraftHeading = aliceList.getByRole("heading", { name: title, exact: true });
      const aliceDraftCard = aliceList.getByRole("article", { name: title, exact: true });
      await expect(aliceDraftCard).toHaveCount(1);
      await expect(aliceDraftHeading).toBeVisible();
      await expect(aliceDraftCard.getByText("Private", { exact: true })).toBeVisible();

      const bobLibrary = await memberGet(page, "bob", "/api/my/recipes?page=1&page_size=100");
      expect(bobLibrary.status(), await bobLibrary.text()).toBe(200);
      expect(((await bobLibrary.json()) as MyRecipePage).items).not.toContainEqual(
        expect.objectContaining({ kind: "draft", draft: expect.objectContaining({ id: draft.id }) }),
      );
      await page.goto("/account/recipes");
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);

      let perCardHydrationRequests = 0;
      page.on("request", (request) => {
        const pathname = new URL(request.url()).pathname;
        if (/^\/api\/cooks\//.test(pathname) || /^\/api\/recipes\/[0-9a-f-]{36}$/i.test(pathname)) {
          perCardHydrationRequests += 1;
        }
      });
      await page.goto("/recipes?q=carrot");
      const catalogAuthor = page.getByRole("link", { name: "Recipe Lab Demo Catalog" }).first();
      await expect(catalogAuthor).toHaveAttribute("href", "/cooks/recipe-lab-catalog");
      const versionCard = page
        .getByRole("article")
        .filter({
          has: page.locator(".recipe-card__parent"),
        })
        .first();
      await expect(versionCard).toBeVisible();
      await expect(page.locator(".version-badge")).toHaveCount(0);
      const parentAttribution = versionCard.locator(".recipe-card__parent");
      await expect(parentAttribution).toHaveText(
        /^Based on .+ by Recipe Lab Demo Catalog$/,
      );
      await expect(
        parentAttribution.getByRole("link", { name: "Recipe Lab Demo Catalog" }),
      ).toHaveAttribute("href", "/cooks/recipe-lab-catalog");
      expect(perCardHydrationRequests).toBe(0);

      await catalogAuthor.click();
      await expect(page).toHaveURL(/\/cooks\/recipe-lab-catalog(?:\?page=\d+)?$/);
      await expect(
        page.getByRole("heading", { name: "Recipe Lab Demo Catalog", level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole("list", { name: "Public recipes by Recipe Lab Demo Catalog" }),
      ).toBeVisible();
      await expect(page.getByText(/demo-catalog@recipe-lab\.invalid/i)).toHaveCount(0);
      await expectNoAccessibilityViolations(page);

      await applyAcceptanceMember(page, "alice");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/account/saved-recipes");
      await expect(page.getByRole("heading", { name: "Saved recipes", level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
      ).toBe(false);
      await expectNoAccessibilityViolations(page);
    } finally {
      if (draft) {
        const headers = await csrfHeaders(page, "alice");
        const discarded = await page.request.delete(
          apiUrl(`/api/recipe-drafts/${draft.id}?revision=${draft.revision}`),
          { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() } },
        );
        expect(discarded.status(), await discarded.text()).toBe(204);
      }
    }
  });
});
