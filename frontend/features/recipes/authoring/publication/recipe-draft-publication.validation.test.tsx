import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmPublication,
  directParentNoChangePreflight,
  DRAFT_ID,
  getRecipeDraftPublicationMocks,
  PREFLIGHT_ID,
  RECIPE_ID,
  RecipePublicationApiError,
  renderPublication,
  resetRecipeDraftPublicationMocks,
  SOURCE_ID,
} from "./recipe-draft-publication-test-support";

const mocks = getRecipeDraftPublicationMocks();
beforeEach(resetRecipeDraftPublicationMocks);

describe("RecipeDraftPublication", () => {
  it("requires a confirmed save and publication-complete fields before review", async () => {
    const dirtyPublication = renderPublication({ dirty: true });
    expect(
      screen.getByRole("button", { name: "Review and publish" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Save your latest changes before publishing."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "You can withdraw a published recipe later from My Recipes.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", {
        name: /right to share this recipe.*community rules/i,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("link", { name: "community rules" }),
    ).toHaveAttribute("href", "/community-rules");
    dirtyPublication.unmount();

    const onValidation = vi.fn();
    renderPublication({
      draft: {
        title: "",
        description: "",
        servings: "",
        totalTimeMinutes: "",
        activeTimeMinutes: "",
        difficulty: "",
        notes: "",
        categories: [],
        ingredients: [],
        instructions: [],
      },
      onValidation,
    });
    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    expect(onValidation).toHaveBeenCalledWith(
      expect.objectContaining({ payload: null }),
    );
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("requires an explicit unchanged-version decision before publishing a version", async () => {
    mocks.preflight.mockResolvedValue(directParentNoChangePreflight());
    mocks.publish.mockResolvedValue({
      recipe_version_id: RECIPE_ID,
      location: `/recipes/${RECIPE_ID}`,
    });
    renderPublication({
      sourceRecipeTitle: "Public sage recipe",
      sourceVersionId: SOURCE_ID,
    });

    expect(screen.getByText("Public sage recipe")).toBeVisible();
    expect(screen.getByText(/source recipe will not change/i)).toBeVisible();
    confirmPublication();
    fireEvent.click(
      screen.getByRole("button", { name: "Review and publish version" }),
    );

    const acknowledgement = await screen.findByRole("checkbox", {
      name: /closely matches its source/i,
    });
    expect(
      screen.getByText("This version is very close to its source"),
    ).toBeVisible();
    expect(screen.queryByText(/direct parent|canonical|immutable/i)).toBeNull();
    const publishAnyway = screen.getByRole("button", {
      name: "Publish version",
    });
    expect(publishAnyway).toBeDisabled();
    fireEvent.click(acknowledgement);
    fireEvent.click(publishAnyway);

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
            result_digest: "b".repeat(64),
            decision: "continue",
          },
        },
        "publish-key",
        expect.anything(),
      ),
    );
    expect(mocks.replace).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}`);
  });

  it("keeps a fork draft in place when its source becomes unavailable", async () => {
    mocks.preflight.mockResolvedValue(directParentNoChangePreflight());
    mocks.publish.mockRejectedValue(
      new RecipePublicationApiError(
        "The public source recipe is no longer available. Your private draft is unchanged.",
        409,
        "recipe_fork_source_unavailable",
      ),
    );
    renderPublication({
      sourceRecipeTitle: "Public sage recipe",
      sourceVersionId: SOURCE_ID,
    });

    confirmPublication();
    fireEvent.click(
      screen.getByRole("button", { name: "Review and publish version" }),
    );
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /closely matches its source/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Publish version" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The recipe this version is based on is no longer available. Your private draft is unchanged.",
    );
    expect(
      screen.getByRole("button", { name: "Check source and retry" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Check source page" }),
    ).toHaveAttribute("href", `/recipes/${SOURCE_ID}`);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "Publication details" }),
    ).toBeVisible();
  });
});

