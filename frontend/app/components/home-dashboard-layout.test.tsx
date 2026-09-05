import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

vi.mock("./member-home-summary", () => ({
  MemberHomeSummary: ({ userId }: { userId: string }) => (
    <section data-testid="member-summary">Private summary for {userId}</section>
  ),
}));
vi.mock("./home-community-feed", () => ({
  HomeCommunityFeed: () => <section>Community feed</section>,
}));

import { AuthSessionProvider } from "./auth-session-provider";
import { HomeDashboardLayout } from "./home-dashboard-layout";

describe("HomeDashboardLayout", () => {
  beforeEach(() => {
    routerMocks.replace.mockReset();
  });

  it("sends anonymous visitors to the complete recipe catalog", async () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <HomeDashboardLayout>
          <section>Public discovery</section>
        </HomeDashboardLayout>
      </AuthSessionProvider>,
    );

    await waitFor(() => expect(routerMocks.replace).toHaveBeenCalledWith("/recipes"));
    expect(screen.getByRole("status")).toHaveTextContent("Opening all recipes…");
    expect(screen.queryByText("Public discovery")).not.toBeInTheDocument();
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
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it("reserves the member summary space while the shared account check resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    render(
      <AuthSessionProvider>
        <HomeDashboardLayout>
          <section>Public discovery</section>
        </HomeDashboardLayout>
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("complementary", {
        name: "Loading your Recipe Lab summary",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your account…",
    );
    expect(routerMocks.replace).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });
});
