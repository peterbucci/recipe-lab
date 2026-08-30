import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../components/auth-session-provider";
import AuthCallbackPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

describe("AuthCallbackPage", () => {
  it("keeps callback failures inside the account access surface", async () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        {await AuthCallbackPage({
          searchParams: Promise.resolve({
            error: "access_denied",
            return_to: "/recipes",
          }),
        })}
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("main")).toHaveClass(
      "account-access-page",
      "account-access-page--callback",
    );
    expect(screen.getByRole("heading", { name: "Connecting your account" }).closest("section"))
      .toHaveClass("account-access-card", "account-access-card--callback");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in was canceled. No changes were made to your account.",
    );
  });
});
