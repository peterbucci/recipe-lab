import {
  ApiTransportError,
  type ApiValidationIssue,
  type PublicApiErrorContract,
} from "../../shared/api/core";
import { IngredientCatalogApiError } from "./ingredient-api-error";
import { isRecord } from "./ingredient-contract-parsers";

const KNOWN_MEMBER_INGREDIENT_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "authentication_required",
  "catalog_curator_required",
  "ingredient_catalog_conflict",
  "ingredient_request_conflict",
  "ingredient_request_not_found",
  "ingredient_request_already_reviewed",
  "invalid_csrf",
  "invalid_identifier",
  "rate_limit_exceeded",
  "validation_error",
]);

function parseIngredientIssues(value: unknown): ApiValidationIssue[] {
  if (!Array.isArray(value) || value.length > 20) return [];
  return value.flatMap((issue) => {
    if (!isRecord(issue) || !Array.isArray(issue.location)) return [];
    const location = issue.location;
    const safeLocation = location.every(
      (part) =>
        (typeof part === "string" &&
          [
            "body",
            "proposed_name",
            "context",
            "decision",
            "canonical_name",
            "aliases",
            "reason",
            "provenance",
            "ingredient_id",
            "request_id",
          ].includes(part)) ||
        (typeof part === "number" &&
          Number.isInteger(part) &&
          part >= 0 &&
          part <= 20),
    );
    if (!safeLocation) return [];
    const field = location.at(-1);
    return [
      {
        location: location as Array<string | number>,
        message:
          field === "proposed_name"
            ? "Review the proposed ingredient name."
            : field === "context"
              ? "Review the ingredient context."
              : "Review this field and try again.",
        type: "validation_error",
      },
    ];
  });
}

export const INGREDIENT_REQUEST_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "ingredient_catalog_api_error",
  knownCodes: KNOWN_MEMBER_INGREDIENT_ERROR_CODES,
  parseIssues: parseIngredientIssues,
};

export function ingredientRequestError(
  error: ApiTransportError,
  fallback: string,
): IngredientCatalogApiError {
  const code = error.code;
  const message =
    error.status === 401
      ? "Your session expired. Sign in again to continue."
      : error.status === 404
        ? "This ingredient request is no longer available."
        : error.status === 409 && code === "ingredient_request_conflict"
          ? "That ingredient is already approved or has a pending request."
          : error.status === 409
            ? "This ingredient request changed. Refresh it before trying again."
            : error.status === 422
              ? "Review the ingredient request fields and try again."
              : error.status === 429
                ? "Too many ingredient requests were made. Please wait and try again."
                : fallback;
  return new IngredientCatalogApiError(
    message,
    error.status,
    code,
    error.issues,
  );
}
