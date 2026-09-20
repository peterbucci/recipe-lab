import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MemberIngredientRequest,
  MemberIngredientRequestCounts,
  MemberIngredientRequestPage,
} from "./ingredient-request-api";
import { IngredientCatalogApiError } from "../ingredient-api-error";
import { browseMyIngredientRequests } from "./ingredient-request-api";
import { deferred } from "../../../tests/support/deferred";
import { MemberIngredientRequestHistory } from "./member-ingredient-request-history";

const mocks = vi.hoisted(() => ({
  browseMyIngredientRequests: vi.fn(),
}));

vi.mock("./ingredient-request-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ingredient-request-api")>();
  return {
    ...actual,
    browseMyIngredientRequests: mocks.browseMyIngredientRequests,
  };
});

const PITAYA_ID = "11111111-1111-4111-8111-111111111111";
const PECAN_ID = "22222222-2222-4222-8222-222222222222";
const PENDING_ID = "33333333-3333-4333-8333-333333333333";
const APPROVED_ID = "44444444-4444-4444-8444-444444444444";
const REJECTED_ID = "55555555-5555-4555-8555-555555555555";
const DUPLICATE_ID = "66666666-6666-4666-8666-666666666666";

function memberRequest(
  overrides: Partial<MemberIngredientRequest> = {},
): MemberIngredientRequest {
  return {
    id: PENDING_ID,
    proposed_name: "Unreviewed herb",
    context: "A tender market herb",
    status: "pending",
    created_at: "2026-08-24T18:00:00Z",
    reviewed_at: null,
    decision_reason: null,
    resolved_ingredient_id: null,
    resolved_ingredient: null,
    ...overrides,
  };
}

const approved = memberRequest({
  id: APPROVED_ID,
  proposed_name: "Dragon fruit request text",
  status: "approved",
  reviewed_at: "2026-08-24T19:00:00Z",
  decision_reason: "Added under its common catalog name.",
  resolved_ingredient_id: PITAYA_ID,
  resolved_ingredient: {
    id: PITAYA_ID,
    canonical_name: "Pitaya",
    aliases: ["Dragon fruit"],
  },
});

const rejected = memberRequest({
  id: REJECTED_ID,
  proposed_name: "Ambiguous powder",
  status: "rejected",
  reviewed_at: "2026-08-24T20:00:00Z",
  decision_reason: "Not enough information to identify it safely.",
});

const duplicate = memberRequest({
  id: DUPLICATE_ID,
  proposed_name: "Pecan nut request text",
  status: "duplicate",
  reviewed_at: "2026-08-24T21:00:00Z",
  decision_reason: "Already cataloged as Pecan.",
  resolved_ingredient_id: PECAN_ID,
  resolved_ingredient: {
    id: PECAN_ID,
    canonical_name: "Pecan",
    aliases: ["Pecan nut"],
  },
});

