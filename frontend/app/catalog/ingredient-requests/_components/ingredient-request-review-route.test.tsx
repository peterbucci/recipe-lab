import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../../../features/auth/auth-session-provider";
import { IngredientRequestReviewRoute } from "./ingredient-request-review-route";

const mocks = vi.hoisted(() => ({
  browse: vi.fn(),
  detail: vi.fn(),
}));

vi.mock(
  "../../../../features/ingredients/review/ingredient-request-review-api",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../features/ingredients/review/ingredient-request-review-api")
      >();
    return {
      ...actual,
      browseIngredientCatalogReviewRequests: mocks.browse,
      fetchIngredientCatalogReviewDetail: mocks.detail,
    };
  },
);

describe("IngredientRequestReviewRoute", () => {
  it("does not discover or fetch curator controls for an ordinary member", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "member-id", handle: "member", display_name: "Member" },
          capabilities: {
            review_ingredient_requests: false,
            moderate_recipe_reports: false,
          },
        }}
      >
        <IngredientRequestReviewRoute />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("main")).toHaveClass(
      "staff-state-page",
      "staff-state-page--curation",
      "staff-state-page--concealed",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "We couldn’t find that page." }).closest("section"),
    ).toHaveClass("staff-state-panel");
    expect(
      screen.getByRole("heading", { name: "We couldn’t find that page." }),
    ).toBeVisible();
    expect(screen.queryByText("Page unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Catalog curation")).not.toBeInTheDocument();
    expect(mocks.browse).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});
