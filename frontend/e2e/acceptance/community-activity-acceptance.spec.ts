import { expect, test, type Page } from "@playwright/test";

import {
  type MemberName,
  useAcceptanceMember as applyAcceptanceMember,
} from "./acceptance-session";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

function apiUrl(path: string): string {
  return new URL(path, baseUrl).toString();
}

async function csrfHeaders(
  page: Page,
  memberName: MemberName,
): Promise<Record<string, string>> {
  const member = await applyAcceptanceMember(page, memberName);
  return {
    Accept: "application/json",
    Origin: baseUrl,
    "X-CSRF-Token": member.csrf_token,
  };
}

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

async function completeCommunityRecipeDraft(
  page: Page,
  title: string,
): Promise<void> {
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Makes", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Add ingredient", exact: true })
    .click();
  const ingredient = page.getByRole("group", {
    name: "Ingredient 1",
    exact: true,
  });
  await ingredient
    .getByRole("combobox", { name: "Ingredient", exact: true })
    .fill("Pecan");
  await ingredient
    .getByRole("listbox", { name: "Ingredient suggestions" })
    .getByRole("option", { name: /pecan/i })
    .first()
    .click();
  await ingredient
    .getByRole("button", { name: "Edit amount for ingredient 1", exact: true })
    .click();
  const amountEditor = ingredient.getByRole("dialog", {
    name: "Amount for ingredient 1",
    exact: true,
  });
  await amountEditor
    .getByRole("textbox", { name: "Amount", exact: true })
    .fill("1");
  await amountEditor
    .getByRole("combobox", { name: "Unit", exact: true })
    .selectOption({ label: "gram (g)" });
  await amountEditor.getByRole("button", { name: "Done", exact: true }).click();

  await page
    .getByRole("button", { name: "Add instruction", exact: true })
    .click();
  const step = page.getByRole("group", { name: "Step 1", exact: true });
  await step
    .getByLabel("Instruction", { exact: true })
    .fill("Knead the pecans into a small community test bite and serve.");
  await page
    .getByRole("tab", { name: "Cooking breakdown", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add cooking detail to Step 1", exact: true })
    .click();
  const action = page.getByRole("dialog", {
    name: "Cooking detail 1 for Step 1",
    exact: true,
  });
  await action
    .getByRole("combobox", { name: "Cooking action", exact: true })
    .selectOption({ label: "knead" });
  await action
    .getByRole("group", { name: "Ingredient inputs", exact: true })
    .getByRole("checkbox", { name: /Ingredient 1: Pecan/i })
    .check();
  await action.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Draft saved", exact: true }),
  ).toBeDisabled();
}

