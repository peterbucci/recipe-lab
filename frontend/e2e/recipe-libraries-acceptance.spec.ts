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

interface FollowState {
  cook_id: string;
  follower_count: number;
  following: boolean;
}

type MyRecipeLibraryView = "drafts" | "published" | "withdrawn";

interface MyRecipePage {
  total: number;
  items: Array<
    | {
        kind: "draft";
        draft: { id: string; title: string };
        source_recipe_title: string | null;
      }
    | {
        kind: "published";
        recipe: { id: string; title: string };
        visibility_state: "published" | "author_withdrawn" | "moderation_hidden";
      }
  >;
}

const libraryViewCopy: Record<
  MyRecipeLibraryView,
  { empty: string; heading: string; list: string }
> = {
  drafts: {
    empty: "You have no private drafts yet.",
    heading: "Private drafts",
    list: "Private recipe drafts",
  },
  published: {
    empty: "You have no published recipes yet.",
    heading: "Published recipes",
    list: "Published recipes",
  },
  withdrawn: {
    empty: "You have no withdrawn recipes.",
    heading: "Withdrawn recipes",
    list: "Withdrawn recipes",
  },
};

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

async function expectLibraryView(
  page: Page,
  view: MyRecipeLibraryView,
  total: number,
): Promise<void> {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/my/recipes" &&
      url.searchParams.get("view") === view
    );
  });
  await page.goto(`/account/recipes?view=${view}`);
  expect((await responsePromise).status()).toBe(200);
  await expect(page).toHaveURL(`/account/recipes?view=${view}`);
  await expect(page.getByRole("link", { name: new RegExp(`^${view}$`, "i") })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const copy = libraryViewCopy[view];
  if (total > 0) {
    await expect(page.getByRole("heading", { name: copy.heading, level: 2 })).toBeVisible();
    await expect(page.getByRole("list", { name: copy.list })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: copy.empty, level: 2 })).toBeVisible();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await expectNoAccessibilityViolations(page);
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

      const aliceDraftsResponse = await memberGet(
        page,
        "alice",
        "/api/my/recipes?view=drafts&page=1&page_size=100",
      );
      expect(aliceDraftsResponse.status(), await aliceDraftsResponse.text()).toBe(200);
      const aliceDrafts = (await aliceDraftsResponse.json()) as MyRecipePage;
      expect(aliceDrafts.items).toContainEqual(
        expect.objectContaining({
          kind: "draft",
          draft: expect.objectContaining({ id: draft.id, title }),
          source_recipe_title: null,
        }),
      );
      expect(aliceDrafts.items.every((item) => item.kind === "draft")).toBe(true);

      const alicePublishedResponse = await memberGet(
        page,
        "alice",
        "/api/my/recipes?view=published&page=1&page_size=100",
      );
      expect(alicePublishedResponse.status(), await alicePublishedResponse.text()).toBe(200);
      const alicePublished = (await alicePublishedResponse.json()) as MyRecipePage;
      expect(
        alicePublished.items.every(
          (item) =>
            item.kind === "published" &&
            (item.visibility_state === "published" ||
              item.visibility_state === "moderation_hidden"),
        ),
      ).toBe(true);
      expect(alicePublished.items).not.toContainEqual(
        expect.objectContaining({ kind: "draft", draft: expect.objectContaining({ id: draft.id }) }),
      );

      const aliceWithdrawnResponse = await memberGet(
        page,
        "alice",
        "/api/my/recipes?view=withdrawn&page=1&page_size=100",
      );
      expect(aliceWithdrawnResponse.status(), await aliceWithdrawnResponse.text()).toBe(200);
      const aliceWithdrawn = (await aliceWithdrawnResponse.json()) as MyRecipePage;
      expect(
        aliceWithdrawn.items.every(
          (item) => item.kind === "published" && item.visibility_state === "author_withdrawn",
        ),
      ).toBe(true);

      await page.setViewportSize({ width: 390, height: 844 });
      await expectLibraryView(page, "drafts", aliceDrafts.total);
      const aliceList = page.getByRole("list", { name: "Private recipe drafts" });
      const aliceDraftHeading = aliceList.getByRole("heading", { name: title, exact: true });
      const aliceDraftCard = aliceList.getByRole("article", { name: title, exact: true });
      await expect(aliceDraftCard).toHaveCount(1);
      await expect(aliceDraftHeading).toBeVisible();
      await expect(aliceDraftCard.getByText("Original", { exact: true })).toBeVisible();
      await expect(aliceDraftCard.locator(".member-library__draft-origin")).toHaveCount(0);
      await expect(aliceDraftCard.getByText("Original recipe", { exact: true })).toHaveCount(0);
      await expect(aliceDraftCard.getByRole("link", { name: "View source" })).toHaveCount(0);

      await expectLibraryView(page, "published", alicePublished.total);
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
      await expectLibraryView(page, "withdrawn", aliceWithdrawn.total);
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);

      const bobLibrary = await memberGet(
        page,
        "bob",
        "/api/my/recipes?view=drafts&page=1&page_size=100",
      );
      expect(bobLibrary.status(), await bobLibrary.text()).toBe(200);
      const bobDrafts = (await bobLibrary.json()) as MyRecipePage;
      expect(bobDrafts.items).not.toContainEqual(
        expect.objectContaining({ kind: "draft", draft: expect.objectContaining({ id: draft.id }) }),
      );
      await expectLibraryView(page, "drafts", bobDrafts.total);
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
      await page.goto("/account/recipes?view=saved");
      await expect(page.getByRole("heading", { name: "My recipes", level: 1 })).toBeVisible();
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

  test("follows another cook from their profile and updates follower stats", async ({
    page,
  }) => {
    const targetPath = "/api/cooks/acceptance_bob/follow";
    const aliceHeaders = await csrfHeaders(page, "alice");
    const reset = await page.request.delete(apiUrl(targetPath), {
      headers: {
        ...aliceHeaders,
        "Idempotency-Key": crypto.randomUUID(),
      },
    });
    expect(reset.status(), await reset.text()).toBe(200);
    const initial = (await reset.json()) as FollowState;
    expect(initial.following).toBe(false);
    const initialAliceStatsResponse = await page.request.get(
      apiUrl("/api/my/follow-stats"),
      { headers: { Accept: "application/json" } },
    );
    expect(
      initialAliceStatsResponse.status(),
      await initialAliceStatsResponse.text(),
    ).toBe(200);
    const initialAliceStats = (await initialAliceStatsResponse.json()) as {
      following_count: number;
    };

    try {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/cooks/acceptance_bob");
      await expect(
        page.getByRole("heading", { name: "Bob Cook", level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByText(
          `${initial.follower_count} ${
            initial.follower_count === 1 ? "follower" : "followers"
          }`,
          { exact: true },
        ),
      ).toBeVisible();

      const followedResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "PUT" &&
          url.pathname === targetPath
        );
      });
      await page
        .getByRole("button", { name: "Follow Bob Cook", exact: true })
        .click();
      expect((await followedResponse).status()).toBe(200);
      await expect(
        page.getByRole("button", { name: "Unfollow Bob Cook", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          `${initial.follower_count + 1} ${
            initial.follower_count + 1 === 1 ? "follower" : "followers"
          }`,
          { exact: true },
        ),
      ).toBeVisible();

      const aliceStats = await page.request.get(apiUrl("/api/my/follow-stats"), {
        headers: { Accept: "application/json" },
      });
      expect(aliceStats.status(), await aliceStats.text()).toBe(200);
      expect(
        ((await aliceStats.json()) as { following_count: number })
          .following_count,
      ).toBe(initialAliceStats.following_count + 1);

      await applyAcceptanceMember(page, "bob");
      await page.goto("/");
      const followersMetric = page
        .locator(".member-home-summary__metric")
        .filter({ has: page.getByText("Followers", { exact: true }) });
      await expect(followersMetric).toContainText(
        String(initial.follower_count + 1),
      );
      await expectNoAccessibilityViolations(page);
    } finally {
      const headers = await csrfHeaders(page, "alice");
      const cleanup = await page.request.delete(apiUrl(targetPath), {
        headers: {
          ...headers,
          "Idempotency-Key": crypto.randomUUID(),
        },
      });
      expect(cleanup.status(), await cleanup.text()).toBe(200);
    }
  });
});
