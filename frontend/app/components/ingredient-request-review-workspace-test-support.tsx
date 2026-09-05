import { render } from "@testing-library/react";
import { vi } from "vitest";

import { CURATOR_ID } from "../../tests/support/ingredient-request-review";
import { AuthSessionProvider } from "./auth-session-provider";
import { IngredientRequestReviewWorkspace } from "./ingredient-request-review-workspace";

const mocks = vi.hoisted(() => ({
  browse: vi.fn(),
  detail: vi.fn(),
  review: vi.fn(),
  searchCatalog: vi.fn(),
}));

vi.mock("../../lib/ingredient-catalog-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/ingredient-catalog-api")>();
  return {
    ...actual,
    browseIngredientCatalogReviewRequests: mocks.browse,
    fetchIngredientCatalogReviewDetail: mocks.detail,
    reviewIngredientCatalogRequest: mocks.review,
    searchCatalogIngredients: mocks.searchCatalog,
  };
});

export function renderIngredientRequestReviewWorkspace(canReview = true) {
  return render(
    <AuthSessionProvider
      initialSession={{
        status: "authenticated",
        user: {
          id: CURATOR_ID,
          display_name: "Casey Curator",
          handle: "casey",
        },
        capabilities: {
          review_ingredient_requests: canReview,
          moderate_recipe_reports: false,
        },
      }}
    >
      <IngredientRequestReviewWorkspace />
    </AuthSessionProvider>,
  );
}

export function getIngredientRequestReviewMocks() {
  return mocks;
}

export function resetIngredientRequestReviewMocks() {
  mocks.browse.mockReset();
  mocks.detail.mockReset();
  mocks.review.mockReset();
  mocks.searchCatalog.mockReset();
}

export { IngredientCatalogApiError } from "../../lib/ingredient-catalog-api";
