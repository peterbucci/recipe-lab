import { IngredientCatalogApiError } from "./ingredient-api-error";
import type {
  CatalogIngredient,
  IngredientCatalogRequestStatus,
  MissingIngredientRequest,
} from "./ingredient-model";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function isBoundedText(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

export function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

export function isNullableBoundedText(
  value: unknown,
  maxLength: number,
): value is string | null {
  return value === null || isBoundedText(value, maxLength);
}

export function isCatalogRequestStatus(
  value: unknown,
): value is IngredientCatalogRequestStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "duplicate"
  );
}

export function parseCatalogIngredient(
  value: unknown,
): CatalogIngredient | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isBoundedText(value.canonical_name, 200) ||
    !Array.isArray(value.aliases) ||
    !value.aliases.every((alias) => isBoundedText(alias, 200))
  ) {
    return null;
  }

  return {
    id: value.id,
    canonical_name: value.canonical_name,
    aliases: value.aliases,
  };
}

export function parseMissingIngredientRequest(
  value: unknown,
): MissingIngredientRequest {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isBoundedText(value.proposed_name, 200) ||
    (value.context !== null && typeof value.context !== "string") ||
    !isCatalogRequestStatus(value.status) ||
    typeof value.created_at !== "string" ||
    (value.reviewed_at !== null && typeof value.reviewed_at !== "string") ||
    (value.decision_reason !== null &&
      typeof value.decision_reason !== "string") ||
    (value.resolved_ingredient_id !== null &&
      !isUuid(value.resolved_ingredient_id))
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient request response.",
      502,
      "invalid_ingredient_request_response",
    );
  }

  return {
    id: value.id,
    proposed_name: value.proposed_name,
    context: value.context,
    status: value.status,
    created_at: value.created_at,
    reviewed_at: value.reviewed_at,
    decision_reason: value.decision_reason,
    resolved_ingredient_id: value.resolved_ingredient_id,
  };
}
