import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberActivityPage } from "../../lib/member-activity-api";
import type { MemberActivity } from "../../lib/member-activity";
import { AuthSessionProvider } from "./auth-session-provider";
import { MemberActivityTimeline } from "./member-activity-timeline";

const mocks = vi.hoisted(() => ({ fetchMemberActivity: vi.fn() }));

vi.mock("../../lib/member-activity-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/member-activity-api")>();
  return { ...actual, fetchMemberActivity: mocks.fetchMemberActivity };
});

const MEMBER = {
  display_name: "Peter",
  handle: "peter",
  id: "11111111-1111-4111-8111-111111111111",
};

function activity(
  kind: MemberActivity["kind"],
  overrides: Partial<MemberActivity> = {},
): MemberActivity {
  return {
    href: kind === "draft" ? "/recipes/drafts/one" : "/account/recipes",
    id: `${kind}:22222222-2222-4222-8222-222222222222`,
    kind,
    label: kind === "draft" ? "Updated draft" : "Saved recipe",
    timestamp: "2026-08-30T15:00:00Z",
    title: kind === "draft" ? "Banana oat pancakes" : "Garden noodles",
    ...overrides,
  };
}

function page(overrides: Partial<MemberActivityPage> = {}): MemberActivityPage {
  return {
    counts: { all: 2, recipes: 1, requests: 0, saved: 1 },
    items: [activity("draft"), activity("saved")],
    nextCursor: null,
    selectedFilter: "all",
    ...overrides,
  };
}

function renderTimeline() {
  return render(
    <AuthSessionProvider initialSession={{ status: "authenticated", user: MEMBER }}>
      <MemberActivityTimeline />
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-30T16:00:00Z"));
  mocks.fetchMemberActivity.mockReset();
  mocks.fetchMemberActivity.mockResolvedValue(page());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberActivityTimeline", () => {
  it("uses the shared row loader while the bounded page resolves", () => {
    mocks.fetchMemberActivity.mockReturnValue(new Promise(() => undefined));
    renderTimeline();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your activity…");
  });

  it("uses the shared empty state when the member has no activity", async () => {
    mocks.fetchMemberActivity.mockResolvedValue(
      page({
        counts: { all: 0, recipes: 0, requests: 0, saved: 0 },
        items: [],
      }),
    );
    renderTimeline();
    expect(
      await screen.findByRole("heading", { name: "You have no activity yet." }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Explore recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });

  it("shows activity, accurate server counts, and destinations", async () => {
    renderTimeline();
    const draftTitle = await screen.findByText("Banana oat pancakes");
    const draftLink = draftTitle.closest("a");
    expect(draftLink).not.toBeNull();
    expect(draftLink).toHaveAttribute("href", "/recipes/drafts/one");
    expect(draftLink).toHaveClass("member-activity-page__event");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Saved" })).toBeVisible();
  });

  it("requests one server-filtered page when a tab changes", async () => {
    mocks.fetchMemberActivity.mockImplementation(
      ({ filter }: { filter: string }) =>
        Promise.resolve(
          page({
            items: filter === "saved" ? [activity("saved")] : page().items,
            selectedFilter: filter as MemberActivityPage["selectedFilter"],
          }),
        ),
    );
    renderTimeline();
    await screen.findByText("Banana oat pancakes");
    fireEvent.click(screen.getByRole("button", { name: "Saved" }));
    await waitFor(() => {
      expect(mocks.fetchMemberActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ filter: "saved", pageSize: 24 }),
      );
    });
    expect(await screen.findByText("Garden noodles")).toBeVisible();
    expect(screen.queryByText("Banana oat pancakes")).not.toBeInTheDocument();
  });

  it("sends search text to the bounded endpoint and clears an empty result", async () => {
    mocks.fetchMemberActivity.mockImplementation(({ q }: { q?: string }) =>
      Promise.resolve(page({ items: q ? [] : page().items })),
    );
    renderTimeline();
    await screen.findByText("Banana oat pancakes");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search activity" }), {
      target: { value: "missing" },
    });
    expect(
      await screen.findByRole("heading", {
        name: "No activity matches your search.",
      }),
    ).toBeVisible();
    expect(mocks.fetchMemberActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "missing" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByText("Banana oat pancakes")).toBeVisible();
  });

  it("loads only the next cursor page and appends unique activity", async () => {
    mocks.fetchMemberActivity
      .mockResolvedValueOnce(
        page({ items: [activity("draft")], nextCursor: "next-page" }),
      )
      .mockResolvedValueOnce(
        page({
          items: [
            activity("saved", {
              id: "saved:33333333-3333-4333-8333-333333333333",
            }),
          ],
        }),
      );
    renderTimeline();
    fireEvent.click(await screen.findByRole("button", { name: "Load older activity" }));
    await screen.findByText("Garden noodles");
    expect(mocks.fetchMemberActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next-page", pageSize: 24 }),
    );
    expect(screen.queryByRole("button", { name: "Load older activity" })).toBeNull();
  });

  it("offers one recovery action after a failed page request", async () => {
    mocks.fetchMemberActivity
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page());
    renderTimeline();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Activity is temporarily unavailable");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Banana oat pancakes")).toBeVisible();
    expect(mocks.fetchMemberActivity).toHaveBeenCalledTimes(2);
  });
});
