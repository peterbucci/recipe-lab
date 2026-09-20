import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const origin = process.env.PLAYWRIGHT_BASE_URL!;
type Draft = { id: string; revision: number };
type Member = { temporary: boolean; expires_at: string; user: { id: string; handle: string }; capabilities: { review_ingredient_requests: boolean; moderate_recipe_reports: boolean } };

async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(new URL(path, origin).toString());
  expect(response.status()).toBe(200);
  return response.json() as Promise<T>;
}

async function mutate<T>(page: Page, path: string, method: string, body: unknown, expected = 200): Promise<T> {
  // The browser supplies its own opaque session and CSRF cookie; no session
  // fixture, provider impersonation, raw trace, or credential artifact is used.
  const result = await page.evaluate(async ({ path, method, body, key }) => {
    const csrf = document.cookie.split("; ").find((entry) => entry.startsWith("recipe_lab_csrf="))?.split("=")[1];
    const response = await fetch(path, { method, credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf ?? ""), "Idempotency-Key": key },
      body: JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }, { path, method, body, key: randomUUID() });
  expect(result.status).toBe(expected);
  return result.data as T;
}

async function publish(page: Page, draft: Draft) {
  const evidence = await mutate<{ acknowledgement: { preflight_id: string; policy_version: string; result_digest: string }; classification: string }>(
    page, `/api/recipe-drafts/${draft.id}/duplicate-preflights`, "POST", { revision: draft.revision }, 201);
  return mutate<{ recipe_version_id: string; location: string }>(page, `/api/recipe-drafts/${draft.id}/publish`, "POST", {
    revision: draft.revision, community_rules_accepted: true, content_rights_confirmed: true,
    duplicate_review: { preflight_id: evidence.acknowledgement.preflight_id,
      policy_version: evidence.acknowledgement.policy_version, result_digest: evidence.acknowledgement.result_digest,
      decision: evidence.classification === "distinct" ? null : "continue" },
  }, 201);
}

test("independent visitors use real product permissions and immutable publication", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const otherContext = await browser.newContext({ baseURL: origin });
  const other = await otherContext.newPage();
  try {
    for (const visitor of [page, other]) {
      await visitor.goto("/sign-in?return_to=%2Frecipes%2Fnew");
      const entry = visitor.getByRole("button", { name: "Try the demo", exact: true });
      await expect(entry).toBeEnabled();
      await entry.focus();
      await expect(entry).toBeFocused();
      await entry.press("Enter");
      await expect(visitor).toHaveURL(/\/recipes\/drafts\/[0-9a-f-]{36}$/);
      await expect(visitor.getByRole("complementary", { name: "Temporary demo session" })).toBeVisible();
    }
    const alice = await read<Member>(page, "/api/auth/session");
    const bob = await read<Member>(other, "/api/auth/session");
    expect(alice.temporary && bob.temporary).toBe(true);
    expect(alice.user.id === bob.user.id).toBe(false);
    expect(alice.capabilities).toEqual({ review_ingredient_requests: false, moderate_recipe_reports: false });
    expect(bob.capabilities).toEqual(alice.capabilities);
    const aliceDraftId = new URL(page.url()).pathname.split("/").at(-1)!;
    const bobDraftId = new URL(other.url()).pathname.split("/").at(-1)!;
    expect((await other.request.get(new URL(`/api/recipe-drafts/${aliceDraftId}`, origin).toString())).status()).toBe(404);
    expect((await page.request.get(new URL(`/api/recipe-drafts/${bobDraftId}`, origin).toString())).status()).toBe(404);
    await mutate(other, `/api/recipe-drafts/${aliceDraftId}`, "PUT", { revision: 1, title: "Unauthorized" }, 404);

    const ingredients = await read<{ items: { id: string; canonical_name: string }[] }>(page, "/api/ingredients?q=pecan");
    const units = await read<{ items: { id: string; key: string }[] }>(page, "/api/measurement-units?semantic=ingredient_amount");
    const actions = await read<{ items: { id: string; key: string }[] }>(page, "/api/cooking-action-types");
    const ingredient = ingredients.items.find((item) => /pecan/i.test(item.canonical_name))!;
    const unit = units.items.find((item) => item.key === "g")!;
    const action = actions.items.find((item) => item.key === "mix")!;
    expect(Boolean(ingredient && unit && action)).toBe(true);
    const document = {
      title: `Sandbox pecan sample ${randomUUID().slice(0, 8)}`, servings: "2",
      ingredients: [{ ref: "pecan", selection: { kind: "catalog", ingredient_id: ingredient.id, display_name: ingredient.canonical_name }, measure: { kind: "exact", value: "137", unit_id: unit.id } }],
      instructions: [{ ref: "mix", text: "Mix and serve the fictional sample.", actions: [{ action_type_id: action.id, ingredient_refs: ["pecan"] }] }],
    };
    const saved = await mutate<Draft>(page, `/api/recipe-drafts/${aliceDraftId}`, "PUT", { ...document, revision: 1 });
    const original = await publish(page, saved);
    await page.goto(original.location);
    await expect(page.getByRole("heading", { level: 1, name: document.title })).toBeVisible();

    const fork = await mutate<Draft>(other, "/api/recipe-drafts", "POST", { draft_kind: "adaptation", source_version_id: original.recipe_version_id }, 201);
    const forkSaved = await mutate<Draft>(other, `/api/recipe-drafts/${fork.id}`, "PUT", { ...document, title: "Fictional visitor adaptation", revision: fork.revision });
    const adaptation = await publish(other, forkSaved);
    await other.goto(adaptation.location);
    await expect(other.getByRole("heading", { level: 1, name: "Fictional visitor adaptation" })).toBeVisible();

    const revision = await mutate<Draft>(page, "/api/recipe-drafts", "POST", { draft_kind: "revision", source_version_id: original.recipe_version_id }, 201);
    const revisionSaved = await mutate<Draft>(page, `/api/recipe-drafts/${revision.id}`, "PUT", { ...document, title: "Fictional revised sample", revision: revision.revision });
    const revised = await publish(page, revisionSaved);
    const originalSnapshot = await read<{ title: string }>(other, `/api/recipes/${original.recipe_version_id}`);
    expect(originalSnapshot.title).toBe(document.title);
    await read(other, `/api/recipes/${revised.recipe_version_id}/diff`);

    await mutate(other, `/api/recipes/${revised.recipe_version_id}/save`, "PUT", {});
    await mutate(other, `/api/recipes/${revised.recipe_version_id}/rating`, "PUT", { rating: 5 });
    await mutate(other, `/api/cooks/${alice.user.handle}/follow`, "PUT", {});
    await other.goto("/account/settings");
    await other.getByRole("tab", { name: "Danger zone" }).click();
    await expect(other.getByRole("heading", { name: "Temporary demo identity" })).toBeVisible();
    expect((await new AxeBuilder({ page: other }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await other.getByLabel(/Account menu for/).click();
    await other.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(other.getByRole("link", { name: "Sign in", exact: true }).first()).toBeVisible();
    expect((await read<{ status: string }>(other, "/api/auth/session")).status).toBe("anonymous");
    expect((await read<Member>(page, "/api/auth/session")).user.id === alice.user.id).toBe(true);
    expect((await other.request.get(new URL(`/api/recipe-drafts/${bobDraftId}`, origin).toString())).status()).toBe(401);
  } finally {
    await otherContext.close();
  }
});
