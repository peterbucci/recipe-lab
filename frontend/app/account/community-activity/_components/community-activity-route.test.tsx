import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../../../features/auth/auth-session-provider";
import CommunityActivityPage from "../page";

const apiMocks = vi.hoisted(() => ({
  fetchMyCommunityActivity: vi.fn(),
  timeline: vi.fn(),
}));

vi.mock("../../../../features/community/member-follow-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../features/community/member-follow-api")>()),
  fetchMyCommunityActivity: apiMocks.fetchMyCommunityActivity,
}));

vi.mock("../../../../features/community/community-activity-timeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../features/community/community-activity-timeline")>();
  return {
    ...actual,
    CommunityActivityTimeline: (props: { userId: string }) => {
      apiMocks.timeline(props);
      return <actual.CommunityActivityTimeline {...props} />;
    },
  };
});

beforeEach(() => {
  apiMocks.timeline.mockClear();
  apiMocks.fetchMyCommunityActivity.mockReset();
  apiMocks.fetchMyCommunityActivity.mockResolvedValue({
    items: [], page: 1, page_size: 20, total: 0, total_pages: 0,
  });
});

describe("CommunityActivityRoute", () => {
  it("gates the private feed when signed out", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <CommunityActivityPage />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Sign in to continue." }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Follow cooks and keep up with the recipes and versions they publish.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Faccount%2Fcommunity-activity",
    );
    expect(apiMocks.fetchMyCommunityActivity).not.toHaveBeenCalled();
    expect(apiMocks.timeline).not.toHaveBeenCalled();
  });

  it("requires onboarding before mounting the private community feed", () => {
    render(
      <AuthSessionProvider initialSession={{
        status: "onboarding_required",
        user: { id: "viewer", display_name: "Viewer", handle: null },
      }}>
        <CommunityActivityPage />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("link", { name: "Finish account setup" })).toHaveAttribute(
      "href", "/onboarding?return_to=%2Faccount%2Fcommunity-activity",
    );
    expect(apiMocks.fetchMyCommunityActivity).not.toHaveBeenCalled();
    expect(apiMocks.timeline).not.toHaveBeenCalled();
  });

  it("mounts the feed for the authenticated account", async () => {
    render(
      <AuthSessionProvider initialSession={{
        status: "authenticated",
        user: { id: "viewer", display_name: "Viewer", handle: "viewer" },
      }}>
        <CommunityActivityPage />
      </AuthSessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "No community activity yet" })).toBeVisible();
    expect(apiMocks.timeline).toHaveBeenCalledWith({ userId: "viewer" });
    expect(apiMocks.fetchMyCommunityActivity).toHaveBeenCalledTimes(1);
  });
});
