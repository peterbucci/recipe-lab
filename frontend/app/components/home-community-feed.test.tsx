import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchMyCommunityActivity: vi.fn(),
}));

vi.mock("../../lib/member-follow-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/member-follow-api")>()),
  fetchMyCommunityActivity: apiMocks.fetchMyCommunityActivity,
}));

import type { AuthSession } from "../../lib/auth-api";
import type { RecipeSummary } from "../../lib/recipe-api";
import { AuthSessionProvider } from "./auth-session-provider";
import { HomeCommunityFeed } from "./home-community-feed";
import { HomeLoadNotice, HomeLoadStateProvider } from "./home-load-state";

function recipe(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    lineage_id: "22222222-2222-4222-8222-222222222222",
    parent_version_id: null,
    version_number: 1,
    title: "Garden Toast",
    description: "A bright toast.",
    servings: "2.00",
    created_at: "2026-08-29T12:00:00Z",
    published_at: "2026-08-30T12:00:00Z",
    author: {
      id: "33333333-3333-4333-8333-333333333333",
      handle: "alice-cook",
      display_name: "Alice Cook",
    },
    parent: null,
    categories: [],
    ...overrides,
  };
}

const authenticated: AuthSession = {
  status: "authenticated",
  user: { id: "viewer-one", display_name: "Viewer", handle: "viewer" },
};

function renderFeed(session: AuthSession = authenticated) {
  return render(
    <AuthSessionProvider initialSession={session}>
      <HomeLoadStateProvider>
        <HomeLoadNotice />
        <HomeCommunityFeed />
      </HomeLoadStateProvider>
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  apiMocks.fetchMyCommunityActivity.mockReset();
  apiMocks.fetchMyCommunityActivity.mockResolvedValue({
    items: [
      recipe(),
      recipe({
        id: "44444444-4444-4444-8444-444444444444",
        parent_version_id: "11111111-1111-4111-8111-111111111111",
        parent: {
          id: "11111111-1111-4111-8111-111111111111",
          version_number: 1,
          title: "Garden Toast",
          author: {
            id: "33333333-3333-4333-8333-333333333333",
            handle: "alice-cook",
            display_name: "Alice Cook",
          },
        },
        title: "Herbed Garden Toast",
        version_number: 2,
      }),
    ],
    page: 1,
    page_size: 5,
    total: 2,
    total_pages: 1,
  });
});

describe("HomeCommunityFeed", () => {
  it("shows followed cooks' original and version publications", async () => {
    renderFeed();

    const region = screen.getByRole("region", { name: "From your community" });
    const heading = within(region).getByRole("heading", { name: "From your community" });
    expect(heading).toHaveClass("home-content-section__title");
    expect(heading).not.toHaveClass("eyebrow");
    expect(await within(region).findByText(/published an original recipe/i)).toBeVisible();
    expect(within(region).getByText(/published a new version/i)).toBeVisible();
    expect(within(region).getAllByRole("link", { name: "Alice Cook" })[0]).toHaveAttribute(
      "href",
      "/cooks/alice-cook",
    );
    expect(within(region).getByRole("link", { name: "View all" })).toHaveAttribute(
      "href",
      "/account/community-activity",
    );
    expect(apiMocks.fetchMyCommunityActivity).toHaveBeenCalledWith({
      page: 1,
      pageSize: 5,
      signal: expect.any(AbortSignal),
    });
  });

  it("lists the five latest community publications on the homepage", async () => {
    const items = Array.from({ length: 5 }, (_, index) =>
      recipe({
        id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, "0")}`,
        published_at: `2026-08-30T${String(12 - index).padStart(2, "0")}:00:00Z`,
        title: `Community recipe ${index + 1}`,
      }),
    );
    apiMocks.fetchMyCommunityActivity.mockResolvedValueOnce({
      items,
      page: 1,
      page_size: 5,
      total: 5,
      total_pages: 1,
    });

    renderFeed();

    const region = screen.getByRole("region", { name: "From your community" });
    await within(region).findByRole("link", { name: "Community recipe 1" });
    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    items.forEach((item, index) => {
      expect(
        within(rows[index]).getByRole("link", { name: item.title }),
      ).toBeVisible();
    });
  });

  it("does not make a private request for a signed-out visitor", () => {
    renderFeed({ status: "anonymous" });

    expect(screen.getByText(/follow cooks to see their new recipes/i)).toBeVisible();
    expect(apiMocks.fetchMyCommunityActivity).not.toHaveBeenCalled();
  });

  it("shows a useful empty state when followed cooks have no publications", async () => {
    apiMocks.fetchMyCommunityActivity.mockResolvedValueOnce({
      items: [],
      page: 1,
      page_size: 5,
      total: 0,
      total_pages: 0,
    });
    renderFeed();

    expect(await screen.findByText("No updates from cooks you follow yet.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Find cooks to follow" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });

  it("joins the shared homepage recovery flow when the feed fails", async () => {
    apiMocks.fetchMyCommunityActivity
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        items: [],
        page: 1,
        page_size: 5,
        total: 0,
        total_pages: 0,
      });
    renderFeed();

    expect(
      await screen.findByRole("status", {
        name: "Some homepage information couldn’t be updated.",
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(apiMocks.fetchMyCommunityActivity).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No updates from cooks you follow yet.")).toBeVisible();
  });
});
