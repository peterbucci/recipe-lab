import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CatalogIngredientPage,
  IngredientCatalogReviewPage,
} from "../../lib/ingredient-catalog-api";
import { IngredientCatalogApiError } from "../../lib/ingredient-catalog-api";
import {
  CURATOR_ID,
  INGREDIENT_ID,
  REQUEST_ID,
  reviewDetail,
  reviewItem,
  reviewPage,
} from "../../tests/support/ingredient-request-review";
import { AuthSessionProvider } from "./auth-session-provider";
import { DuplicateTargetSearch } from "./ingredient-request-duplicate-target-search";
import { IngredientRequestReviewWorkspace } from "./ingredient-request-review-workspace";

const mocks = vi.hoisted(() => ({
  browse: vi.fn(),
  detail: vi.fn(),
  review: vi.fn(),
  searchCatalog: vi.fn(),
}));

vi.mock("../../lib/ingredient-catalog-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ingredient-catalog-api")>();
  return {
    ...actual,
    browseIngredientCatalogReviewRequests: mocks.browse,
    fetchIngredientCatalogReviewDetail: mocks.detail,
    reviewIngredientCatalogRequest: mocks.review,
    searchCatalogIngredients: mocks.searchCatalog,
  };
});

function renderWorkspace(canReview = true) {
  return render(
    <AuthSessionProvider
      initialSession={{
        status: "authenticated",
        user: { id: CURATOR_ID, display_name: "Casey Curator", handle: "casey" },
        capabilities: { review_ingredient_requests: canReview, moderate_recipe_reports: false },
      }}
    >
      <IngredientRequestReviewWorkspace />
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  mocks.browse.mockReset();
  mocks.detail.mockReset();
  mocks.review.mockReset();
  mocks.searchCatalog.mockReset();
});

