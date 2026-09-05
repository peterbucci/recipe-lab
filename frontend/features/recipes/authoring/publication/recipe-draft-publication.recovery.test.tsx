import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthApiError,
  confirmPublication,
  distinctPreflight,
  DRAFT_ID,
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
  it("explains that publication waits for an unavailable similarity check and only offers retry", async () => {
    mocks.preflight.mockRejectedValue(
      new RecipeDuplicateApiError(
        "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
        503,
        "duplicate_preflight_unavailable",
      ),
    );
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    const retry = await screen.findByRole("button", {
      name: "Check similar recipes again",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /similar-recipes check unavailable/i,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/publishing waits/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/saved draft.*still/i);
    expect(
      screen.queryByRole("button", { name: /publish without/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Review and publish" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Publication details" }),
    ).toBeVisible();

    fireEvent.click(retry);
    await waitFor(() => expect(mocks.preflight).toHaveBeenCalledTimes(2));
    expect(mocks.preflight.mock.calls.map((call) => call[2])).toEqual([
      "preflight-key",
      "preflight-key",
    ]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous reviewed publication with the same publication key", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish
      .mockRejectedValueOnce(
        new RecipePublicationApiError(
          "Recipe Lab could not confirm the publication receipt.",
          502,
          "invalid_recipe_publication_response",
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
      name: "Check publication result",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /may already be published/i,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /cannot create a second publication/i,
    );
    fireEvent.click(retry);

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(mocks.publish.mock.calls.map((call) => call[2])).toEqual([
      "publish-key",
      "publish-key",
    ]);
    expect(mocks.replace).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}`);
  });

  it("checks a lost distinct publication result directly with the same publication key", async () => {
    const onBusyChange = vi.fn();
    mocks.preflight.mockResolvedValue(distinctPreflight());
    mocks.publish
      .mockRejectedValueOnce(new TypeError("private network detail"))
      .mockResolvedValueOnce({
        recipe_version_id: RECIPE_ID,
        location: `/recipes/${RECIPE_ID}`,
      });
    renderPublication({ onBusyChange });

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));

    const retry = await screen.findByRole("button", {
      name: "Check publication result",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /may already be published/i,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /cannot create a second publication/i,
    );
    expect(screen.queryByRole("button", { name: "Keep editing" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Review and publish" }),
    ).toBeNull();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(retry);

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(mocks.preflight).toHaveBeenCalledOnce();
    expect(mocks.publish.mock.calls.map((call) => call[2])).toEqual([
      "publish-key",
      "publish-key",
    ]);
  });

  it("classifies a pre-request authentication interruption and keeps review context", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish.mockRejectedValue(
      new AuthApiError(
        "Your session expired. Sign in again to continue.",
        401,
        "csrf_token_unavailable",
      ),
    );
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

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired. Your draft is still here; sign in again before continuing.",
    );
    expect(
      screen.getByRole("link", { name: "Sign in again in a new tab" }),
    ).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2Fdrafts%2F${DRAFT_ID}`,
    );
    expect(
      screen.getByRole("button", { name: "Try publishing again" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "This recipe is similar to another public recipe",
      }),
    ).toBeVisible();
  });

  it("classifies a revision conflict and directs the author to the latest saved draft", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish.mockRejectedValue(
      new RecipePublicationApiError(
        "The draft has a newer saved revision.",
        409,
        "recipe_draft_revision_conflict",
      ),
    );
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

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This draft changed in another tab. Open the latest saved draft before publishing.",
    );
    expect(
      screen.getByRole("link", { name: "Open latest draft in a new tab" }),
    ).toHaveAttribute("href", `/recipes/drafts/${DRAFT_ID}`);
    expect(
      screen.getByRole("link", { name: "Open latest draft in a new tab" }),
    ).toHaveAttribute("target", "_blank");
    expect(
      screen.queryByRole("button", { name: "Check similar recipes again" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep editing" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Review and publish" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "This recipe is similar to another public recipe",
      }),
    ).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

