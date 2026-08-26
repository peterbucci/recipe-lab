import { memberMutationHeaders, notifySessionExpired } from "./auth-api";

export const RECIPE_REPORT_DETAILS_MAX_LENGTH = 1_000;

export type RecipeReportReason =
  | "spam"
  | "harassment"
  | "dangerous_content"
  | "intellectual_property"
  | "other";

export interface RecipeReportInput {
  reason: RecipeReportReason;
  details: string | null;
}

export interface RecipeReportReceipt {
  id: string;
  recipe_version_id: string;
  submitted_at: string;
}

export class RecipeReportApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    status: number,
    code = "recipe_report_api_error",
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "RecipeReportApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100 && !Number.isNaN(Date.parse(value));
}

function invalidResponse(): RecipeReportApiError {
  return new RecipeReportApiError(
    "Recipe Lab received an invalid report response.",
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

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get("Retry-After");
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
}

async function reportError(response: Response): Promise<RecipeReportApiError> {
  let message = "Recipe Lab could not submit this report. Please try again.";
  let code = "recipe_report_api_error";
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord(payload.error)) {
      if (typeof payload.error.message === "string" && payload.error.message.length <= 500) {
        message = payload.error.message;
      }
      if (typeof payload.error.code === "string" && payload.error.code.length <= 100) {
        code = payload.error.code;
      }
    }
  } catch {
    // Keep the stable fallback rather than exposing an upstream response body.
  }
  const retryAfter = retryAfterSeconds(response);
  if (response.status === 401) {
    message = "Your session expired. Sign in again before reporting this recipe.";
  } else if (response.status === 413) {
    message = "That report is too large. Shorten the details and try again.";
  } else if (response.status === 429) {
    message = retryAfter
      ? `Too many reports were submitted. Try again in ${retryAfter} seconds.`
      : "Too many reports were submitted. Please wait before trying again.";
  }
  return new RecipeReportApiError(message, response.status, code, retryAfter);
}

export async function submitRecipeReport(
  recipeVersionId: string,
  input: RecipeReportInput,
  idempotencyKey: string,
): Promise<RecipeReportReceipt> {
  const response = await fetch(
    `/api/recipes/${encodeURIComponent(recipeVersionId)}/reports`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...memberMutationHeaders(),
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    if (response.status === 401) notifySessionExpired();
    throw await reportError(response);
  }
  try {
    return parseRecipeReportReceipt(await response.json(), recipeVersionId);
  } catch (error) {
    if (error instanceof RecipeReportApiError) throw error;
    throw invalidResponse();
  }
}
