import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  createRequestFingerprint,
  type ApiAuthenticationRecovery,
  type ApiMutationOutcome,
  type PublicApiErrorContract,
} from "./api-transport/core";
import type { operations } from "./api-contracts/generated";

export const RECIPE_REPORT_DETAILS_MAX_LENGTH = 1_000;

type RecipeReportOperation =
  operations["report_recipe_api_recipes__recipe_version_id__reports_post"];
type RecipeReportResponses = RecipeReportOperation["responses"];

export type RecipeReportInput =
  RecipeReportOperation["requestBody"]["content"]["application/json"];
export type RecipeReportReceipt =
  | RecipeReportResponses[200]["content"]["application/json"]
  | RecipeReportResponses[201]["content"]["application/json"];
export type RecipeReportReason = RecipeReportInput["reason"];
type NormalizedRecipeReportInput = {
  details: string | null;
  reason: RecipeReportReason;
};

const KNOWN_RECIPE_REPORT_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "api_unavailable",
  "authentication_required",
  "idempotency_key_conflict",
  "invalid_csrf",
  "invalid_identifier",
  "rate_limit_exceeded",
  "rate_limited",
  "recipe_already_reported",
  "recipe_not_found",
  "recipe_report_conflict",
  "report_service_unavailable",
  "validation_error",
]);

const RECIPE_REPORT_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_report_api_error",
  knownCodes: KNOWN_RECIPE_REPORT_ERROR_CODES,
};

export class RecipeReportApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;
  readonly outcome: ApiMutationOutcome;
  readonly authenticationRecovery: ApiAuthenticationRecovery;

  constructor(
    message: string,
    status: number,
    code = "recipe_report_api_error",
    retryAfterSeconds: number | null = null,
    outcome: ApiMutationOutcome =
      status >= 400 && status < 500 && status !== 408
        ? "rejected"
        : "unknown",
    authenticationRecovery: ApiAuthenticationRecovery = null,
  ) {
    super(message);
    this.name = "RecipeReportApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.outcome = outcome;
    this.authenticationRecovery = authenticationRecovery;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    !Number.isNaN(Date.parse(value))
  );
}

function invalidResponse(): RecipeReportApiError {
  return new RecipeReportApiError(
    "Recipe Lab could not confirm that the report was received. Please check before trying again.",
    502,
    "invalid_recipe_report_response",
  );
}

export function parseRecipeReportReceipt(
  value: unknown,
  expectedRecipeVersionId: string,
): RecipeReportReceipt {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "recipe_version_id", "submitted_at"]) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    value.recipe_version_id !== expectedRecipeVersionId ||
    !isTimestamp(value.submitted_at)
  ) {
    throw invalidResponse();
  }
  return {
    id: value.id,
    recipe_version_id: value.recipe_version_id,
    submitted_at: value.submitted_at,
  };
}

function reportErrorMessage(
  status: number,
  code: string,
  retryAfter: number | null,
): string {
  const message =
    status === 401
      ? "Your session expired. Sign in again before reporting this recipe."
      : status === 404
        ? "This recipe is no longer available to report."
        : status === 409 && code === "recipe_already_reported"
          ? "You already reported this recipe."
          : status === 409
            ? "This report could not be submitted again. Refresh the recipe before trying again."
            : status === 413
              ? "That report is too large. Shorten the details and try again."
              : status === 422
                ? "Review the report reason and details, then try again."
                : status === 429
                  ? retryAfter !== null
                    ? `Too many reports were submitted. Try again in ${retryAfter} seconds.`
                    : "Too many reports were submitted. Please wait before trying again."
                  : "Recipe Lab could not submit this report. Please try again.";
  return message;
}

function fromTransportError(error: ApiTransportError): RecipeReportApiError {
  if (error.reason === "invalid_response") return invalidResponse();
  return new RecipeReportApiError(
    reportErrorMessage(error.status, error.code, error.retryAfterSeconds),
    error.status,
    error.code,
    error.retryAfterSeconds,
    error.outcome ?? "unknown",
    error.authenticationRecovery,
  );
}

function normalizedReportInput(
  input: RecipeReportInput,
): NormalizedRecipeReportInput {
  return {
    reason: input.reason,
    details: input.details?.trim() || null,
  };
}

async function recipeReportRequestFingerprint(
  recipeVersionId: string,
  input: NormalizedRecipeReportInput,
): Promise<string> {
  return createRequestFingerprint({
    payload: { details: input.details, reason: input.reason },
    recipe_version_id: recipeVersionId,
    schema: "recipe-lab.recipe-report-request",
    version: 1,
  });
}

export async function submitRecipeReport(
  recipeVersionId: string,
  input: RecipeReportInput,
  idempotencyKey: string,
): Promise<RecipeReportReceipt> {
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length === 0 ||
    idempotencyKey.length > 200
  ) {
    throw new RecipeReportApiError(
      "Recipe Lab could not prepare this report. Please try again.",
      0,
      "invalid_idempotency_key",
      null,
      "rejected",
    );
  }
  const normalizedInput = normalizedReportInput(input);
  let requestFingerprint: string;
  try {
    requestFingerprint = await recipeReportRequestFingerprint(
      recipeVersionId,
      normalizedInput,
    );
  } catch {
    throw new RecipeReportApiError(
      "Recipe Lab could not prepare this report. Please try again.",
      0,
      "recipe_report_request_unavailable",
      null,
      "rejected",
    );
  }

  try {
    const response = await browserApiRequest(
      `/api/recipes/${encodeURIComponent(recipeVersionId)}/reports`,
      {
        body: JSON.stringify(normalizedInput),
        csrf: "member",
        errorContract: RECIPE_REPORT_ERROR_CONTRACT,
        headers: { "Content-Type": "application/json" },
        identity: { idempotencyKey, requestFingerprint },
        kind: "mutation",
        method: "POST",
      },
    );
    return parseRecipeReportReceipt(response.data, recipeVersionId);
  } catch (error) {
    if (error instanceof RecipeReportApiError) throw error;
    if (error instanceof ApiTransportError) throw fromTransportError(error);
    throw new RecipeReportApiError(
      "Recipe Lab could not submit this report. Please try again.",
      0,
      "recipe_report_api_error",
      null,
      "unknown",
    );
  }
}
