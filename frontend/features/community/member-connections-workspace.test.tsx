import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "../../tests/support/deferred";
import {
  MemberFollowApiError,
  type MyFollowersPage,
  type MyFollowingPage,
} from "./member-follow-api";
import { MemberConnectionsWorkspace } from "./member-connections-workspace";

const mocks = vi.hoisted(() => ({
  fetchMyFollowers: vi.fn(),
  fetchMyFollowing: vi.fn(),
}));

vi.mock("./member-follow-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./member-follow-api")>();
  return {
    ...actual,
    fetchMyFollowers: mocks.fetchMyFollowers,
    fetchMyFollowing: mocks.fetchMyFollowing,
  };
});

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const ALICE = {
  id: "22222222-2222-4222-8222-222222222222",
  handle: "alice-cook",
  display_name: "Alice Cook",
};

function followersPage(
  overrides: Partial<MyFollowersPage> = {},
): MyFollowersPage {
  return {
    items: [{ follower: ALICE, followed_at: "2026-08-30T14:30:00Z" }],
    page: 1,
    page_size: 20,
    total: 1,
    total_pages: 1,
    ...overrides,
  };
}

function followingPage(
  overrides: Partial<MyFollowingPage> = {},
): MyFollowingPage {
  return {
    items: [{ cook: ALICE, followed_at: "2026-08-30T14:30:00Z" }],
    page: 1,
    page_size: 20,
    total: 1,
    total_pages: 1,
    ...overrides,
  };
}

