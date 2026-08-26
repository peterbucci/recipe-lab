import {
  type ApiValidationIssue,
  memberMutationHeaders,
  notifySessionExpired,
} from "./auth-api";
import type { RecipeDuplicateDecision, RecipeDuplicatePreflight } from "./recipe-duplicate-api";

export interface RecipeDraftDuplicateReviewInput {
  preflight_id: string;
  policy_version: string;
  result_digest: string;
  decision: Extract<RecipeDuplicateDecision, "continue"> | null;
}

export interface RecipeDraftPublishRequest {
  revision: number;
  duplicate_review: RecipeDraftDuplicateReviewInput;
}

export interface RecipeDraftPublication {
  recipe_version_id: string;
  location: string;
}

interface ApiErrorPayload {
  error?: { code?: unknown; message?: unknown; issues?: unknown };
}

export class RecipePublicationApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiValidationIssue[];

  constructor(
    message: string,
    status: number,
    code = "recipe_publication_api_error",
    issues: ApiValidationIssue[] = [],
  ) {
    super(message);
    this.name = "RecipePublicationApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
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

function parseIssues(value: unknown): ApiValidationIssue[] {
  if (!Array.isArray(value) || value.length > 200) return [];
  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      !Array.isArray(item.location) ||
      !item.location.every((part) => typeof part === "string" || typeof part === "number") ||
      typeof item.message !== "string" ||
      item.message.length > 500 ||
      typeof item.type !== "string" ||
      item.type.length > 100
    ) {
      return [];
    }
    return [{
      location: item.location as Array<string | number>,
      message: item.message,
      type: item.type,
    }];
  });
}

function invalidPublicationResponse(): RecipePublicationApiError {
  return new RecipePublicationApiError(
    "Recipe Lab received an invalid publication response.",
    502,
    "invalid_recipe_publication_response",
  );
}

export function parseRecipeDraftPublication(
  value: unknown,
  locationHeader: string | null,
): RecipeDraftPublication {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["recipe_version_id", "location"]) ||
    typeof value.recipe_version_id !== "string" ||
    !UUID_PATTERN.test(value.recipe_version_id) ||
    typeof value.location !== "string"
  ) {
    throw invalidPublicationResponse();
  }
  const expectedLocation = `/recipes/${value.recipe_version_id}`;
  if (value.location !== expectedLocation || locationHeader !== expectedLocation) {
    throw invalidPublicationResponse();
  }
  return {
    recipe_version_id: value.recipe_version_id,
    location: value.location,
  };
}

async function publicationError(response: Response): Promise<RecipePublicationApiError> {
  let message = "Recipe Lab could not publish this recipe. Your draft is still here.";
  let code = "recipe_publication_api_error";
  let issues: ApiValidationIssue[] = [];
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord((payload as ApiErrorPayload).error)) {
      const error = (payload as ApiErrorPayload).error!;
      if (typeof error.message === "string" && error.message.length <= 500) message = error.message;
      if (typeof error.code === "string" && error.code.length <= 100) code = error.code;
      issues = parseIssues(error.issues);
    }
  } catch {
    // Keep the stable draft-preserving fallback.
  }
  if (response.status === 401) {
    message = "Your session expired. Your draft is still here; sign in again before publishing.";
  }
  return new RecipePublicationApiError(message, response.status, code, issues);
}

export function duplicateReviewForPublication(
  preflight: RecipeDuplicatePreflight,
  decision: "continue" | null,
): RecipeDraftDuplicateReviewInput {
  return {
    preflight_id: preflight.acknowledgement.preflight_id,
    policy_version: preflight.acknowledgement.policy_version,
    result_digest: preflight.acknowledgement.result_digest,
    decision,
  };
}

export async function publishRecipeDraft(
  draftId: string,
  payload: RecipeDraftPublishRequest,
  idempotencyKey: string,
): Promise<RecipeDraftPublication> {
  const response = await fetch(`/api/recipe-drafts/${encodeURIComponent(draftId)}/publish`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...memberMutationHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    if (response.status === 401) notifySessionExpired();
    throw await publicationError(response);
  }
  try {
    return parseRecipeDraftPublication(await response.json(), response.headers.get("Location"));
  } catch (error) {
    if (error instanceof RecipePublicationApiError) throw error;
    throw invalidPublicationResponse();
  }
}
