import { render } from "@testing-library/react";
import { vi } from "vitest";

import { AuthSessionProvider } from "../../../../features/auth/auth-session-provider";
import type { PublicCookProfilePage } from "../../../../features/community/public-cook-profile";
import type { RecipeCardSummary } from "../../../../features/recipes/shared/recipe-contracts";
import { CSRF_COOKIE_NAME } from "../../../../shared/api/browser-session";
import {
  alice,
  CATALOG_ID as SHARED_CATALOG_ID,
  FORK_ID as SHARED_FORK_ID,
  fork,
  original as buildOriginal,
} from "../../../../features/recipes/shared/recipe-test-support";

const routerMocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

export const CATALOG_ID = SHARED_CATALOG_ID;
export const FORK_ID = SHARED_FORK_ID;

export function original(
  overrides: Partial<RecipeCardSummary> = {},
): RecipeCardSummary {
  return buildOriginal(overrides);
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

export function authenticated(children: React.ReactNode) {
  return render(
    <AuthSessionProvider
      initialSession={{ status: "authenticated", user: alice }}
    >
      {children}
    </AuthSessionProvider>,
  );
}

export function anonymous(children: React.ReactNode) {
  return render(
    <AuthSessionProvider initialSession={{ status: "anonymous" }}>
      {children}
    </AuthSessionProvider>,
  );
}

export function cleanupCookProfileMocks() {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  routerMocks.replace.mockReset();
  vi.unstubAllGlobals();
}
