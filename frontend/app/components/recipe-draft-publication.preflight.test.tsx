import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { deferred } from "../../tests/support/deferred";
import {
  confirmPublication,
  distinctPreflight,
  DRAFT_ID,
  getRecipeDraftPublicationMocks,
  PREFLIGHT_ID,
  probablePreflight,
  RECIPE_ID,
  renderPublication,
  resetRecipeDraftPublicationMocks,
} from "./recipe-draft-publication-test-support";

const mocks = getRecipeDraftPublicationMocks();
beforeEach(resetRecipeDraftPublicationMocks);

describe("RecipeDraftPublication", () => {
  it("pauses on a probable match and publishes only after explicit acknowledgement", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish.mockResolvedValue({
      recipe_version_id: RECIPE_ID,
      location: `/recipes/${RECIPE_ID}`,
    });
    renderPublication();

    const publication = screen.getByRole("region", {
      name: "Publication details",
    });
    expect(publication).toHaveClass("draft-publication--original");
    expect(publication).not.toHaveClass("draft-publication--review");
    expect(screen.getByText(/start a new recipe family/i)).toBeVisible();
    const review = screen.getByRole("button", {
      name: "Review and publish",
    });
    expect(review).toBeDisabled();

    fireEvent.click(review);
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    confirmPublication();
    expect(review).toBeEnabled();
    fireEvent.click(review);
    await waitFor(() =>
      expect(mocks.preflight).toHaveBeenCalledWith(
        DRAFT_ID,
        4,
        "preflight-key",
        expect.anything(),
      ),
    );
    const continueButton = await screen.findByRole("button", {
      name: "Publish recipe",
    });
    const similarityReview = screen.getByRole("region", {
      name: "This recipe is similar to another public recipe",
    });
    const reviewConfirmations = within(similarityReview).getAllByRole("checkbox");
    expect(reviewConfirmations).toHaveLength(2);
    expect(reviewConfirmations[0]).toHaveAccessibleName(
      /right to share this recipe.*community rules/i,
    );
    expect(reviewConfirmations[1]).toHaveAccessibleName(/publish my recipe anyway/i);
    expect(
      within(similarityReview)
        .getByText("Why is Recipe Lab showing this?")
        .closest("details"),
    ).not.toHaveAttribute("open");
    expect(publication).toHaveClass("draft-publication--review");
    expect(continueButton).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /publish my recipe anyway/i }),
    );
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    await waitFor(() =>
      expect(mocks.publish).toHaveBeenCalledWith(
        DRAFT_ID,
        {
          revision: 4,
          community_rules_accepted: true,
          content_rights_confirmed: true,
          duplicate_review: {
            preflight_id: PREFLIGHT_ID,
            policy_version: "recipe-duplicate-preflight-policy-v1",
            result_digest: "a".repeat(64),
            decision: "continue",
          },
        },
        "publish-key",
        expect.anything(),
      ),
    );
    expect(mocks.replace).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}`);
    expect(screen.getByText("Recipe published. Opening it…")).toHaveAttribute(
      "role",
      "status",
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("publishes a distinct recipe without showing an empty similarity review", async () => {
    mocks.preflight.mockResolvedValue(distinctPreflight());
    mocks.publish.mockResolvedValue({
      recipe_version_id: RECIPE_ID,
      location: `/recipes/${RECIPE_ID}`,
    });
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("region", { name: /similar recipes/i }),
    ).toBeNull();
    expect(mocks.publish).toHaveBeenCalledWith(
      DRAFT_ID,
      expect.objectContaining({
        duplicate_review: expect.objectContaining({ decision: null }),
      }),
      "publish-key",
      expect.anything(),
    );
    expect(mocks.replace).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}`);
  });

  it("keeps duplicate acknowledgement visible while publication is pending", async () => {
    const publication = deferred<{
      recipe_version_id: string;
      location: string;
    }>();
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish.mockReturnValue(publication.promise);
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    const acknowledgement = await screen.findByRole("checkbox", {
      name: /publish my recipe anyway/i,
    });
    fireEvent.click(acknowledgement);
    fireEvent.click(
      screen.getByRole("button", { name: "Publish recipe" }),
    );

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    expect(acknowledgement).toBeChecked();

    await act(async () => {
      publication.resolve({
        recipe_version_id: RECIPE_ID,
        location: `/recipes/${RECIPE_ID}`,
      });
      await publication.promise;
    });
  });

  it("aborts an in-flight similarity review when its publication surface unmounts", async () => {
    mocks.preflight.mockReturnValue(new Promise(() => undefined));
    const view = renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    await waitFor(() => expect(mocks.preflight).toHaveBeenCalledOnce());

    const signal = mocks.preflight.mock.calls[0]?.[3] as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

