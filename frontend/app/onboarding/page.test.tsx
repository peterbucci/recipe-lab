import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../components/auth-session-provider";
import OnboardingPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

describe("OnboardingPage", () => {
  it("groups profile setup inside the account access surface", async () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "onboarding_required",
          user: { id: "cook-id", display_name: "Alice Cook", handle: null },
        }}
      >
        {await OnboardingPage({
          searchParams: Promise.resolve({ return_to: "/recipes?q=carrot" }),
        })}
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("main")).toHaveClass(
      "account-access-page",
      "account-access-page--onboarding",
    );
    expect(screen.getByRole("heading", { name: "Finish account setup" }).closest("section"))
      .toHaveClass("account-access-card", "account-access-card--onboarding");
    expect(screen.getByRole("button", { name: "Finish account setup" }).closest("form"))
      .toHaveClass("account-profile-form");
  });
});