async function finishCommunityPublication(
  page: Page,
  draftId: string,
  kind: "original" | "version",
): Promise<string> {
  const preflightResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(`/api/recipe-drafts/${draftId}/duplicate-preflights`),
  );
  const publicationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/recipe-drafts/${draftId}/publish`),
  );

  await confirmPublicationRequirements(page);
  await page
    .getByRole("button", {
      name:
        kind === "original"
          ? "Review and publish"
          : "Review and publish version",
      exact: true,
    })
    .click();
  const preflight = await preflightResponse;
  expect(preflight.status(), await preflight.text()).toBe(201);
  const preflightBody = (await preflight.json()) as {
    classification?: unknown;
  };

  if (preflightBody.classification !== "distinct") {
    const review = page.getByRole("region", {
      name:
        kind === "version"
          ? "This version is very close to its source"
          : preflightBody.classification === "exact_duplicate"
            ? "This recipe is very close to another public recipe"
            : "This recipe is similar to another public recipe",
    });
    await review
      .getByRole("checkbox", {
        name:
          kind === "version"
            ? /closely matches its source.*publish it separately/i
            : /publish my recipe anyway/i,
      })
      .check();
    await review
      .getByRole("button", {
        name: kind === "version" ? "Publish version" : "Publish recipe",
        exact: true,
      })
      .click();
  }

  const publication = await publicationResponse;
  expect(publication.status(), await publication.text()).toBe(201);
  const body = (await publication.json()) as {
    location?: unknown;
    recipe_version_id?: unknown;
  };
  expect(body.recipe_version_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(body.location).toBe(`/recipes/${body.recipe_version_id}`);
  expect(publication.headers().location).toBe(body.location);
  await expect(page).toHaveURL(body.location as string);
  return body.recipe_version_id as string;
}

async function publishCommunityOriginal(
  page: Page,
  title: string,
): Promise<string> {
  await applyAcceptanceMember(page, "bob");
  await page.goto("/recipes/new");
  await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
  await completeCommunityRecipeDraft(page, title);
  const draftId = new URL(page.url()).pathname.split("/").at(-1)!;
  return finishCommunityPublication(page, draftId, "original");
}

async function publishCommunityVersion(
  page: Page,
  sourceId: string,
  title: string,
): Promise<string> {
  await page.goto(`/recipes/${sourceId}/fork`);
  await expect(page).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]+$/i);
  const draftId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Draft saved", exact: true }),
  ).toBeDisabled();
  return finishCommunityPublication(page, draftId, "version");
}

async function openMemberAccountPage(
  page: Page,
  memberName: MemberName,
  path: string,
  apiPath: string,
): Promise<void> {
  await applyAcceptanceMember(page, memberName);
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === apiPath;
  });
  await page.goto(path);
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
}

test.describe("cross-account community activity acceptance", () => {
  test.describe.configure({ retries: 0 });

  test("shows a followed cook's original and version without leaking private account views", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runId = crypto.randomUUID().slice(0, 8);
    const originalTitle = `Acceptance community original ${runId}`;
    const versionTitle = `Acceptance community version ${runId}`;
    const targetPath = "/api/cooks/acceptance_bob/follow";
    const aliceHeaders = await csrfHeaders(page, "alice");
    const reset = await page.request.delete(apiUrl(targetPath), {
      headers: {
        ...aliceHeaders,
        "Idempotency-Key": crypto.randomUUID(),
      },
    });
    expect(reset.status(), await reset.text()).toBe(200);

    try {
      await page.goto("/cooks/acceptance_bob");
      const followedResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "PUT" && url.pathname === targetPath
        );
      });
      await page
        .getByRole("button", { name: "Follow Bob Cook", exact: true })
        .click();
      expect((await followedResponse).status()).toBe(200);
      await expect(
        page.getByRole("button", { name: "Unfollow Bob Cook", exact: true }),
      ).toBeVisible();

      await openMemberAccountPage(
        page,
        "bob",
        "/account/followers",
        "/api/my/followers",
      );
      const followers = page.getByRole("list", { name: "Your followers" });
      const aliceFollower = followers
        .getByRole("listitem")
        .filter({ has: page.getByText("Alice Cook", { exact: true }) });
      await expect(aliceFollower).toHaveCount(1);
      await expect(
        aliceFollower.getByText("@acceptance_alice", { exact: true }),
      ).toBeVisible();
      await expect(
        aliceFollower.getByRole("link", {
          name: "View Alice Cook’s profile",
          exact: true,
        }),
      ).toHaveAttribute("href", "/cooks/acceptance_alice");

      const originalId = await publishCommunityOriginal(page, originalTitle);
      const versionId = await publishCommunityVersion(
        page,
        originalId,
        versionTitle,
      );
      expect(versionId).not.toBe(originalId);

      await openMemberAccountPage(
        page,
        "bob",
        "/account/activity",
        "/api/my/activity",
      );
      await expect(
        page.getByText("Loading your activity…", { exact: true }),
      ).toHaveCount(0);
      const accountActivity = page.getByRole("region", {
        name: "Account activity",
      });
      for (const title of [originalTitle, versionTitle]) {
        const publication = accountActivity
          .getByRole("listitem")
          .filter({ has: page.getByText(title, { exact: true }) });
        await expect(publication).toHaveCount(1);
        await expect(
          publication.getByText("Published recipe version", { exact: true }),
        ).toBeVisible();
      }

      await openMemberAccountPage(
        page,
        "alice",
        "/account/community-activity",
        "/api/my/community-activity",
      );
      await expect(
        page.getByText("Loading community activity…", { exact: true }),
      ).toHaveCount(0);
      const communityActivity = page.getByRole("region", {
        name: "Community activity",
      });
      const originalPublication = communityActivity
        .getByRole("listitem")
        .filter({
          has: page.getByRole("link", { name: originalTitle, exact: true }),
        });
      await expect(originalPublication).toHaveCount(1);
      await expect(originalPublication).toContainText(
        "Bob Cook published an original recipe.",
      );
      const versionPublication = communityActivity
        .getByRole("listitem")
        .filter({
          has: page.getByRole("link", { name: versionTitle, exact: true }),
        });
      await expect(versionPublication).toHaveCount(1);
      await expect(versionPublication).toContainText(
        "Bob Cook published a new version.",
      );

      await openMemberAccountPage(
        page,
        "curator",
        "/account/community-activity",
        "/api/my/community-activity",
      );
      await expect(
        page.getByText("Loading community activity…", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Community activity", level: 1 }),
      ).toBeVisible();
      await expect(page.getByText(originalTitle, { exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByText(versionTitle, { exact: true })).toHaveCount(
        0,
      );

      await openMemberAccountPage(
        page,
        "curator",
        "/account/followers",
        "/api/my/followers",
      );
      await expect(
        page.getByText("Loading your followers…", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Followers", level: 1 }),
      ).toBeVisible();
      await expect(page.getByText("Alice Cook", { exact: true })).toHaveCount(
        0,
      );

      await openMemberAccountPage(
        page,
        "curator",
        "/account/activity",
        "/api/my/activity",
      );
      await expect(
        page.getByText("Loading your activity…", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Activity", level: 1 }),
      ).toBeVisible();
      await expect(page.getByText(originalTitle, { exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByText(versionTitle, { exact: true })).toHaveCount(
        0,
      );
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
