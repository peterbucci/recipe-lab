import { render } from "@testing-library/react";
import { vi } from "vitest";

import { IngredientRequestReviewWorkspace } from "./ingredient-request-review-workspace";

const mocks = vi.hoisted(() => ({
  browse: vi.fn(),
  detail: vi.fn(),
  review: vi.fn(),
  searchCatalog: vi.fn(),
}));

vi.mock("./ingredient-request-review-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./ingredient-request-review-api")>();
  return {
    ...actual,
    browseIngredientCatalogReviewRequests: mocks.browse,
    fetchIngredientCatalogReviewDetail: mocks.detail,
    reviewIngredientCatalogRequest: mocks.review,
  };
});

vi.mock("../catalog/ingredient-catalog-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../catalog/ingredient-catalog-api")>();
  return {
    ...actual,
    searchCatalogIngredients: mocks.searchCatalog,
  };
});

export function renderIngredientRequestReviewWorkspace() {
  return render(
    <IngredientRequestReviewWorkspace onAuthorizationLost={vi.fn()} />,
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

export { IngredientCatalogApiError } from "../ingredient-api-error";
