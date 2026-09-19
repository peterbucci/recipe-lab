import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider, useAuthSession } from "./auth-session-provider";
import { SignInRoute } from "./sign-in-route";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

function CompleteDemoEntry() {
  const { replaceSession } = useAuthSession();

  return (
    <button
      type="button"
      onClick={() =>
        replaceSession({
          status: "authenticated",
          temporary: true,
          expires_at: "2026-09-20T16:00:37Z",
          user: {
            id: "demo-cook",
            display_name: "Demo cook",
            handle: "demo-cook",
          },
        })
      }
    >
      Complete demo entry
    </button>
  );
}

describe("SignInRoute", () => {
  beforeEach(() => navigation.replace.mockReset());

  it("does not override the requested destination after an anonymous visitor enters the demo", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <SignInRoute returnTo="/recipes/new">
          <CompleteDemoEntry />
        </SignInRoute>
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Complete demo entry" }));

    expect(navigation.replace).not.toHaveBeenCalledWith("/");
    expect(screen.getByRole("button", { name: "Complete demo entry" })).toBeVisible();
  });
});
