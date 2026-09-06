import "server-only";

import {
  CookingActionApiError,
  parseCookingActionTypeResponse,
  type CatalogActionType,
  type CookingActionTypeQuery,
} from "../../shared/cooking-action-model";

import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "../../../../shared/api/core";

import { serverApiRequest } from "../../../../shared/api/server";

const KNOWN_COOKING_ACTION_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "catalog_unavailable",
  "invalid_identifier",
  "rate_limit_exceeded",
  "validation_error",
]);

const COOKING_ACTION_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "cooking_action_api_error",
  knownCodes: KNOWN_COOKING_ACTION_ERROR_CODES,
};

function cookingActionErrorMessage(status: number): string {
  if (status === 422) return "Review the cooking action request and try again.";
  if (status === 429) {
    return "The cooking action catalog is receiving too many requests. Please wait and try again.";
  }
  return "The cooking action service could not complete this request.";
}

function fromTransportError(error: ApiTransportError): CookingActionApiError {
  if (error.reason === "invalid_response") {
    return new CookingActionApiError(
      "Recipe Lab received an invalid cooking action response.",
      502,
      "invalid_cooking_action_response",
    );
  }
  return new CookingActionApiError(
    cookingActionErrorMessage(error.status),
    error.status,
    error.code,
  );
}

export async function fetchCookingActionTypes(): Promise<CatalogActionType[]> {
  const query = { limit: 100 } satisfies CookingActionTypeQuery;
  const search = new URLSearchParams({ limit: String(query.limit) });
  try {
    const response = await serverApiRequest(
      `/api/cooking-action-types?${search.toString()}`,
      {
        errorContract: COOKING_ACTION_ERROR_CONTRACT,
        kind: "query",
      },
    );
    return parseCookingActionTypeResponse(response.data).items;
  } catch (error) {
    if (error instanceof CookingActionApiError) throw error;
    if (error instanceof ApiTransportError) throw fromTransportError(error);
    throw error;
  }
}
