import { render } from "@testing-library/react";
import { vi } from "vitest";

import { AuthSessionProvider } from "../../../../features/auth/auth-session-provider";
import { CSRF_COOKIE_NAME } from "../../../../shared/api/browser-session";
import { alice } from "../../../../features/recipes/shared/recipe-test-support";

const routerMocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

export {
  CATALOG_ID,
  FORK_ID,
  original,
  profile,
} from "../../../../features/recipes/shared/recipe-test-support";

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
