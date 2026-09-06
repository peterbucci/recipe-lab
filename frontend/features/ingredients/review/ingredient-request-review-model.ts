import type {
  IngredientCatalogReviewDetail,
  IngredientCatalogReviewItem,
} from "./ingredient-request-review-api";
import type { IngredientCatalogRequestStatus } from "../ingredient-model";
import { INGREDIENT_REQUEST_STATUS_LABELS } from "../ingredient-request-presentation";

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
