import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MemberFollowApiError,
  type MyFollowersPage,
} from "../../lib/member-follow-api";
import { AuthSessionProvider } from "./auth-session-provider";
import { MemberFollowersList } from "./member-followers-list";

const mocks = vi.hoisted(() => ({
  fetchMyFollowers: vi.fn(),
}));

vi.mock("../../lib/member-follow-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/member-follow-api")>();
  return { ...actual, fetchMyFollowers: mocks.fetchMyFollowers };
});

const MEMBER = {
  display_name: "Peter",
  handle: "peter",
  id: "11111111-1111-4111-8111-111111111111",
};

const ALICE = {
  id: "22222222-2222-4222-8222-222222222222",
  handle: "alice-cook",
  display_name: "Alice Cook",
};

function followersPage(
  overrides: Partial<MyFollowersPage> = {},
): MyFollowersPage {
  return {
    items: [
      {
        follower: ALICE,
        followed_at: "2026-08-30T14:30:00Z",
      },
    ],
    page: 1,
    page_size: 20,
    total: 1,
    total_pages: 1,
    ...overrides,
  };
}

function authenticated() {
  return render(
    <AuthSessionProvider
      initialSession={{ status: "authenticated", user: MEMBER }}
    >
      <MemberFollowersList />
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-30T16:30:00Z"));
  mocks.fetchMyFollowers.mockReset();
  mocks.fetchMyFollowers.mockResolvedValue(followersPage());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberFollowersList", () => {
  it("uses the shared section loader while the first follower page loads", () => {
    mocks.fetchMyFollowers.mockReturnValue(new Promise(() => undefined));

    authenticated();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading your followers…");
    expect(status.closest(".section-loading--summary")).not.toBeNull();
  });

  it("lists followers with relative time and public cook-profile links", async () => {
    authenticated();

    const list = await screen.findByRole("list", { name: "Your followers" });
    expect(within(list).getByText("Alice Cook")).toBeVisible();
    expect(within(list).getByText("@alice-cook")).toBeVisible();
    expect(within(list).getByText("Followed you 2 hours ago")).toBeVisible();
    expect(
      within(list).getByRole("link", { name: "View Alice Cook’s profile" }),
    ).toHaveAttribute("href", "/cooks/alice-cook");
    expect(screen.getByText("1 follower", { exact: true })).toBeVisible();
    expect(mocks.fetchMyFollowers).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
  });

  it("keeps the follower list behind the account session boundary", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <MemberFollowersList />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Page Unavailable",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Sign In" }),
    ).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Faccount%2Ffollowers",
    );
    expect(mocks.fetchMyFollowers).not.toHaveBeenCalled();
  });

  it("shows the empty state without inventing follower identities", async () => {
    mocks.fetchMyFollowers.mockResolvedValue(
      followersPage({ items: [], total: 0, total_pages: 0 }),
    );
    authenticated();

    expect(
      await screen.findByText("You do not have any followers yet."),
    ).toBeVisible();
    expect(screen.queryByRole("list", { name: "Your followers" })).toBeNull();
    expect(screen.getByRole("link", { name: "Explore recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });

  it("recovers from a load error and supports follower pagination", async () => {
    mocks.fetchMyFollowers
      .mockRejectedValueOnce(
        new MemberFollowApiError(
          "Recipe Lab could not load your followers right now.",
          503,
        ),
      )
      .mockImplementation(({ page }: { page: number }) =>
        Promise.resolve(
          page === 1
            ? followersPage({ total: 21, total_pages: 2 })
            : followersPage({ page: 2, total: 21, total_pages: 2 }),
        ),
      );
    authenticated();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recipe Lab could not load your followers right now.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry followers" }));
    const pagination = await screen.findByRole("navigation", {
      name: "Follower pages",
    });
    expect(within(pagination).getByText("Page 1 of 2")).toBeVisible();
    fireEvent.click(within(pagination).getByRole("button", { name: "Next →" }));

    await waitFor(() => {
      expect(mocks.fetchMyFollowers).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 20 }),
      );
      expect(screen.getByText("Page 2 of 2")).toBeVisible();
    });
  });
});
