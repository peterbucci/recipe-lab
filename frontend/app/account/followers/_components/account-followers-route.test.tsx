import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../../../features/auth/auth-session-provider";
import AccountFollowersPage from "../page";

const mocks = vi.hoisted(() => ({ fetchMyFollowers: vi.fn(), list: vi.fn() }));

vi.mock("../../../../features/community/member-follow-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../features/community/member-follow-api")>()),
  fetchMyFollowers: mocks.fetchMyFollowers,
}));

vi.mock("../../../../features/community/member-followers-list", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../features/community/member-followers-list")>();
  return {
    ...actual,
    MemberFollowersList: (props: { userId: string }) => {
      mocks.list(props);
      return <actual.MemberFollowersList {...props} />;
    },
  };
});

beforeEach(() => {
  mocks.list.mockClear();
  mocks.fetchMyFollowers.mockReset();
  mocks.fetchMyFollowers.mockResolvedValue({
    items: [], page: 1, page_size: 20, total: 0, total_pages: 0,
  });
});

describe("AccountFollowersRoute", () => {
  it("keeps the follower list behind the account session boundary", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <AccountFollowersPage />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Sign in to continue.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Sign in" }),
    ).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Faccount%2Ffollowers",
    );
    expect(mocks.fetchMyFollowers).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("requires onboarding before mounting the private follower list", () => {
    render(
      <AuthSessionProvider initialSession={{
        status: "onboarding_required",
        user: { id: "viewer", display_name: "Viewer", handle: null },
      }}>
        <AccountFollowersPage />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("link", { name: "Finish account setup" })).toHaveAttribute(
      "href", "/onboarding?return_to=%2Faccount%2Ffollowers",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.fetchMyFollowers).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("mounts the follower list for the authenticated account", async () => {
    render(
      <AuthSessionProvider initialSession={{
        status: "authenticated",
        user: { id: "viewer", display_name: "Viewer", handle: "viewer" },
      }}>
        <AccountFollowersPage />
      </AuthSessionProvider>,
    );

    expect(await screen.findByText("You do not have any followers yet.")).toBeVisible();
    expect(mocks.list).toHaveBeenCalledWith({ userId: "viewer" });
    expect(mocks.fetchMyFollowers).toHaveBeenCalledTimes(1);
  });
});
