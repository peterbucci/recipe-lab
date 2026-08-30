import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./member-home-summary", () => ({
  MemberHomeSummary: ({ userId }: { userId: string }) => (
    <section data-testid="member-summary">Private summary for {userId}</section>
  ),
}));

import { AuthSessionProvider } from "./auth-session-provider";
import { HomeDashboardLayout } from "./home-dashboard-layout";

describe("HomeDashboardLayout", () => {
  it("keeps public discovery useful without mounting private member content", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <HomeDashboardLayout>
          <section>Public discovery</section>
        </HomeDashboardLayout>
      </AuthSessionProvider>,
    );

    expect(screen.getByText("Public discovery")).toBeInTheDocument();
    expect(screen.queryByTestId("member-summary")).not.toBeInTheDocument();
  });

  it("does not treat an unfinished account as an authenticated member", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "onboarding_required",
          user: { id: "new-cook", display_name: "New Cook", handle: null },
        }}
      >
        <HomeDashboardLayout>
          <section>Public discovery</section>
        </HomeDashboardLayout>
      </AuthSessionProvider>,
    );

    expect(screen.getByText("Public discovery")).toBeInTheDocument();
    expect(screen.queryByTestId("member-summary")).not.toBeInTheDocument();
  });

  it("adds the active member’s summary without replacing public discovery", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-one", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        <HomeDashboardLayout>
          <section>Public discovery</section>
        </HomeDashboardLayout>
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("complementary", { name: "Alice Cook’s Recipe Lab summary" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("member-summary")).toHaveTextContent("cook-one");
    expect(screen.getByText("Public discovery")).toBeInTheDocument();
  });
});
