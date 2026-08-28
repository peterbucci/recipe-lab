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
  community_rules_accepted: true;
  content_rights_confirmed: true;
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

const SAFE_DRAFT_ISSUE_PARTS = new Set([
  "body",
  "revision",
  "title",
  "description",
  "servings",
  "ingredients",
  "selection",
  "ingredient_id",
  "ingredient_request_id",
  "preparation_notes",
  "measure",
  "mode",
  "kind",
  "value",
  "minimum",
  "maximum",
  "unit",
  "unit_id",
  "package_size_id",
  "instructions",
  "text",
  "actions",
  "action_type_id",
  "action_type",
  "ingredient_refs",
  "inputs",
  "duration",
  "temperature",
]);

function safeIssueLocation(value: unknown): Array<string | number> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return null;
  const safe = value.every(
    (part) =>
      (typeof part === "string" && SAFE_DRAFT_ISSUE_PARTS.has(part)) ||
      (typeof part === "number" && Number.isInteger(part) && part >= 0 && part <= 200),
  );
  return safe ? (value as Array<string | number>) : null;
}

function safeIssueMessage(location: readonly (string | number)[]): string {
  const path = location[0] === "body" ? location.slice(1) : location;
  if (path[0] === "title") return "Review the recipe title.";
  if (path[0] === "description") return "Review the recipe description.";
  if (path[0] === "servings") return "Review the serving amount.";
  if (path[0] === "ingredients") return "Review this ingredient.";
  if (path[0] === "instructions" && path.includes("actions")) {
    return "Review this cooking action.";
  }
  if (path[0] === "instructions") return "Review this instruction.";
  return "Review this field and try again.";
}

function parseIssues(value: unknown): ApiValidationIssue[] {
  if (!Array.isArray(value) || value.length > 200) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const location = safeIssueLocation(item.location);
    if (!location) return [];
    return [{ location, message: safeIssueMessage(location), type: "validation_error" }];
  });
}

function safePublicationMessage(status: number, code: string): string {
  if (status === 401) {
    return "Your session expired. Your draft is still here; sign in again before publishing.";
  }
  if (status === 403) {
    return "Recipe Lab could not verify this publication request. Refresh the page and try again.";
  }
  if (status === 404 && code === "duplicate_preflight_not_found") {
    return "The similar recipes check expired. Check again before publishing.";
  }
  if (status === 404) return "This private draft is no longer available. It was not published.";
  if (status === 409 && code === "recipe_fork_source_unavailable") {
    return "The recipe this version is based on is no longer available. Your private draft is unchanged.";
  }
  if (status === 409 && code === "recipe_draft_revision_conflict") {
    return "This draft changed. Save or reload it before publishing.";
  }
  if (
    status === 409 &&
    (code === "duplicate_preflight_stale" ||
      code === "duplicate_decision_required" ||
      code === "duplicate_decision_not_required")
  ) {
    return "The similar recipes check changed. Review the latest results before publishing.";
  }
  if (status === 409) {
    return "This publication request is no longer current. Refresh your draft before trying again.";
  }
  if (status === 422) {
    return "Some draft fields need attention. Review them before publishing.";
  }
  if (status === 429) {
    return "Too many publication attempts were made. Your draft is still here; please try again later.";
  }
  if (status === 503 && code === "duplicate_preflight_unavailable") {
    return "Similar recipes could not be checked right now. Your draft is still here; please try again.";
  }
  return "Recipe Lab could not publish this recipe. Your draft is still here; please try again.";
}

function invalidPublicationResponse(): RecipePublicationApiError {
  return new RecipePublicationApiError(
    "Recipe Lab could not confirm that this recipe was published. Your draft is still here; check My recipes before trying again.",
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
  let code = "recipe_publication_api_error";
  let issues: ApiValidationIssue[] = [];
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord((payload as ApiErrorPayload).error)) {
      const error = (payload as ApiErrorPayload).error!;
      if (typeof error.code === "string" && /^[a-z][a-z0-9_]{0,99}$/.test(error.code)) {
        code = error.code;
      }
      issues = parseIssues(error.issues);
    }
  } catch {
    // Keep the stable draft-preserving fallback.
  }
  return new RecipePublicationApiError(
    safePublicationMessage(response.status, code),
    response.status,
    code,
    issues,
  );
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
