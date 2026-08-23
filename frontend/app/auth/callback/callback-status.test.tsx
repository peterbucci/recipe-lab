import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../components/auth-session-provider";
import { CallbackStatus } from "./callback-status";

const routerMocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

afterEach(() => {
  routerMocks.replace.mockReset();
});

describe("CallbackStatus", () => {
  it("shows an allowlisted callback error without reflecting arbitrary provider text", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <CallbackStatus errorCode="provider-secret-value" returnTo="/recipes" />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in could not be completed. Please try again.",
    );
    expect(screen.queryByText("provider-secret-value")).not.toBeInTheDocument();
  });

  it("sends a completed member to the validated return path", async () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        <CallbackStatus returnTo="/recipes?q=carrot" />
      </AuthSessionProvider>,
    );

    await waitFor(() =>
      expect(routerMocks.replace).toHaveBeenCalledWith("/recipes?q=carrot"),
    );
  });

  it("sends an incomplete account to onboarding with its safe destination", async () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "onboarding_required",
          user: { id: "cook-id", display_name: "Alice Cook", handle: null },
        }}
      >
        <CallbackStatus returnTo="/recipes?q=carrot" />
      </AuthSessionProvider>,
    );

    await waitFor(() =>
      expect(routerMocks.replace).toHaveBeenCalledWith(
        "/onboarding?return_to=%2Frecipes%3Fq%3Dcarrot",
      ),
    );
  });
});
