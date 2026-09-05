import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  CatalogIngredientPage,
  IngredientCatalogReviewPage,
} from "../../lib/ingredient-catalog-api";
import {
  CURATOR_ID,
  INGREDIENT_ID,
  REQUEST_ID,
  reviewDetail,
  reviewItem,
  reviewPage,
} from "../../tests/support/ingredient-request-review";
import {
  getIngredientRequestReviewMocks,
  IngredientCatalogApiError,
  renderIngredientRequestReviewWorkspace as renderWorkspace,
  resetIngredientRequestReviewMocks,
} from "./ingredient-request-review-workspace-test-support";
import { DuplicateTargetSearch } from "./ingredient-request-duplicate-target-search";

const mocks = getIngredientRequestReviewMocks();
beforeEach(resetIngredientRequestReviewMocks);

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
});

