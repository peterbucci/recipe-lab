import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../../../features/auth/auth-session-provider";
import AccountActivityPage from "../page";

const mocks = vi.hoisted(() => ({ fetchMemberActivity: vi.fn(), timeline: vi.fn() }));

vi.mock("../../../../features/account/member-activity-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../features/account/member-activity-api")>()),
  fetchMemberActivity: mocks.fetchMemberActivity,
}));

vi.mock("../../../../features/account/member-activity-timeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../features/account/member-activity-timeline")>();
  return {
    ...actual,
    MemberActivityTimeline: (props: { userId: string }) => {
      mocks.timeline(props);
      return <actual.MemberActivityTimeline {...props} />;
    },
  };
});

beforeEach(() => {
  mocks.timeline.mockClear();
  mocks.fetchMemberActivity.mockReset();
  mocks.fetchMemberActivity.mockResolvedValue({
    counts: { all: 0, recipes: 0, requests: 0, saved: 0 },
    items: [], nextCursor: null, selectedFilter: "all",
  });
});

describe("AccountActivityRoute", () => {
  it("keeps signed-out account activity private and preserves its return destination", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <AccountActivityPage />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("heading", { name: "Page Unavailable" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute(
      "href", "/sign-in?return_to=%2Faccount%2Factivity",
    );
    expect(mocks.fetchMemberActivity).not.toHaveBeenCalled();
    expect(mocks.timeline).not.toHaveBeenCalled();
  });

  it("requires onboarding before mounting the private activity timeline", () => {
    render(
      <AuthSessionProvider initialSession={{
        status: "onboarding_required",
        user: { id: "viewer", display_name: "Viewer", handle: null },
      }}>
        <AccountActivityPage />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("link", { name: "Finish account setup" })).toHaveAttribute(
      "href", "/onboarding?return_to=%2Faccount%2Factivity",
    );
    expect(mocks.fetchMemberActivity).not.toHaveBeenCalled();
    expect(mocks.timeline).not.toHaveBeenCalled();
  });

  it("mounts the timeline for the authenticated account", async () => {
    render(
      <AuthSessionProvider initialSession={{
        status: "authenticated",
        user: { id: "viewer", display_name: "Viewer", handle: "viewer" },
      }}>
        <AccountActivityPage />
      </AuthSessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "You have no activity yet." })).toBeVisible();
    expect(mocks.timeline).toHaveBeenCalledWith({ userId: "viewer" });
    expect(mocks.fetchMemberActivity).toHaveBeenCalledTimes(1);
  });
});
