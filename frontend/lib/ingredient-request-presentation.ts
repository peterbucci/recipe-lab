import type { IngredientCatalogRequestStatus } from "./ingredient-catalog-api";

export const INGREDIENT_REQUEST_STATUS_LABELS: Record<
  IngredientCatalogRequestStatus,
  string
> = {
  approved: "Approved",
  duplicate: "Duplicate",
  pending: "Pending",
  rejected: "Rejected",
};

export function ingredientRequestMemberStatusLabel(
  status: IngredientCatalogRequestStatus,
): string {
  return status === "duplicate"
    ? "Matched"
    : INGREDIENT_REQUEST_STATUS_LABELS[status];
}

function formatRequestTimestamp(
  value: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", options).format(parsed);
}

export function formatIngredientRequestDate(value: string): string {
  return formatRequestTimestamp(value, { dateStyle: "medium" });
}

export function formatIngredientRequestTime(value: string): string {
  return formatRequestTimestamp(value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
