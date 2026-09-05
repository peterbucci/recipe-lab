import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

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

const mocks = getIngredientRequestReviewMocks();
beforeEach(resetIngredientRequestReviewMocks);

describe("IngredientRequestReviewWorkspace", () => {
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