describe("IngredientRequestReviewWorkspace", () => {
  it("keeps duplicate-search progress in the initiating button", async () => {
    let resolveCatalog!: (page: CatalogIngredientPage) => void;
    let resolveRequests!: (page: IngredientCatalogReviewPage) => void;
    mocks.searchCatalog.mockReturnValue(
      new Promise<CatalogIngredientPage>((resolve) => {
        resolveCatalog = resolve;
      }),
    );
    mocks.browse.mockReturnValue(
      new Promise<IngredientCatalogReviewPage>((resolve) => {
        resolveRequests = resolve;
      }),
    );

    render(
      <DuplicateTargetSearch
        detail={reviewDetail()}
        disabled={false}
        inputName="duplicate-target"
        onSelect={() => undefined}
        value=""
      />,
    );

    fireEvent.change(screen.getByLabelText("Search duplicate targets"), {
      target: { value: "saffron" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const pendingSearch = screen.getByRole("button", { name: "Searching…" });
    expect(pendingSearch).toBeDisabled();
    expect(pendingSearch).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await act(async () => {
      resolveCatalog({
        items: [],
        page: 1,
        page_size: 10,
        total: 0,
        total_pages: 0,
      });
      resolveRequests(reviewPage([], { page_size: 10 }));
    });

    expect(
      await screen.findByText(
        "No existing ingredients or approved requests match saffron.",
      ),
    ).toBeVisible();
  });

  it("uses the shared section loader while the review queue resolves", () => {
    mocks.browse.mockReturnValue(new Promise(() => undefined));
    renderWorkspace();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading pending requests…");
    expect(status.closest(".section-loading--rows")).not.toBeNull();
  });

  it("does not discover or fetch curator controls for an ordinary member", () => {
    renderWorkspace(false);

    expect(screen.getByRole("main")).toHaveClass(
      "staff-state-page",
      "staff-state-page--curation",
      "staff-state-page--authorization",
    );
    expect(screen.getByRole("alert")).toHaveClass("staff-state-panel");
    expect(screen.getByRole("heading", { name: "We couldn’t find that page." })).toBeVisible();
    expect(screen.queryByText("Page unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Catalog curation")).not.toBeInTheDocument();
    expect(mocks.browse).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("loads the pending queue, focuses selected detail, and switches explicit filters", async () => {
    mocks.browse.mockImplementation(
      ({ status }: { status: string }) =>
        Promise.resolve(status === "pending" ? reviewPage() : reviewPage([])),
    );
    mocks.detail.mockResolvedValue(reviewDetail());
    renderWorkspace();

    const detailHeading = await screen.findByRole("heading", {
      name: "Dragon fruit",
      level: 2,
    });
    await waitFor(() => expect(detailHeading).toHaveFocus());
    expect(detailHeading.closest("main")).toHaveClass(
      "staff-workspace",
      "staff-workspace--curation",
      "curation-page",
    );
    expect(
      screen
        .getByRole("heading", { name: "Ingredient requests", level: 1 })
        .closest("header"),
    ).toHaveClass("staff-workspace__header", "curation-page__intro");
    expect(screen.queryByText("Catalog curation")).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Ingredient request status filters" }),
    ).toHaveClass("staff-workspace__filters", "curation-filters");
    const pendingHeader = document.querySelector(
      ".staff-workspace--curation .workspace-panel-header",
    );
    expect(pendingHeader).toHaveTextContent("Pending requests");
    expect(pendingHeader).toHaveTextContent(
      "Review requests waiting for a catalog decision.",
    );
    expect(pendingHeader).toHaveTextContent("1 request");
    const queueList = screen.getByRole("list", { name: "Pending requests" });
    expect(queueList).toHaveClass("staff-workspace__queue-list", "curation-request-list");
    expect(queueList.closest("section")).toHaveClass("staff-workspace__queue");
    expect(detailHeading.closest(".curation-detail")).toHaveClass("staff-workspace__detail");
    expect(detailHeading.closest(".curation-workspace")).toHaveClass("staff-workspace__layout");
    expect(
      screen.getByRole("heading", { name: "Decision" }).closest("section"),
    ).toHaveClass("staff-workspace__decision");
    expect(screen.queryByRole("link", { name: "Community rules" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Private note (optional)")).not.toBeInTheDocument();
    expect(screen.getByText("Alice Cook")).toBeVisible();
    expect(screen.getByText("@alice")).toBeVisible();
    expect(screen.getByText("Aliases: Dragon fruit")).toBeVisible();
    expect(screen.getByText("Pending request")).toBeVisible();

    const rejected = screen.getByRole("button", { name: "Rejected" });
    rejected.focus();
    expect(rejected).toHaveFocus();
    fireEvent.click(rejected);

    await waitFor(() =>
      expect(mocks.browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "rejected", page: 1, pageSize: 20 }),
      ),
    );
    const emptyHeading = await screen.findByRole("heading", {
      level: 3,
      name: "There are no rejected ingredient requests.",
    });
    const emptyState = emptyHeading.closest("section");
    expect(emptyState).toHaveClass("empty-state", "workspace-empty-state");
    expect(emptyState?.parentElement).toHaveClass("staff-workspace__tab-shell");
    expect(within(emptyState!).getByText("Nothing here yet")).toHaveClass(
      "eyebrow",
      "workspace-empty-state__eyebrow",
    );
    expect(
      within(emptyState!).getByText(
        "Rejected ingredient requests will appear here after a curator reviews them.",
      ),
    ).toBeVisible();
    expect(
      within(emptyState!).getByRole("button", { name: "Refresh requests" }),
    ).toBeVisible();
    expect(screen.queryByRole("searchbox", { name: "Search this queue" })).toBeNull();
    const rejectedHeader = document.querySelector(
      ".staff-workspace--curation .workspace-panel-header",
    );
    expect(rejectedHeader).toHaveTextContent("Rejected requests");
    expect(rejectedHeader).toHaveTextContent(
      "Requests that were not added to the catalog.",
    );
    expect(rejectedHeader).toHaveTextContent("0 requests");
    expect(
      screen.queryByText("Choose another status to review a different part of the queue."),
    ).not.toBeInTheDocument();
    expect(rejected).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the loaded detail when the selected queue item is clicked again", async () => {
    mocks.browse.mockResolvedValue(reviewPage());
    mocks.detail.mockResolvedValue(reviewDetail());
    renderWorkspace();

    await screen.findByLabelText("Canonical ingredient name");
    const queue = screen.getByRole("list", { name: "Pending requests" });
    const selectedItem = within(queue).getByRole("button");
    expect(selectedItem).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(selectedItem);

    expect(screen.getByLabelText("Canonical ingredient name")).toBeVisible();
    expect(mocks.detail).toHaveBeenCalledTimes(1);
  });

  it("validates and saves an approval, then focuses a visible success summary", async () => {
    mocks.browse
      .mockResolvedValueOnce(reviewPage())
      .mockResolvedValueOnce(reviewPage([]));
    mocks.detail.mockResolvedValue(reviewDetail());
    mocks.review.mockResolvedValue(
      reviewItem({
        status: "approved",
        updated_at: "2026-08-24T18:05:00Z",
        reviewed_at: "2026-08-24T18:05:00Z",
        decision_reason: "Reviewed as a distinct fruit.",
        reviewer_user_id: CURATOR_ID,
        resolved_ingredient_id: INGREDIENT_ID,
        approved_canonical_name: "Dragon fruit",
        approved_aliases: ["Pitaya fruit"],
        approval_provenance: "Reviewed culinary reference.",
      }),
    );
    renderWorkspace();

    await screen.findByRole("heading", { name: "Dragon fruit", level: 2 });
    expect(
      screen.getByText(/shown to the requesting member.*do not include private reviewer notes/i),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    await waitFor(() => expect(screen.getByLabelText("Decision reason")).toHaveFocus());
    expect(screen.getByText("Enter a reason for this catalog decision.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));
    fireEvent.change(screen.getByLabelText("Alias 1"), {
      target: { value: "Pitaya fruit" },
    });
    fireEvent.change(screen.getByLabelText("Decision reason"), {
      target: { value: "Reviewed as a distinct fruit." },
    });
    fireEvent.change(screen.getByLabelText("Approval provenance"), {
      target: { value: "Reviewed culinary reference." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));

    await waitFor(() =>
      expect(mocks.review).toHaveBeenCalledWith(REQUEST_ID, {
        decision: "approve",
        canonical_name: "Dragon fruit",
        aliases: ["Pitaya fruit"],
        reason: "Reviewed as a distinct fruit.",
        provenance: "Reviewed culinary reference.",
      }),
    );
    const success = await screen.findByRole("status");
    expect(success).toHaveTextContent("Decision saved.");
    expect(success).toHaveTextContent("Dragon fruit is now approved.");
    await waitFor(() => expect(success).toHaveFocus());
  });

  it("requires an explicit duplicate target and submits the stable target ID", async () => {
    mocks.browse.mockResolvedValue(reviewPage());
    mocks.detail.mockResolvedValue(reviewDetail());
    mocks.review.mockResolvedValue(
      reviewItem({
        status: "duplicate",
        updated_at: "2026-08-24T18:05:00Z",
        reviewed_at: "2026-08-24T18:05:00Z",
        decision_reason: "Already represented by Pitaya.",
        reviewer_user_id: CURATOR_ID,
        resolved_ingredient_id: INGREDIENT_ID,
      }),
    );
    renderWorkspace();

    await screen.findByRole("heading", { name: "Dragon fruit", level: 2 });
    fireEvent.click(screen.getByRole("radio", { name: /duplicate/i }));
    fireEvent.change(screen.getByLabelText("Decision reason"), {
      target: { value: "Already represented by Pitaya." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark as duplicate" }));
    expect(
      screen.getByText("Choose the existing ingredient or approved request this duplicates."),
    ).toBeVisible();

    const targets = screen.getByRole("group", { name: "Duplicate target" });
    fireEvent.click(within(targets).getByRole("radio", { name: /existing catalog ingredient/i }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as duplicate" }));

    await waitFor(() =>
      expect(mocks.review).toHaveBeenCalledWith(REQUEST_ID, {
        decision: "duplicate",
        reason: "Already represented by Pitaya.",
        ingredient_id: INGREDIENT_ID,
        request_id: null,
      }),
    );
  });

  it("searches beyond suggestions and preserves the selected approved target on a stale conflict", async () => {
    const searchedRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const searchedIngredientId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const pendingDetail = reviewDetail({
      catalog_candidates: [],
      request_candidates: [],
    });
    const current = reviewDetail({
      status: "approved",
      updated_at: "2026-08-24T18:06:00Z",
      reviewed_at: "2026-08-24T18:06:00Z",
      decision_reason: "Another curator completed this review.",
      reviewer_user_id: CURATOR_ID,
      resolved_ingredient_id: INGREDIENT_ID,
      approved_canonical_name: "Dragon fruit",
      approved_aliases: [],
      approval_provenance: "Peer review.",
      catalog_candidates: [],
      request_candidates: [],
    });
    const approvedTarget = reviewItem({
      id: searchedRequestId,
      proposed_name: "Saffron spice",
      status: "approved",
      updated_at: "2026-08-23T18:05:00Z",
      reviewed_at: "2026-08-23T18:05:00Z",
      decision_reason: "Reviewed spice identity.",
      reviewer_user_id: CURATOR_ID,
      resolved_ingredient_id: searchedIngredientId,
      approved_canonical_name: "Saffron threads",
      approved_aliases: [],
      approval_provenance: "Reviewed reference.",
    });
    mocks.browse.mockImplementation(
      ({ status, pageSize, query }: { status?: string; pageSize?: number; query?: string }) =>
        Promise.resolve(
          status === "approved" && pageSize === 10 && query === "saffron"
            ? reviewPage([approvedTarget], { page_size: 10 })
            : reviewPage(),
        ),
    );
    mocks.searchCatalog.mockResolvedValue({
      items: [
        {
          id: searchedIngredientId,
          canonical_name: "Saffron",
          aliases: ["Saffron threads"],
        },
      ],
      page: 1,
      page_size: 10,
      total: 1,
      total_pages: 1,
    });
    mocks.detail.mockResolvedValueOnce(pendingDetail).mockResolvedValueOnce(current);
    mocks.review.mockRejectedValue(
      new IngredientCatalogApiError(
        "This request has already received a decision.",
        409,
        "ingredient_request_already_reviewed",
      ),
    );
    renderWorkspace();

    await screen.findByRole("heading", { name: "Dragon fruit", level: 2 });
    fireEvent.click(screen.getByRole("radio", { name: /duplicate/i }));
    const targetSearch = screen.getByLabelText("Search duplicate targets");
    expect(targetSearch).toHaveAttribute("maxlength", "100");
    fireEvent.change(targetSearch, { target: { value: "saffron" } });
    fireEvent.keyDown(targetSearch, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.searchCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ query: "saffron", page: 1, pageSize: 10 }),
      ),
    );
    expect(mocks.browse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "approved",
        query: "saffron",
        page: 1,
        pageSize: 10,
      }),
    );
    expect(
      await screen.findByRole("radio", { name: /Saffron.*Existing catalog ingredient/i }),
    ).toBeVisible();
    const approvedTargetRadio = screen.getByRole("radio", {
      name: /Saffron threads.*Already-approved request/i,
    });
    fireEvent.click(approvedTargetRadio);
    fireEvent.change(screen.getByLabelText("Decision reason"), {
      target: { value: "The approved request already represents this ingredient." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark as duplicate" }));

    await waitFor(() =>
      expect(mocks.review).toHaveBeenCalledWith(REQUEST_ID, {
        decision: "duplicate",
        reason: "The approved request already represents this ingredient.",
        ingredient_id: null,
        request_id: searchedRequestId,
      }),
    );
    const staleAlert = await screen.findByRole("alert");
    expect(staleAlert).toHaveClass("staff-workspace__notice", "staff-workspace__notice--error");
    expect(staleAlert).toHaveTextContent(
      "Your entered review is still here.",
    );
    expect(targetSearch).toHaveValue("saffron");
    expect(approvedTargetRadio).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Load current request" }));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Search duplicate targets")).toHaveValue("saffron");
    expect(
      screen.getByRole("radio", { name: /Saffron threads.*Already-approved request/i }),
    ).toBeChecked();
  });

  it("preserves entered fields through a stale conflict and current-state refresh", async () => {
    const current = reviewDetail({
      status: "approved",
      updated_at: "2026-08-24T18:06:00Z",
      reviewed_at: "2026-08-24T18:06:00Z",
      decision_reason: "Another curator completed this review.",
      reviewer_user_id: CURATOR_ID,
      resolved_ingredient_id: INGREDIENT_ID,
      approved_canonical_name: "Dragon fruit",
      approved_aliases: [],
      approval_provenance: "Peer review.",
    });
    mocks.browse.mockResolvedValue(reviewPage());
    mocks.detail.mockResolvedValueOnce(reviewDetail()).mockResolvedValueOnce(current);
    mocks.review.mockRejectedValue(
      new IngredientCatalogApiError(
        "This request has already received a decision.",
        409,
        "ingredient_request_already_reviewed",
      ),
    );
    renderWorkspace();

    await screen.findByRole("heading", { name: "Dragon fruit", level: 2 });
    fireEvent.change(screen.getByLabelText("Canonical ingredient name"), {
      target: { value: "Pink dragon fruit" },
    });
    fireEvent.change(screen.getByLabelText("Decision reason"), {
      target: { value: "My careful review notes." },
    });
    fireEvent.change(screen.getByLabelText("Approval provenance"), {
      target: { value: "My source notes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your entered review is still here.",
    );
    expect(screen.getByLabelText("Canonical ingredient name")).toHaveValue("Pink dragon fruit");
    expect(screen.getByLabelText("Decision reason")).toHaveValue("My careful review notes.");

    fireEvent.click(screen.getByRole("button", { name: "Load current request" }));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Another curator completed this review.")).toBeVisible();
    expect(screen.getByLabelText("Canonical ingredient name")).toHaveValue("Pink dragon fruit");
    expect(screen.getByLabelText("Decision reason")).toHaveValue("My careful review notes.");
    expect(screen.getByLabelText("Canonical ingredient name")).toBeDisabled();
  });
});
