import { render } from "@testing-library/react";
import { vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../lib/auth-api";
import type { PublicCookProfilePage } from "../../lib/recipe-library-api";
import type { RecipeCardSummary } from "../../lib/recipe-api";
import { buildRecipeCardSummary } from "../../tests/support/builders/recipe";
import { AuthSessionProvider } from "./auth-session-provider";

const routerMocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

export const ALICE_ID = "11111111-1111-4111-8111-111111111111";
export const CATALOG_ID = "22222222-2222-4222-8222-222222222222";
export const ROOT_ID = "33333333-3333-4333-8333-333333333333";
export const FORK_ID = "44444444-4444-4444-8444-444444444444";
export const LINEAGE_ID = "55555555-5555-4555-8555-555555555555";
export const DRAFT_ID = "66666666-6666-4666-8666-666666666666";
export const ORIGINAL_DRAFT_ID = "77777777-7777-4777-8777-777777777777";

export const alice = {
  id: ALICE_ID,
  handle: "alice",
  display_name: "Alice Cook",
};
export const catalog = {
  id: CATALOG_ID,
  handle: "recipe-lab",
  display_name: "Recipe Lab catalog",
};

export function original(
  overrides: Partial<RecipeCardSummary> = {},
): RecipeCardSummary {
  return buildRecipeCardSummary({
    id: ROOT_ID,
    lineage_id: LINEAGE_ID,
    title: "Alice’s tomato soup",
    description: "A bright soup.",
    servings: "4.00",
    created_at: "2026-08-25T10:00:00Z",
    published_at: "2026-08-25T11:00:00Z",
    author: alice,
    average_rating: 4.5,
    rating_count: 2,
    save_count: 7,
    ...overrides,
  });
}

export function fork(): RecipeCardSummary {
  return original({
    id: FORK_ID,
    parent_version_id: ROOT_ID,
    version_number: 2,
    title: "Creamy tomato soup",
    average_rating: null,
    rating_count: 0,
    save_count: 3,
    parent: {
      id: ROOT_ID,
      version_number: 1,
      title: "Catalog tomato soup",
      author: catalog,
    },
  });
}

export function profile(
  overrides: Partial<PublicCookProfilePage> = {},
): PublicCookProfilePage {
  return {
    cook: alice,
    follower_count: 4,
    description: "A home cook sharing practical weeknight recipes.",
    items: [original(), fork()],
    page: 1,
    page_size: 12,
    total: 13,
    total_pages: 2,
    ...overrides,
  };
}

export function authenticatedTree(children: React.ReactNode) {
  return (
    <AuthSessionProvider
      initialSession={{ status: "authenticated", user: alice }}
    >
      {children}
    </AuthSessionProvider>
  );
}

export function authenticated(children: React.ReactNode) {
  return render(authenticatedTree(children));
}

export function anonymous(children: React.ReactNode) {
  return render(
    <AuthSessionProvider initialSession={{ status: "anonymous" }}>
      {children}
    </AuthSessionProvider>,
  );
}

export function getRecipeLibraryRouterMocks() {
  return routerMocks;
}

export function cleanupRecipeLibraryViewMocks() {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  routerMocks.replace.mockReset();
  vi.unstubAllGlobals();
}
