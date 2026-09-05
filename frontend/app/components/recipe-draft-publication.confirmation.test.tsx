import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { deferred } from "../../tests/support/deferred";
import {
  confirmPublication,
  distinctPreflight,
  getRecipeDraftPublicationMocks,
  probablePreflight,
  RECIPE_ID,
  RecipeDuplicateApiError,
  RecipePublicationApiError,
  renderPublication,
  resetRecipeDraftPublicationMocks,
} from "./recipe-draft-publication-test-support";

const mocks = getRecipeDraftPublicationMocks();
beforeEach(resetRecipeDraftPublicationMocks);

describe("RecipeDraftPublication", () => {
  it("does not auto-publish when confirmation is revoked during a pending preflight", async () => {
    const preflight = deferred<ReturnType<typeof distinctPreflight>>();
    mocks.preflight.mockReturnValue(preflight.promise);
    renderPublication();

    confirmPublication();
    const communityRules = screen
      .getAllByRole("checkbox", { name: /agree to the community rules/i })
      .at(-1)!;
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    await waitFor(() => expect(mocks.preflight).toHaveBeenCalledOnce());
    fireEvent.click(communityRules);

    await act(async () => {
      preflight.resolve(distinctPreflight());
      await preflight.promise;
    });

    await waitFor(() => expect(communityRules).toHaveFocus());
    expect(communityRules).not.toBeChecked();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /confirm the community rules/i,
    );
    expect(communityRules).toHaveAttribute(
      "aria-describedby",
      "draft-publication-confirmation-error",
    );
    expect(communityRules).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      /publishing paused.*your draft is still here/i,
    );
    expect(
      screen.getByRole("button", { name: "Review and publish" }),
    ).toBeDisabled();
  });

  it("pauses a retried preflight when confirmation is revoked while it is pending", async () => {
    const retryPreflight = deferred<ReturnType<typeof distinctPreflight>>();
    mocks.preflight
      .mockRejectedValueOnce(
        new RecipeDuplicateApiError(
          "Recipe Lab could not check this recipe right now.",
          503,
          "duplicate_preflight_unavailable",
        ),
      )
      .mockReturnValueOnce(retryPreflight.promise);
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    const retry = await screen.findByRole("button", {
      name: "Check similar recipes again",
    });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.preflight).toHaveBeenCalledTimes(2));

    const communityRules = screen
      .getAllByRole("checkbox", { name: /agree to the community rules/i })
      .at(-1)!;
    fireEvent.click(communityRules);
    await act(async () => {
      retryPreflight.resolve(distinctPreflight());
      await retryPreflight.promise;
    });

    await waitFor(() => expect(communityRules).toHaveFocus());
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Review and publish" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      /publishing paused.*your draft is still here/i,
    );
  });

  it("does not continue a duplicate publication after confirmation is revoked", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /publish my recipe anyway/i,
      }),
    );
    const contentRights = screen
      .getAllByRole("checkbox", { name: /right to share this recipe/i })
      .at(-1)!;
    fireEvent.click(contentRights);
    fireEvent.click(
      screen.getByRole("button", { name: "Publish recipe" }),
    );

    await waitFor(() => expect(contentRights).toHaveFocus());
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /confirm the community rules/i,
    );
    expect(
      screen.getByRole("checkbox", { name: /publish my recipe anyway/i }),
    ).toBeChecked();
  });

  it("does not retry publication after confirmation is revoked", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish
      .mockRejectedValueOnce(
        new RecipePublicationApiError(
          "Canonical occurrence 99999999-9999-4999-8999-999999999999 failed publication.",
          503,
          "recipe_publication_unavailable",
        ),
      )
      .mockResolvedValueOnce({
        recipe_version_id: RECIPE_ID,
        location: `/recipes/${RECIPE_ID}`,
      });
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /publish my recipe anyway/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Publish recipe" }),
    );
    const retry = await screen.findByRole("button", {
      name: "Try publishing again",
    });
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Recipe Lab could not publish this recipe. Your saved draft is still here.",
    );
    expect(screen.queryByText(/canonical|occurrence|99999999/i)).toBeNull();

    const communityRules = screen
      .getAllByRole("checkbox", { name: /agree to the community rules/i })
      .at(-1)!;
    fireEvent.click(communityRules);
    fireEvent.click(retry);

    await waitFor(() => expect(communityRules).toHaveFocus());
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(
      screen.getByText(/confirm the community rules and your right to share/i),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /publish my recipe anyway/i }),
    ).toBeChecked();

    fireEvent.click(communityRules);
    fireEvent.click(
      screen.getByRole("button", { name: "Try publishing again" }),
    );
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(mocks.publish.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        community_rules_accepted: true,
        content_rights_confirmed: true,
      }),
    );
  });
});

