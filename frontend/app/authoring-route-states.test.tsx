import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LegacyRecipeDraftEditorError from "./account/recipe-drafts/[draftId]/error";
import LegacyRecipeDraftEditorLoading from "./account/recipe-drafts/[draftId]/loading";
import RecipeDraftEditorError from "./recipes/drafts/[draftId]/error";
import RecipeDraftEditorLoading from "./recipes/drafts/[draftId]/loading";
import RecipeDraftNotFound from "./recipes/drafts/[draftId]/not-found";

describe("recipe authoring route states", () => {
  it.each([RecipeDraftEditorLoading, LegacyRecipeDraftEditorLoading])(
    "uses the destination-shaped authoring skeleton for %s",
    (LoadingState) => {
      render(<LoadingState />);

      expect(screen.getByRole("main")).toHaveClass(
        "page-loading--authoring",
        "recipe-reading-page",
        "draft-editor-page--loading",
      );
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Loading your private recipe draft",
      );
      expect(document.querySelector(".loading-state__pulse")).toBeNull();
    },
  );

  it.each([RecipeDraftEditorError, LegacyRecipeDraftEditorError])(
    "scopes the route failure and uses Next's refetching retry for %s",
    (ErrorState) => {
      const retry = vi.fn();
      render(<ErrorState error={new Error("safe failure")} retry={retry} />);

      expect(screen.getByRole("main")).toHaveClass("recipe-authoring-state--error");
      expect(screen.getByRole("alert")).toHaveClass(
        "recipe-authoring-state__panel",
        "blocking-error-state",
      );
      expect(screen.getByText("Something went wrong")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(retry).toHaveBeenCalledOnce();
      expect(screen.getByRole("link", { name: "My recipes" })).toHaveAttribute(
        "href",
        "/account/recipes?view=drafts",
      );
    },
  );

  it("scopes an unavailable private draft without changing privacy copy", () => {
    render(<RecipeDraftNotFound />);

    expect(screen.getByRole("main")).toHaveClass(
      "recipe-authoring-state",
      "recipe-authoring-state--unavailable",
    );
    expect(
      screen.getByRole("heading", { name: "We couldn’t open that draft." }).closest("section"),
    ).toHaveClass("recipe-authoring-state__panel");
    expect(screen.getByText(/belong to another account/i)).toBeVisible();
  });
});
