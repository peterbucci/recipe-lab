import type {
  IngredientCatalogRequestStatus,
  IngredientCatalogReviewDetail,
  IngredientCatalogReviewItem,
} from "../../lib/ingredient-catalog-api";
import { INGREDIENT_REQUEST_STATUS_LABELS } from "../../lib/ingredient-request-presentation";

export const STATUS_FILTERS: Array<{
  label: string;
  value: IngredientCatalogRequestStatus;
}> = [
  { label: INGREDIENT_REQUEST_STATUS_LABELS.pending, value: "pending" },
  { label: INGREDIENT_REQUEST_STATUS_LABELS.approved, value: "approved" },
  { label: INGREDIENT_REQUEST_STATUS_LABELS.duplicate, value: "duplicate" },
  { label: INGREDIENT_REQUEST_STATUS_LABELS.rejected, value: "rejected" },
];

export interface ReviewDetailProps {
  detail: IngredientCatalogReviewDetail;
  onAuthorizationLost: () => void;
  onRefresh: () => Promise<void>;
  onReviewed: (request: IngredientCatalogReviewItem) => void;
}