function authenticated(view: "followers" | "following" = "followers", pageNumber = 1) {
  return render(
    <MemberConnectionsWorkspace
      pageNumber={pageNumber}
      userId={MEMBER_ID}
      view={view}
    />,
  );
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-30T16:30:00Z"));
  mocks.fetchMyFollowers.mockReset();
  mocks.fetchMyFollowing.mockReset();
  mocks.fetchMyFollowers.mockResolvedValue(followersPage());
  mocks.fetchMyFollowing.mockResolvedValue(followingPage());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberConnectionsWorkspace", () => {
  it("uses the shared tab menu and removes the old follower-only chrome", async () => {
    authenticated();

    await screen.findByRole("list", { name: "Your followers" });
    expect(screen.getByRole("heading", { level: 1, name: "Connections" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Community activity" })).toHaveAttribute(
      "href",
      "/account/community-activity",
    );
    const navigation = screen.getByRole("navigation", { name: "Connection views" });
    expect(navigation).toHaveClass("workspace-tab-menu");
    expect(navigation.closest(".member-connections-page__frame")).toHaveClass(
      "workspace-panel-shell",
    );
    expect(within(navigation).getByRole("link", { name: "Followers" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(navigation).getByRole("link", { name: "Followers" })).toHaveAttribute(
      "href",
      "/account/connections?view=followers",
    );
    expect(within(navigation).getByRole("link", { name: "Following" })).toHaveAttribute(
      "href",
      "/account/connections?view=following",
    );
    expect(screen.queryByRole("link", { name: "Back home" })).not.toBeInTheDocument();
    expect(screen.queryByText("Your community")).not.toBeInTheDocument();
    expect(screen.queryByText("Only you can see this list")).not.toBeInTheDocument();
  });

  it("lists followers with relative time and public cook-profile links", async () => {
    authenticated();

    const list = await screen.findByRole("list", { name: "Your followers" });
    expect(screen.getByRole("heading", { level: 2, name: "Your followers" })).toBeVisible();
    expect(within(list).getByText("Alice Cook")).toBeVisible();
    expect(within(list).getByText("@alice-cook")).toBeVisible();
    expect(within(list).getByText("Followed you 2 hours ago")).toBeVisible();
    expect(
      within(list).getByRole("link", { name: "View Alice Cook’s profile" }),
    ).toHaveAttribute("href", "/cooks/alice-cook");
    expect(screen.getByText("Showing 1 of 1 follower")).toBeVisible();
    expect(mocks.fetchMyFollowers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
    expect(mocks.fetchMyFollowing).not.toHaveBeenCalled();
  });

  it("loads actual followed cooks for the Following tab", async () => {
    authenticated("following");

    const list = await screen.findByRole("list", { name: "Cooks you follow" });
    const navigation = screen.getByRole("navigation", { name: "Connection views" });
    expect(within(navigation).getByRole("link", { name: "Following" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("heading", { level: 2, name: "Cooks you follow" })).toBeVisible();
    expect(within(list).getByText("Alice Cook")).toBeVisible();
    expect(within(list).getByText("You followed 2 hours ago")).toBeVisible();
    expect(screen.getByText("Showing 1 of 1 cook")).toBeVisible();
    expect(mocks.fetchMyFollowing).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
    expect(mocks.fetchMyFollowers).not.toHaveBeenCalled();
  });

  it("does not invent a public profile link when a connection has no handle", async () => {
    mocks.fetchMyFollowing.mockResolvedValue(
      followingPage({
        items: [
          {
            cook: { ...ALICE, handle: null },
            followed_at: "2026-08-30T14:30:00Z",
          },
        ],
      }),
    );
    authenticated("following");

    const list = await screen.findByRole("list", { name: "Cooks you follow" });
    expect(within(list).getByText("Profile unavailable")).toBeVisible();
    expect(
      within(list).queryByRole("link", { name: "View Alice Cook’s profile" }),
    ).not.toBeInTheDocument();
  });

  it("shows view-specific empty states without inventing identities", async () => {
    mocks.fetchMyFollowing.mockResolvedValue(
      followingPage({ items: [], total: 0, total_pages: 0 }),
    );
    authenticated("following");

    expect(
      await screen.findByRole("heading", {
        name: "You are not following any cooks yet.",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("list", { name: "Cooks you follow" })).toBeNull();
    expect(screen.getByRole("link", { name: "Explore recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });

  it("recovers from a Following load error", async () => {
    mocks.fetchMyFollowing
      .mockRejectedValueOnce(
        new MemberFollowApiError(
          "Recipe Lab could not load the cooks you follow right now.",
          503,
        ),
      )
      .mockResolvedValueOnce(followingPage());
    authenticated("following");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recipe Lab could not load the cooks you follow right now.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry following" }));
    expect(await screen.findByRole("list", { name: "Cooks you follow" })).toBeVisible();
    expect(mocks.fetchMyFollowing).toHaveBeenCalledTimes(2);
  });

  it("keeps pagination in the selected tab URL", async () => {
    mocks.fetchMyFollowing.mockResolvedValue(
      followingPage({ page: 2, total: 21, total_pages: 2 }),
    );
    authenticated("following", 2);

    const pagination = await screen.findByRole("navigation", {
      name: "Following pages",
    });
    expect(within(pagination).getByText("Page 2 of 2")).toBeVisible();
    expect(within(pagination).getByRole("link", { name: "← Previous" })).toHaveAttribute(
      "href",
      "/account/connections?view=following",
    );
    expect(within(pagination).getByText("Next →")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("offers a valid URL when a requested page is out of range", async () => {
    mocks.fetchMyFollowers.mockResolvedValue(
      followersPage({ items: [], page: 3, total: 21, total_pages: 2 }),
    );
    authenticated("followers", 3);

    expect(
      await screen.findByRole("heading", {
        name: "That page is beyond your current followers.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Page out of range")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to the first page" }),
    ).toHaveAttribute("href", "/account/connections?view=followers");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts an in-flight retry when the workspace unmounts", async () => {
    const retry = deferred<MyFollowersPage>();
    mocks.fetchMyFollowers
      .mockRejectedValueOnce(
        new MemberFollowApiError(
          "Recipe Lab could not load your followers right now.",
          503,
        ),
      )
      .mockReturnValueOnce(retry.promise);
    const rendered = authenticated();

    fireEvent.click(await screen.findByRole("button", { name: "Retry followers" }));
    await waitFor(() => expect(mocks.fetchMyFollowers).toHaveBeenCalledTimes(2));
    const retrySignal = mocks.fetchMyFollowers.mock.calls[1]?.[0].signal;

    expect(retrySignal).toBeInstanceOf(AbortSignal);
    expect(retrySignal?.aborted).toBe(false);
    rendered.unmount();
    expect(retrySignal?.aborted).toBe(true);
  });
});
