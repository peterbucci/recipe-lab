import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "../../../shared/api/core";

const KNOWN_RECIPE_LIBRARY_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "authentication_required",
  "cook_not_found",
  "invalid_identifier",
  "rate_limit_exceeded",
  "recipe_library_unavailable",
  "validation_error",
]);

export const RECIPE_LIBRARY_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_library_api_error",
  knownCodes: KNOWN_RECIPE_LIBRARY_ERROR_CODES,
};

export class RecipeLibraryApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code = "recipe_library_api_error",
  ) {
    super(message);
    this.name = "RecipeLibraryApiError";
    this.status = status;
    this.code = code;
  }
}

export function invalidRecipeLibraryResponse(): RecipeLibraryApiError {
  return new RecipeLibraryApiError(
    "Recipe Lab could not load this recipe library. Please try again.",
    502,
    "invalid_recipe_library_response",
  );
}

function recipeLibraryErrorMessage(status: number): string {
  return status === 401
    ? "Your session expired. Sign in again to load your recipes."
    : status === 403
      ? "This recipe library is not available to your account."
      : status === 404
        ? "This recipe library could not be found."
        : status === 429
          ? "Recipe Lab is receiving too many requests. Please wait before refreshing your recipes."
          : "Recipe Lab could not load this recipe library. Please try again.";
}

export function recipeLibraryErrorFromTransport(
  error: ApiTransportError,
): RecipeLibraryApiError {
  if (error.reason === "invalid_response") {
    return invalidRecipeLibraryResponse();
  }
  return new RecipeLibraryApiError(
    recipeLibraryErrorMessage(error.status),
    error.status,
    error.code,
  );
}
