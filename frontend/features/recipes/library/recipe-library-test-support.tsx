import { render } from "@testing-library/react";
import { vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../../shared/api/browser-session";
import { AuthSessionProvider } from "../../auth/auth-session-provider";
import { alice } from "../shared/recipe-test-support";

export {
  DRAFT_ID,
  FORK_ID,
  ORIGINAL_DRAFT_ID,
  ROOT_ID,
  fork,
  original,
} from "../shared/recipe-test-support";

const routerMocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

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

export function getRecipeLibraryRouterMocks() {
  return routerMocks;
}

export function cleanupRecipeLibraryViewMocks() {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  routerMocks.replace.mockReset();
  vi.unstubAllGlobals();
}
