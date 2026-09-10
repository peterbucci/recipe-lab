import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "../../shared/api/core";

const KNOWN_PUBLIC_COOK_PROFILE_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "cook_not_found",
  "rate_limit_exceeded",
  "validation_error",
]);

export const PUBLIC_COOK_PROFILE_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "public_cook_profile_api_error",
  knownCodes: KNOWN_PUBLIC_COOK_PROFILE_ERROR_CODES,
};

export class PublicCookProfileApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code = "public_cook_profile_api_error",
  ) {
    super(message);
    this.name = "PublicCookProfileApiError";
    this.status = status;
    this.code = code;
  }
}

export function invalidPublicCookProfileResponse(): PublicCookProfileApiError {
  return new PublicCookProfileApiError(
    "Recipe Lab could not load this cook profile. Please try again.",
    502,
    "invalid_public_cook_profile_response",
  );
}

function publicCookProfileErrorMessage(status: number): string {
  return status === 404
    ? "This cook profile could not be found."
    : status === 422
      ? "Review the cook profile request and try again."
      : status === 429
        ? "Recipe Lab is receiving too many requests. Please wait before refreshing this cook profile."
        : "Recipe Lab could not load this cook profile. Please try again.";
}

export function publicCookProfileErrorFromTransport(
  error: ApiTransportError,
): PublicCookProfileApiError {
  if (error.reason === "invalid_response") {
    return invalidPublicCookProfileResponse();
  }
  return new PublicCookProfileApiError(
    publicCookProfileErrorMessage(error.status),
    error.status,
    error.code,
  );
}
