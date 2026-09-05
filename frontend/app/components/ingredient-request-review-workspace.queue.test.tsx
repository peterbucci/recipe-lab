import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  reviewDetail,
  reviewPage,
} from "../../tests/support/ingredient-request-review";
import {
  getIngredientRequestReviewMocks,
  renderIngredientRequestReviewWorkspace as renderWorkspace,
  resetIngredientRequestReviewMocks,
} from "./ingredient-request-review-workspace-test-support";

const mocks = getIngredientRequestReviewMocks();
beforeEach(resetIngredientRequestReviewMocks);

describe("IngredientRequestReviewWorkspace", () => {
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
});

