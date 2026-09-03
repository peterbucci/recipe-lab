import {
  type ApiValidationIssue,
} from "./auth-api";
import type { operations } from "./api-contracts/generated";
import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  createRequestFingerprint,
  type PublicApiErrorContract,
} from "./api-transport/core";
import type {
  RecipeDuplicateDecision,
  RecipeDuplicatePreflight,
} from "./recipe-duplicate-api";

type RecipePublicationOperation =
  operations["publish_original_draft_api_recipe_drafts__draft_id__publish_post"];
type RecipePublicationInput =
  RecipePublicationOperation["requestBody"]["content"]["application/json"];
type RecipePublicationWire =
  RecipePublicationOperation["responses"][201]["content"]["application/json"];

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

const KNOWN_RECIPE_PUBLICATION_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "authentication_required",
  "duplicate_decision_not_required",
  "duplicate_decision_required",
  "duplicate_preflight_not_found",
  "duplicate_preflight_stale",
  "duplicate_preflight_unavailable",
  "idempotency_key_conflict",
  "invalid_csrf",
  "invalid_identifier",
  "invalid_original_recipe_draft",
  "invalid_recipe_draft",
  "rate_limit_exceeded",
  "recipe_draft_already_published",
  "recipe_draft_not_found",
  "recipe_draft_revision_conflict",
  "recipe_fork_source_unavailable",
  "recipe_not_found",
  "validation_error",
]);

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
  if (!Array.isArray(value) || value.length === 0 || value.length > 8)
    return null;
  const safe = value.every(
    (part) =>
      (typeof part === "string" && SAFE_DRAFT_ISSUE_PARTS.has(part)) ||
      (typeof part === "number" &&
        Number.isInteger(part) &&
        part >= 0 &&
        part <= 200),
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
    if (path.at(-1) === "actions") {
      return "Add at least one cooking detail to this step so Recipe Lab can compare similar recipes before publishing.";
    }
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
    return [
      {
        location,
        message: safeIssueMessage(location),
        type: "validation_error",
      },
    ];
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
  if (status === 404)
    return "This private draft is no longer available. It was not published.";
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
  if (
    value.location !== expectedLocation ||
    locationHeader !== expectedLocation
  ) {
    throw invalidPublicationResponse();
  }
  return {
    recipe_version_id: value.recipe_version_id,
    location: value.location,
  };
}

const RECIPE_PUBLICATION_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_publication_api_error",
  knownCodes: KNOWN_RECIPE_PUBLICATION_ERROR_CODES,
  parseIssues,
};

function publicationError(error: ApiTransportError): RecipePublicationApiError {
  return new RecipePublicationApiError(
    safePublicationMessage(error.status, error.code),
    error.status,
    error.code,
    error.issues,
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
  signal?: AbortSignal,
): Promise<RecipeDraftPublication> {
  try {
    const input: RecipePublicationInput = payload;
    const requestFingerprint = await createRequestFingerprint({
      draft_id: draftId.toLowerCase(),
      payload: input,
      schema: "recipe-draft-publication",
      version: 1,
    });
    const response = await browserApiRequest(
      `/api/recipe-drafts/${encodeURIComponent(draftId)}/publish`,
      {
        body: JSON.stringify(input),
        csrf: "member",
        errorContract: RECIPE_PUBLICATION_ERROR_CONTRACT,
        headers: { "Content-Type": "application/json" },
        identity: { idempotencyKey, requestFingerprint },
        kind: "mutation",
        method: "POST",
        signal,
      },
    );
    return parseRecipeDraftPublication(
      response.data as RecipePublicationWire,
      response.headers.get("Location"),
    );
  } catch (error) {
    if (error instanceof RecipePublicationApiError) throw error;
    if (error instanceof ApiTransportError) {
      if (signal?.aborted) {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      if (error.reason === "invalid_response") {
        throw invalidPublicationResponse();
      }
      if (error.reason === "http" || error.reason === "not_sent") {
        throw publicationError(error);
      }
      throw new TypeError("Recipe Lab could not reach the publication service.");
    }
    throw invalidPublicationResponse();
  }
}
