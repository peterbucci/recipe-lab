import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RecipeDraftEditorError from "./account/recipe-drafts/[draftId]/error";
import RecipeDraftEditorLoading from "./account/recipe-drafts/[draftId]/loading";
import RecipeDraftNotFound from "./account/recipe-drafts/[draftId]/not-found";

describe("recipe authoring route states", () => {
  it("scopes the private draft loading state", () => {
    render(<RecipeDraftEditorLoading />);

    expect(screen.getByRole("main")).toHaveClass(
      "recipe-authoring-state",
      "recipe-authoring-state--loading",
    );
    expect(screen.getByRole("status")).toHaveClass("recipe-authoring-state__panel");
    expect(screen.getByRole("status")).toHaveTextContent("Loading your private recipe draft");
  });

  it("scopes the route failure without changing retry behavior", () => {
    const reset = vi.fn();
    render(<RecipeDraftEditorError error={new Error("safe failure")} reset={reset} />);

    expect(screen.getByRole("main")).toHaveClass("recipe-authoring-state--error");
    expect(screen.getByRole("alert")).toHaveClass("recipe-authoring-state__panel");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "My recipes" })).toHaveAttribute(
      "href",
      "/account/recipes?view=drafts",
    );
  });

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
