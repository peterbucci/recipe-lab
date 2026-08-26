import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  IngredientCatalogReviewDetail,
  IngredientCatalogReviewItem,
  IngredientCatalogReviewPage,
} from "../../lib/ingredient-catalog-api";
import { IngredientCatalogApiError } from "../../lib/ingredient-catalog-api";
import { AuthSessionProvider } from "./auth-session-provider";
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

const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const REQUESTER_ID = "77777777-7777-4777-8777-777777777777";
const CURATOR_ID = "88888888-8888-4888-8888-888888888888";
const INGREDIENT_ID = "33333333-3333-4333-8333-333333333333";
const APPROVED_REQUEST_ID = "99999999-9999-4999-8999-999999999999";

function reviewItem(
  overrides: Partial<IngredientCatalogReviewItem> = {},
): IngredientCatalogReviewItem {
  return {
    id: REQUEST_ID,
    proposed_name: "Dragon fruit",
    context: "Fresh pink fruit seen at a neighborhood market.",
    status: "pending",
    created_at: "2026-08-24T18:00:00Z",
    updated_at: "2026-08-24T18:00:00Z",
    reviewed_at: null,
    decision_reason: null,
    resolved_ingredient_id: null,
    requester_user_id: REQUESTER_ID,
    reviewer_user_id: null,
    duplicate_of_request_id: null,
    approved_canonical_name: null,
    approved_aliases: null,
    approval_provenance: null,
    ...overrides,
  };
}

function reviewDetail(
  overrides: Partial<IngredientCatalogReviewDetail> = {},
): IngredientCatalogReviewDetail {
  return {
    ...reviewItem(),
    requester: {
      id: REQUESTER_ID,
      handle: "alice",
      display_name: "Alice Cook",
    },
    catalog_candidates: [
      {
        id: INGREDIENT_ID,
        canonical_name: "Pitaya",
        aliases: ["Dragon fruit"],
      },
    ],
    request_candidates: [
      {
        id: APPROVED_REQUEST_ID,
        proposed_name: "Red pitaya",
        status: "approved",
        created_at: "2026-08-23T18:00:00Z",
        resolved_ingredient_id: INGREDIENT_ID,
        approved_canonical_name: "Pitaya",
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        proposed_name: "Golden dragon fruit",
        status: "pending",
        created_at: "2026-08-24T17:00:00Z",
        resolved_ingredient_id: null,
        approved_canonical_name: null,
      },
    ],
    ...overrides,
  };
}

function reviewPage(
  items: IngredientCatalogReviewItem[] = [reviewItem()],
  overrides: Partial<IngredientCatalogReviewPage> = {},
): IngredientCatalogReviewPage {
  return {
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    total_pages: items.length ? 1 : 0,
    ...overrides,
  };
}

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
  it("does not discover or fetch curator controls for an ordinary member", () => {
    renderWorkspace(false);

    expect(screen.getByRole("heading", { name: "We couldn’t find that page." })).toBeVisible();
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
    expect(await screen.findByText("No rejected requests.")).toBeVisible();
    expect(rejected).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the loaded detail when the selected queue item is clicked again", async () => {
    mocks.browse.mockResolvedValue(reviewPage());
    mocks.detail.mockResolvedValue(reviewDetail());
    renderWorkspace();

    await screen.findByLabelText("Reviewed canonical name");
    const queue = screen.getByRole("list", { name: "Pending requests" });
    const selectedItem = within(queue).getByRole("button");
    expect(selectedItem).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(selectedItem);

    expect(screen.getByLabelText("Reviewed canonical name")).toBeVisible();
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
    fireEvent.click(screen.getByRole("button", { name: "Save approve decision" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Save approve decision" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Save duplicate decision" }));
    expect(
      screen.getByText("Choose the existing ingredient or approved request this duplicates."),
    ).toBeVisible();

    const targets = screen.getByRole("group", { name: "Duplicate target" });
    fireEvent.click(within(targets).getByRole("radio", { name: /existing catalog ingredient/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save duplicate decision" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Save duplicate decision" }));

    await waitFor(() =>
      expect(mocks.review).toHaveBeenCalledWith(REQUEST_ID, {
        decision: "duplicate",
        reason: "The approved request already represents this ingredient.",
        ingredient_id: null,
        request_id: searchedRequestId,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
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
    fireEvent.change(screen.getByLabelText("Reviewed canonical name"), {
      target: { value: "Pink dragon fruit" },
    });
    fireEvent.change(screen.getByLabelText("Decision reason"), {
      target: { value: "My careful review notes." },
    });
    fireEvent.change(screen.getByLabelText("Approval provenance"), {
      target: { value: "My source notes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save approve decision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your entered review is still here.",
    );
    expect(screen.getByLabelText("Reviewed canonical name")).toHaveValue("Pink dragon fruit");
    expect(screen.getByLabelText("Decision reason")).toHaveValue("My careful review notes.");

    fireEvent.click(screen.getByRole("button", { name: "Load current request" }));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Another curator completed this review.")).toBeVisible();
    expect(screen.getByLabelText("Reviewed canonical name")).toHaveValue("Pink dragon fruit");
    expect(screen.getByLabelText("Decision reason")).toHaveValue("My careful review notes.");
    expect(screen.getByLabelText("Reviewed canonical name")).toBeDisabled();
  });
});