function requestCounts(
  items: MemberIngredientRequest[],
): MemberIngredientRequestCounts {
  const counts: MemberIngredientRequestCounts = {
    all: items.length,
    approved: 0,
    duplicate: 0,
    pending: 0,
    rejected: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

function requestPage(
  items: MemberIngredientRequest[] = [memberRequest(), approved, rejected, duplicate],
  overrides: Partial<MemberIngredientRequestPage> = {},
): MemberIngredientRequestPage {
  return {
    counts: requestCounts(items),
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    total_pages: items.length > 0 ? 1 : 0,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.browseMyIngredientRequests.mockReset();
  mocks.browseMyIngredientRequests.mockResolvedValue(requestPage());
});

describe("MemberIngredientRequestHistory", () => {
  it("uses the shared row loader for the initial request history", () => {
    const initial = deferred<MemberIngredientRequestPage>();
    mocks.browseMyIngredientRequests.mockReturnValue(initial.promise);

    render(<MemberIngredientRequestHistory idPrefix="history" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading your ingredient requests…");
    expect(status.closest(".section-loading--rows")).not.toBeNull();
  });

  it("shows every member status and terminal detail", async () => {
    render(<MemberIngredientRequestHistory idPrefix="history" />);

    const region = await screen.findByRole("region", { name: "My ingredient requests" });
    expect(region).toHaveClass(
      "member-request-history--standalone",
      "workspace-panel-shell",
    );
    expect(region).not.toHaveClass("workspace-panel-shell--mobile-bleed");
    const statusTabs = within(region).getByRole("group", {
      name: "Ingredient request status",
    });
    const allRequestsTab = within(statusTabs).getByRole("button", { name: "All" });
    expect(allRequestsTab).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(
        allRequestsTab.querySelector(".workspace-tab-menu__count"),
      ).toHaveTextContent("4"),
    );
    const allRequestsHeader = within(region)
      .getByRole("heading", { level: 2, name: "All requests" })
      .closest("header");
    expect(allRequestsHeader).toHaveClass("workspace-panel-header");
    expect(allRequestsHeader).toHaveTextContent(
      "Review every ingredient request you’ve submitted and its latest status.",
    );
    expect(
      allRequestsHeader?.querySelector(".workspace-panel-header__meta"),
    ).toBeNull();
    expect(allRequestsHeader).not.toHaveTextContent("4 requests");
    const allRequestsTotal = within(region).getByText("4 requests", {
      selector: ".member-request-history__total",
    });
    expect(allRequestsTotal).toHaveClass("visually-hidden");
    expect(allRequestsTotal).toHaveAttribute("aria-live", "polite");
    for (const [label, count] of [
      ["All", "4"],
      ["Pending", "1"],
      ["Approved", "1"],
      ["Matched", "1"],
      ["Rejected", "1"],
    ] as const) {
      const tab = within(statusTabs).getByRole("button", { name: label });
      expect(tab).toBeVisible();
      expect(
        tab.querySelector(".workspace-tab-menu__count"),
      ).toHaveTextContent(count);
    }
    expect(
      within(region).getByRole("searchbox", { name: "Search my ingredient requests" }),
    ).toBeVisible();
    expect(within(region).getByText("Ingredient request")).toBeVisible();
    expect(within(region).getByText("Status")).toBeVisible();
    expect(within(region).getByText("Requested")).toBeVisible();
    expect(within(region).getByText("Resolution")).toBeVisible();

    for (const name of [
      "Unreviewed herb",
      "Dragon fruit request text",
      "Ambiguous powder",
      "Pecan nut request text",
    ]) {
      expect(
        within(region).getByRole("article", { name: `Ingredient request: ${name}` }),
      ).toBeVisible();
    }

    const approvedCard = within(region).getByRole("article", {
      name: "Ingredient request: Dragon fruit request text",
    });
    expect(within(approvedCard).getByText("Added under its common catalog name.")).toBeVisible();
    expect(within(approvedCard).getByText("Pitaya", { selector: "strong" })).toBeVisible();
    expect(
      approvedCard.querySelector('time[datetime="2026-08-24T18:00:00Z"]'),
    ).not.toBeNull();

    const pendingCard = within(region).getByRole("article", {
      name: "Ingredient request: Unreviewed herb",
    });
    expect(within(pendingCard).getByText("Waiting for curator review.")).toBeVisible();
    const rejectedCard = within(region).getByRole("article", {
      name: "Ingredient request: Ambiguous powder",
    });
    expect(within(rejectedCard).getByText("Not added")).toBeVisible();
    expect(
      within(rejectedCard).getByText("Not enough information to identify it safely."),
    ).toBeVisible();
    const duplicateCard = within(region).getByRole("article", {
      name: "Ingredient request: Pecan nut request text",
    });
    expect(within(duplicateCard).getByText("Matched")).toBeVisible();
    expect(
      within(duplicateCard).getByText("Your request matched an existing ingredient"),
    ).toBeVisible();
  });

  it("sends status, search, and paging to the complete member-history endpoint", async () => {
    const counts: MemberIngredientRequestCounts = {
      all: 21,
      approved: 11,
      duplicate: 2,
      pending: 3,
      rejected: 5,
    };
    mocks.browseMyIngredientRequests.mockImplementation(
      async ({ page = 1 }: { page?: number } = {}) =>
        requestPage([approved], {
          counts,
          page,
          page_size: 20,
          total: 11,
          total_pages: 2,
        }),
    );
    render(<MemberIngredientRequestHistory idPrefix="history" />);
    await screen.findByRole("article", {
      name: "Ingredient request: Dragon fruit request text",
    });

    const approvedTab = screen.getByRole("button", { name: "Approved" });
    const statusTabs = screen.getByRole("group", {
      name: "Ingredient request status",
    });
    expect(
      within(within(statusTabs).getByRole("button", { name: "All" })).getByText(
        "21",
      ),
    ).toHaveAttribute("aria-hidden", "true");
    expect(
      within(
        within(statusTabs).getByRole("button", { name: "Pending" }),
      ).getByText("3"),
    ).toHaveAttribute("aria-hidden", "true");
    expect(
      within(within(statusTabs).getByRole("button", { name: "Matched" })).getByText(
        "2",
      ),
    ).toHaveAttribute("aria-hidden", "true");
    expect(
      within(within(statusTabs).getByRole("button", { name: "Rejected" })).getByText(
        "5",
      ),
    ).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(approvedTab);
    await waitFor(() =>
      expect(browseMyIngredientRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "approved", page: 1, query: "" }),
      ),
    );
    await waitFor(() =>
      expect(
        approvedTab.querySelector(".workspace-tab-menu__count"),
      ).toHaveTextContent("11"),
    );
    const approvedHeader = screen
      .getByRole("heading", { level: 2, name: "Approved requests" })
      .closest("header");
    expect(approvedHeader).toHaveClass("workspace-panel-header");
    expect(approvedHeader).toHaveTextContent(
      "Requests that a curator added to the catalog.",
    );
    expect(
      approvedHeader?.querySelector(".workspace-panel-header__meta"),
    ).toBeNull();
    expect(approvedHeader).not.toHaveTextContent("11 requests");
    const approvedTotal = screen.getByText("11 requests", {
      selector: ".member-request-history__total",
    });
    expect(approvedTotal).toHaveClass("visually-hidden");
    expect(approvedTotal).toHaveAttribute("aria-live", "polite");
    const search = screen.getByRole("searchbox", { name: "Search my ingredient requests" });
    fireEvent.change(search, { target: { value: "  dragon fruit  " } });
    fireEvent.submit(search.closest("form")!);

    await waitFor(() =>
      expect(browseMyIngredientRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "approved",
          page: 1,
          pageSize: 20,
          query: "dragon fruit",
        }),
      ),
    );
    const searchSummary = await screen.findByText(
      "Showing 11 matching requests",
    );
    expect(searchSummary).toBeVisible();
    expect(searchSummary).toHaveAttribute("aria-live", "polite");
    expect(
      approvedTab.querySelector(".workspace-tab-menu__count"),
    ).toHaveTextContent("11");
    fireEvent.click(await screen.findByRole("button", { name: "Next →" }));
    await waitFor(() =>
      expect(browseMyIngredientRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "approved", page: 2, query: "dragon fruit" }),
      ),
    );
  });

  it("keeps keyboard focus on navigation controls while refreshed results load", async () => {
    const filtered = deferred<MemberIngredientRequestPage>();
    const searched = deferred<MemberIngredientRequestPage>();
    const nextPage = deferred<MemberIngredientRequestPage>();
    const firstPage = requestPage([approved], { total: 21, total_pages: 2 });
    mocks.browseMyIngredientRequests
      .mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(filtered.promise)
      .mockReturnValueOnce(searched.promise)
      .mockReturnValueOnce(nextPage.promise);
    render(<MemberIngredientRequestHistory idPrefix="history" />);

    const region = await screen.findByRole("region", { name: "My ingredient requests" });
    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
    const status = screen.getByRole("button", { name: "Approved" });
    status.focus();
    fireEvent.click(status);
    expect(status).toHaveFocus();
    expect(status).toBeEnabled();
    expect(region).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      filtered.resolve(firstPage);
      await filtered.promise;
    });
    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
    expect(status).toHaveFocus();

    const search = screen.getByRole("searchbox", { name: "Search my ingredient requests" });
    search.focus();
    fireEvent.change(search, { target: { value: "pitaya" } });
    fireEvent.submit(search.closest("form")!);
    expect(search).toHaveFocus();
    expect(search).toBeEnabled();
    await act(async () => {
      searched.resolve(firstPage);
      await searched.promise;
    });
    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
    expect(search).toHaveFocus();

    const next = screen.getByRole("button", { name: "Next →" });
    next.focus();
    fireEvent.click(next);
    expect(next).toHaveFocus();
    expect(next).toBeEnabled();
    await act(async () => {
      nextPage.resolve(
        requestPage([duplicate], { page: 2, total: 21, total_pages: 2 }),
      );
      await nextPage.promise;
    });
    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
    expect(next).toHaveFocus();
  });

  it("recovers from a list-service error and then renders the empty state", async () => {
    const onRequestIngredient = vi.fn();
    mocks.browseMyIngredientRequests
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(requestPage([]));
    render(
      <MemberIngredientRequestHistory
        idPrefix="history"
        onRequestIngredient={onRequestIngredient}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your ingredient requests could not be loaded. Please try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    const emptyHeading = await screen.findByRole("heading", {
      level: 3,
      name: "You have no ingredient requests yet.",
    });
    const emptyState = emptyHeading.closest("section");

    expect(emptyState).not.toBeNull();
    expect(within(emptyState!).getByText("Nothing here yet")).toBeVisible();
    expect(
      within(emptyState!).getByText(
        "Request an ingredient and its review status will appear here.",
      ),
    ).toBeVisible();
    fireEvent.click(
      within(emptyState!).getByRole("button", { name: "Request an ingredient" }),
    );
    expect(onRequestIngredient).toHaveBeenCalledTimes(1);
  });

  it("keeps list authentication recovery inside standalone history", async () => {
    mocks.browseMyIngredientRequests
      .mockRejectedValueOnce(
        new IngredientCatalogApiError(
          "Sign in again.",
          401,
          "authentication_required",
        ),
      )
      .mockResolvedValueOnce(requestPage([approved]));
    render(<MemberIngredientRequestHistory idPrefix="history" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired. Sign in again, then retry your request history.",
    );
    expect(
      screen.getByRole("link", { name: "Sign in in a new tab" }),
    ).toHaveAttribute("target", "_blank");
    expect(
      screen.getByText(
        "After signing in, return to this tab and try loading your requests again.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("article", {
        name: "Ingredient request: Dragon fruit request text",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Sign in in a new tab" }),
    ).not.toBeInTheDocument();
  });

  it("uses the shared empty state for empty status filters and searches", async () => {
    mocks.browseMyIngredientRequests.mockResolvedValue(requestPage([]));
    render(<MemberIngredientRequestHistory idPrefix="history" />);

    await screen.findByRole("heading", {
      level: 3,
      name: "You have no ingredient requests yet.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    await waitFor(() =>
      expect(mocks.browseMyIngredientRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "rejected", page: 1 }),
      ),
    );

    const filteredHeading = await screen.findByRole("heading", {
      level: 3,
      name: "You have no rejected requests.",
    });
    const filteredEmptyState = filteredHeading.closest("section");
    expect(filteredEmptyState).not.toBeNull();
    expect(
      within(filteredEmptyState!).getByText(
        "Requests will appear here if a curator decides not to add them.",
      ),
    ).toBeVisible();

    fireEvent.click(
      within(filteredEmptyState!).getByRole("button", { name: "View all requests" }),
    );
    await screen.findByRole("heading", {
      level: 3,
      name: "You have no ingredient requests yet.",
    });

    const search = screen.getByRole("searchbox", {
      name: "Search my ingredient requests",
    });
    fireEvent.change(search, { target: { value: "saffron" } });
    fireEvent.submit(search.closest("form")!);

    const searchHeading = await screen.findByRole("heading", {
      level: 3,
      name: "No requests match your search.",
    });
    const searchEmptyState = searchHeading.closest("section");
    expect(searchEmptyState).not.toBeNull();
    expect(within(searchEmptyState!).getByText("No matches")).toBeVisible();
    expect(
      within(searchEmptyState!).getByText(
        "Try a different search term or clear the search.",
      ),
    ).toBeVisible();
    expect(
      within(searchEmptyState!).getByRole("button", { name: "Clear search" }),
    ).toBeVisible();
  });

});
