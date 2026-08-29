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
  { label: "Rejected", value: "rejected" },
  { label: "Duplicate", value: "duplicate" },
];

export const STATUS_LABELS: Record<IngredientCatalogRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  duplicate: "Duplicate",
};

export interface ReviewDetailProps {
  detail: IngredientCatalogReviewDetail;
  onAuthorizationLost: () => void;
  onRefresh: () => Promise<void>;
  onReviewed: (request: IngredientCatalogReviewItem) => void;
}

export function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

export function formatRequestTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
