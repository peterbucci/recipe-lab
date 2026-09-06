import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "../../../shared/api/core";

const KNOWN_RECIPE_ERROR_CODES = new Set([
  "invalid_identifier",
  "recipe_has_no_parent",
  "recipe_lineage_mismatch",
  "recipe_not_found",
  "validation_error",
]);

export const RECIPE_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_api_error",
  knownCodes: KNOWN_RECIPE_ERROR_CODES,
};

function recipeErrorMessage(status: number): string {
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 403) return "This recipe is not available to your account.";
  if (status === 404) return "This recipe is no longer available.";
  if (status === 422) return "Review the recipe request and try again.";
  if (status === 429) {
    return "Recipe Lab is receiving too many recipe requests. Please wait and try again.";
  }
  return "The recipe service could not complete this request.";
}

export class RecipeApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "recipe_api_error") {
    super(message);
    this.name = "RecipeApiError";
    this.status = status;
    this.code = code;
  }
}

export function fromRecipeTransportError(
  error: ApiTransportError,
): RecipeApiError {
  return new RecipeApiError(
    recipeErrorMessage(error.status),
    error.status,
    error.code,
  );
}
