import { expect, type Page } from "@playwright/test";

const UUID_SEGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const exactRecipePathPattern = new RegExp(
  `^/recipes/(${UUID_SEGMENT})$`,
  "i",
);
const currentRecipePathPattern = new RegExp(
  `^/recipes/current/(${UUID_SEGMENT})$`,
  "i",
);

export const publicRecipeDetailPathPattern = new RegExp(
  `^/recipes/(?:current/)?${UUID_SEGMENT}$`,
  "i",
);

export async function exactRecipeVersionId(
  page: Page,
  location: string = page.url(),
): Promise<string> {
  const pathname = new URL(location, page.url()).pathname;
  const exactMatch = pathname.match(exactRecipePathPattern);
  if (exactMatch) return exactMatch[1];

  const currentMatch = pathname.match(currentRecipePathPattern);
  if (!currentMatch) {
    throw new Error(`Could not resolve a public recipe from ${pathname}.`);
  }

  const stableRecipeId = currentMatch[1];
  const response = await page.request.get(
    `/api/recipes/current/${encodeURIComponent(stableRecipeId)}`,
  );
  if (!response.ok()) {
    throw new Error(
      `Could not resolve the current recipe version (status ${response.status()}).`,
    );
  }
  const body = (await response.json()) as {
    id?: unknown;
    is_current?: unknown;
    recipe_id?: unknown;
  };
  expect(body.recipe_id).toBe(stableRecipeId);
  expect(body.is_current).toBe(true);
  expect(body.id).toMatch(new RegExp(`^${UUID_SEGMENT}$`, "i"));
  return body.id as string;
}
