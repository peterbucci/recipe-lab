import type {
  IngredientCatalogReviewDetail,
  IngredientCatalogReviewItem,
  IngredientCatalogReviewPage,
} from "../../lib/ingredient-catalog-api";

export const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
export const REQUESTER_ID = "77777777-7777-4777-8777-777777777777";
export const CURATOR_ID = "88888888-8888-4888-8888-888888888888";
export const INGREDIENT_ID = "33333333-3333-4333-8333-333333333333";
export const APPROVED_REQUEST_ID = "99999999-9999-4999-8999-999999999999";

export function reviewItem(
  overrides: Partial<IngredientCatalogReviewItem> = {},
): IngredientCatalogReviewItem {
  return {
    id: REQUEST_ID,
    proposed_name: "Dragon fruit",
    context: "Fresh pink fruit seen at a neighborhood market.",
    status: "pending",
    created_at: "2026-08-24T18:00:00Z",
    updated_at: "2026-08-24T18:00:00Z",
    reviewed_at: null,
    decision_reason: null,
    resolved_ingredient_id: null,
    requester_user_id: REQUESTER_ID,
    reviewer_user_id: null,
    duplicate_of_request_id: null,
    approved_canonical_name: null,
    approved_aliases: null,
    approval_provenance: null,
    ...overrides,
  };
}

export function reviewDetail(
  overrides: Partial<IngredientCatalogReviewDetail> = {},
): IngredientCatalogReviewDetail {
  return {
    ...reviewItem(),
    requester: {
      id: REQUESTER_ID,
      handle: "alice",
      display_name: "Alice Cook",
    },
    catalog_candidates: [
      {
        id: INGREDIENT_ID,
        canonical_name: "Pitaya",
        aliases: ["Dragon fruit"],
      },
    ],
    request_candidates: [
      {
        id: APPROVED_REQUEST_ID,
        proposed_name: "Red pitaya",
        status: "approved",
        created_at: "2026-08-23T18:00:00Z",
        resolved_ingredient_id: INGREDIENT_ID,
        approved_canonical_name: "Pitaya",
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        proposed_name: "Golden dragon fruit",
        status: "pending",
        created_at: "2026-08-24T17:00:00Z",
        resolved_ingredient_id: null,
        approved_canonical_name: null,
      },
    ],
    ...overrides,
  };
}

export function reviewPage(
  items: IngredientCatalogReviewItem[] = [reviewItem()],
  overrides: Partial<IngredientCatalogReviewPage> = {},
): IngredientCatalogReviewPage {
  return {
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    total_pages: items.length ? 1 : 0,
    ...overrides,
  };
}
