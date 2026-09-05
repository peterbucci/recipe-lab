import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IngredientCatalogApiError } from "../../lib/ingredient-catalog-api";
import {
  CURATOR_ID,
  INGREDIENT_ID,
  REQUEST_ID,
  reviewDetail,
  reviewItem,
} from "../../tests/support/ingredient-request-review";
import { IngredientRequestDecisionForm } from "./ingredient-request-decision-form";

const mocks = vi.hoisted(() => ({ review: vi.fn() }));

vi.mock("../../lib/ingredient-catalog-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ingredient-catalog-api")>();
  return { ...actual, reviewIngredientCatalogRequest: mocks.review };
});

function renderDecisionForm() {
  const onAuthorizationLost = vi.fn();
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const onReviewed = vi.fn();
  render(
    <IngredientRequestDecisionForm
      detail={reviewDetail()}
      onAuthorizationLost={onAuthorizationLost}
      onRefresh={onRefresh}
      onReviewed={onReviewed}
    />,
  );
  return { onAuthorizationLost, onRefresh, onReviewed };
}

function completeRequiredApprovalFields() {
  fireEvent.change(screen.getByLabelText("Decision reason"), {
    target: { value: "Reviewed as a distinct ingredient." },
  });
  fireEvent.change(screen.getByLabelText("Approval provenance"), {
    target: { value: "Reviewed culinary reference." },
  });
}

beforeEach(() => {
  mocks.review.mockReset();
});

describe("IngredientRequestDecisionForm", () => {
  it("reports required approval fields and focuses the first invalid field", async () => {
    renderDecisionForm();
    fireEvent.change(screen.getByLabelText("Canonical ingredient name"), {
      target: { value: "   " },
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));

    expect(
      screen.getByText("Enter the reviewed canonical ingredient name."),
    ).toBeVisible();
    expect(
      screen.getByText("Enter a reason for this catalog decision."),
    ).toBeVisible();
    expect(
      screen.getByText("Describe the source or basis for this approval."),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByLabelText("Canonical ingredient name")).toHaveFocus(),
    );
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("enforces the documented field length limits", async () => {
    renderDecisionForm();
    fireEvent.change(screen.getByLabelText("Canonical ingredient name"), {
      target: { value: "c".repeat(201) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));
    fireEvent.change(screen.getByLabelText("Alias 1"), {
      target: { value: "a".repeat(201) },
    });
    fireEvent.change(screen.getByLabelText("Decision reason"), {
      target: { value: "r".repeat(1_001) },
    });
    fireEvent.change(screen.getByLabelText("Approval provenance"), {
      target: { value: "p".repeat(1_001) },
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));

    expect(
      screen.getByText("Canonical name must be 200 characters or fewer."),
    ).toBeVisible();
    expect(
      screen.getByText("Each alias must be 200 characters or fewer."),
    ).toBeVisible();
    expect(
      screen.getByText("Decision reason must be 1,000 characters or fewer."),
    ).toBeVisible();
    expect(
      screen.getByText("Provenance must be 1,000 characters or fewer."),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByLabelText("Canonical ingredient name")).toHaveFocus(),
    );
  });

  it("rejects aliases that repeat one another without regard to case", async () => {
    renderDecisionForm();
    completeRequiredApprovalFields();
    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));
    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));
    fireEvent.change(screen.getByLabelText("Alias 1"), {
      target: { value: "Pitaya" },
    });
    fireEvent.change(screen.getByLabelText("Alias 2"), {
      target: { value: "pitaya" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));

    expect(screen.getByText("Approved aliases must be unique.")).toBeVisible();
    await waitFor(() =>
      expect(document.getElementById(`catalog-review-${REQUEST_ID}-aliases`)).toHaveFocus(),
    );
  });

  it("rejects an alias that repeats the canonical name", async () => {
    renderDecisionForm();
    completeRequiredApprovalFields();
    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));
    fireEvent.change(screen.getByLabelText("Alias 1"), {
      target: { value: "DRAGON FRUIT" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));

    expect(
      screen.getByText("The canonical name cannot also be an alias."),
    ).toBeVisible();
  });

  it("maps server validation issues to fields and focuses the first one", async () => {
    mocks.review.mockRejectedValueOnce(
      new IngredientCatalogApiError(
        "Review validation failed.",
        422,
        "validation_error",
        [
          {
            location: ["body", "canonical_name"],
            message: "Use the catalog spelling.",
            type: "validation_error",
          },
          {
            location: ["body", "aliases", 0],
            message: "Remove this alias.",
            type: "validation_error",
          },
          {
            location: ["body", "provenance"],
            message: "Name a review source.",
            type: "validation_error",
          },
        ],
      ),
    );
    renderDecisionForm();
    completeRequiredApprovalFields();

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));

    expect(await screen.findByText("Use the catalog spelling.")).toBeVisible();
    expect(screen.getByText("Remove this alias.")).toBeVisible();
    expect(screen.getByText("Name a review source.")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByLabelText("Canonical ingredient name")).toHaveFocus(),
    );
  });

  it("reports authorization loss without showing an ordinary save error", async () => {
    mocks.review.mockRejectedValueOnce(
      new IngredientCatalogApiError("Curator access expired.", 403),
    );
    const { onAuthorizationLost } = renderDecisionForm();
    completeRequiredApprovalFields();

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("preserves entered values after an ordinary failure and can retry", async () => {
    mocks.review
      .mockRejectedValueOnce(new IngredientCatalogApiError("Service unavailable.", 503))
      .mockResolvedValueOnce(
        reviewItem({
          status: "approved",
          reviewed_at: "2026-08-24T18:05:00Z",
          reviewer_user_id: CURATOR_ID,
          resolved_ingredient_id: INGREDIENT_ID,
          approved_canonical_name: "Pink dragon fruit",
          approved_aliases: [],
          approval_provenance: "Reviewed culinary reference.",
          decision_reason: "Reviewed as a distinct ingredient.",
        }),
      );
    const { onReviewed } = renderDecisionForm();
    fireEvent.change(screen.getByLabelText("Canonical ingredient name"), {
      target: { value: "Pink dragon fruit" },
    });
    completeRequiredApprovalFields();

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ingredient review could not be saved. Please try again.",
    );
    expect(screen.getByLabelText("Canonical ingredient name")).toHaveValue(
      "Pink dragon fruit",
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    await waitFor(() => expect(onReviewed).toHaveBeenCalledOnce());
    expect(mocks.review).toHaveBeenCalledTimes(2);
  });
});
