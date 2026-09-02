import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ fetchMyCommunityActivity: vi.fn() }));

vi.mock("../../lib/member-follow-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/member-follow-api")>()),
  fetchMyCommunityActivity: apiMocks.fetchMyCommunityActivity,
}));

import type { RecipeSummary } from "../../lib/recipe-api";
import { AuthSessionProvider } from "./auth-session-provider";
import { CommunityActivityTimeline } from "./community-activity-timeline";

function recipe(id: string, title: string): RecipeSummary {
  return {
    id,
    lineage_id: "22222222-2222-4222-8222-222222222222",
    parent_version_id: null,
    version_number: 1,
    title,
    description: null,
    servings: "4.00",
    created_at: "2026-08-29T12:00:00Z",
    published_at: "2026-08-30T12:00:00Z",
    author: {
      id: "33333333-3333-4333-8333-333333333333",
      handle: "alice-cook",
      display_name: "Alice Cook",
    },
    parent: null,
    categories: [],
  };
}

function renderTimeline(authenticated = true) {
  return render(
    <AuthSessionProvider
      initialSession={
        authenticated
          ? {
              status: "authenticated",
              user: { id: "viewer", display_name: "Viewer", handle: "viewer" },
            }
          : { status: "anonymous" }
      }
    >
      <CommunityActivityTimeline />
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  apiMocks.fetchMyCommunityActivity.mockReset();
  apiMocks.fetchMyCommunityActivity
    .mockResolvedValueOnce({
      items: [
        recipe("11111111-1111-4111-8111-111111111111", "Newest recipe"),
        recipe("44444444-4444-4444-8444-444444444444", "Another recipe"),
      ],
      page: 1,
      page_size: 20,
      total: 3,
      total_pages: 2,
    })
    .mockResolvedValueOnce({
      items: [recipe("55555555-5555-4555-8555-555555555555", "Older recipe")],
      page: 2,
      page_size: 20,
      total: 3,
      total_pages: 2,
    });
});

describe("CommunityActivityTimeline", () => {
  it("shows the complete feed by loading older publications", async () => {
    renderTimeline();

    expect(await screen.findByRole("heading", { name: "Community activity" })).toBeVisible();
    expect(screen.queryByText("Your community")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Newest recipe" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load older activity" }));
    expect(await screen.findByRole("link", { name: "Older recipe" })).toBeVisible();
    await waitFor(() => expect(apiMocks.fetchMyCommunityActivity).toHaveBeenCalledTimes(2));
    expect(apiMocks.fetchMyCommunityActivity.mock.calls[1][0]).toMatchObject({
      page: 2,
      pageSize: 20,
    });
  });

  it("gates the private feed when signed out", () => {
    renderTimeline(false);

    expect(
      screen.getByRole("heading", { name: "Sign in to see your community activity" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Faccount%2Fcommunity-activity",
    );
    expect(apiMocks.fetchMyCommunityActivity).not.toHaveBeenCalled();
  });
});
