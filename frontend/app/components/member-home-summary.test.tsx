import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MemberActivityApiError,
  type MemberDashboard,
} from "../../lib/member-activity-api";
import type { RecipeDraftListItem } from "../../lib/recipe-draft-api";
import { deferred } from "../../test/deferred";
import { HomeLoadNotice, HomeLoadStateProvider } from "./home-load-state";
import { MemberHomeSummary } from "./member-home-summary";

const mocks = vi.hoisted(() => ({ fetchMemberDashboard: vi.fn() }));

vi.mock("../../lib/member-activity-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/member-activity-api")>();
  return { ...actual, fetchMemberDashboard: mocks.fetchMemberDashboard };
});

const DRAFT: RecipeDraftListItem = {
  created_at: "2026-08-28T09:00:00Z",
  id: "44444444-4444-4444-8444-444444444444",
  ingredient_count: 6,
  instruction_count: 4,
  revision: 2,
  source_version_id: "77777777-7777-4777-8777-777777777777",
  status: "active",
  title: "Garden stew",
  updated_at: "2026-08-30T12:00:00Z",
};

const DASHBOARD: MemberDashboard = {
  latestDraft: DRAFT,
  recentActivity: [
    {
      href: "/account/ingredient-requests",
      id: "ingredient-request:66666666-6666-4666-8666-666666666666",
      kind: "ingredient-request",
      label: "Ingredient request approved",
      timestamp: "2026-08-30T14:00:00Z",
      title: "Mountain pepper",
    },
    {
      href: "/account/recipes?view=saved",
      id: "saved:22222222-2222-4222-8222-222222222222",
      kind: "saved",
      label: "Saved recipe",
      timestamp: "2026-08-30T13:00:00Z",
      title: "Saved summer salad",
    },
    {
      href: `/recipes/drafts/${DRAFT.id}`,
      id: `draft:${DRAFT.id}`,
      kind: "draft",
      label: "Updated draft",
      timestamp: DRAFT.updated_at,
      title: DRAFT.title,
    },
  ],
  stats: {
    activeDrafts: 2,
    followers: 9,
    savedRecipes: 5,
    versionsPublished: 4,
  },
};

function metric(label: string): HTMLElement {
  const container = screen
    .getByText(label, { selector: "dt" })
    .closest(".member-home-summary__metric");
  if (!(container instanceof HTMLElement)) throw new Error(`Missing ${label} metric.`);
  return container;
}

function SummaryHarness({ userId }: { userId: string }) {
  return (
    <HomeLoadStateProvider>
      <HomeLoadNotice />
      <MemberHomeSummary userId={userId} />
    </HomeLoadStateProvider>
  );
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-30T16:00:00Z"));
  mocks.fetchMemberDashboard.mockReset();
  mocks.fetchMemberDashboard.mockResolvedValue(DASHBOARD);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberHomeSummary", () => {
  it("loads the complete private summary with one bounded request", async () => {
    render(<SummaryHarness userId="member-one" />);
    expect(
      await screen.findByRole("heading", { level: 3, name: "Garden stew" }),
    ).toBeVisible();
    expect(mocks.fetchMemberDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMemberDashboard).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("shows the latest draft, exact totals, and three newest activities", async () => {
    render(<SummaryHarness userId="member-one" />);
    expect(await screen.findByRole("link", { name: "Open draft" })).toHaveAttribute(
      "href",
      `/recipes/drafts/${DRAFT.id}`,
    );
    expect(screen.getByText("6 ingredients · 4 steps")).toBeVisible();
    expect(screen.getByRole("list", { name: "Recent account activity" })).toBeVisible();
    expect(screen.getByText("Mountain pepper")).toBeVisible();
    expect(screen.getByText("Saved summer salad")).toBeVisible();
    expect(within(metric("Versions published")).getByText("4")).toBeVisible();
    expect(within(metric("Active drafts")).getByText("2")).toBeVisible();
    expect(within(metric("Saved recipes")).getByText("5")).toBeVisible();
    expect(within(metric("Followers")).getByText("9")).toBeVisible();
  });

  it("does not render the continue panel when there is no active draft", async () => {
    mocks.fetchMemberDashboard.mockResolvedValue({
      ...DASHBOARD,
      latestDraft: null,
      stats: { ...DASHBOARD.stats, activeDrafts: 0 },
    });
    render(<SummaryHarness userId="member-one" />);
    await screen.findByText("Mountain pepper");
    expect(
      screen.queryByRole("heading", { name: "Continue where you left off" }),
    ).toBeNull();
  });

  it("shows the unified empty activity message", async () => {
    mocks.fetchMemberDashboard.mockResolvedValue({
      ...DASHBOARD,
      latestDraft: null,
      recentActivity: [],
    });
    render(<SummaryHarness userId="member-one" />);
    expect(await screen.findByText("No recent account activity yet.")).toBeVisible();
  });

  it("registers one retry for a dashboard outage", async () => {
    mocks.fetchMemberDashboard
      .mockRejectedValueOnce(new MemberActivityApiError("Unavailable", 503))
      .mockResolvedValueOnce(DASHBOARD);
    render(<SummaryHarness userId="member-one" />);
    const notice = await screen.findByRole("status", {
      name: "Some homepage information couldn’t be updated.",
    });
    expect(screen.getAllByText("Unavailable.")).toHaveLength(1);
    fireEvent.click(within(notice).getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { level: 3, name: "Garden stew" }),
    ).toBeVisible();
    expect(mocks.fetchMemberDashboard).toHaveBeenCalledTimes(2);
  });

  it("leaves sign-in recovery separate from the homepage outage notice", async () => {
    mocks.fetchMemberDashboard.mockRejectedValue(
      new MemberActivityApiError("Sign in again", 401, "authentication_required"),
    );
    render(<SummaryHarness userId="member-one" />);
    await screen.findByText("Latest draft unavailable.");
    expect(screen.queryByText("Some homepage information couldn’t be updated.")).toBeNull();
  });

  it("aborts the prior account request and ignores its late result", async () => {
    const first = deferred<MemberDashboard>();
    mocks.fetchMemberDashboard
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        ...DASHBOARD,
        latestDraft: { ...DRAFT, title: "Second account draft" },
      });
    const rendered = render(<SummaryHarness userId="member-one" />);
    await waitFor(() => expect(mocks.fetchMemberDashboard).toHaveBeenCalledTimes(1));
    const firstSignal = mocks.fetchMemberDashboard.mock.calls[0]?.[0] as AbortSignal;

    rendered.rerender(<SummaryHarness userId="member-two" />);
    expect(await screen.findByText("Second account draft")).toBeVisible();
    expect(firstSignal.aborted).toBe(true);

    await act(async () => first.resolve(DASHBOARD));
    expect(
      screen.queryByRole("heading", { level: 3, name: "Garden stew" }),
    ).toBeNull();
  });
});
