import type {
  IngredientCatalogRequestStatus,
  IngredientCatalogReviewDetail,
  IngredientCatalogReviewItem,
} from "../../lib/ingredient-catalog-api";

export const STATUS_FILTERS: Array<{
  label: string;
  value: IngredientCatalogRequestStatus;
}> = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Duplicate", value: "duplicate" },
  { label: "Rejected", value: "rejected" },
];

export interface ReviewDetailProps {
  detail: IngredientCatalogReviewDetail;
  onAuthorizationLost: () => void;
  onRefresh: () => Promise<void>;
  onReviewed: (request: IngredientCatalogReviewItem) => void;
}
