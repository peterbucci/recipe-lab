import type { operations } from "./api-contracts/generated";
import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "./api-transport/core";
import type { RecipeVisibilityState } from "./recipe-library-api";

type RecipeVisibilityOperation =
  operations["update_authored_recipe_visibility_api_recipes__recipe_version_id__visibility_put"];
type RecipeVisibilityInput =
  RecipeVisibilityOperation["requestBody"]["content"]["application/json"];
type RecipeVisibilityWire =
  RecipeVisibilityOperation["responses"][200]["content"]["application/json"];

export type AuthorRecipeVisibilityState = Extract<
  RecipeVisibilityState,
  "published" | "author_withdrawn"
>;

export interface RecipeVisibilityUpdate {
  recipe_version_id: string;
  state: RecipeVisibilityState;
  updated_at: string;
}

const KNOWN_RECIPE_VISIBILITY_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "authentication_required",
  "invalid_csrf",
  "invalid_identifier",
  "moderation_hidden",
  "rate_limit_exceeded",
  "recipe_not_found",
  "recipe_visibility_managed_by_moderation",
  "validation_error",
  "visibility_service_unavailable",
]);

const RECIPE_VISIBILITY_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_visibility_api_error",
  knownCodes: KNOWN_RECIPE_VISIBILITY_ERROR_CODES,
};

export class RecipeVisibilityApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code = "recipe_visibility_api_error",
  ) {
    super(message);
    this.name = "RecipeVisibilityApiError";
    this.status = status;
    this.code = code;
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

function isVisibilityState(value: unknown): value is RecipeVisibilityState {
  return (
    value === "published" ||
    value === "author_withdrawn" ||
    value === "moderation_hidden"
  );
}

function invalidResponse(): RecipeVisibilityApiError {
  return new RecipeVisibilityApiError(
    "Recipe Lab could not confirm the visibility change. Refresh your recipes before trying again.",
    502,
    "invalid_recipe_visibility_response",
  );
}

export function parseRecipeVisibilityUpdate(
  value: unknown,
): RecipeVisibilityUpdate {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["recipe_version_id", "state", "updated_at"]) ||
    typeof value.recipe_version_id !== "string" ||
    !UUID_PATTERN.test(value.recipe_version_id) ||
    !isVisibilityState(value.state) ||
    typeof value.updated_at !== "string" ||
    Number.isNaN(Date.parse(value.updated_at))
  ) {
    throw invalidResponse();
  }
  return {
    recipe_version_id: value.recipe_version_id,
    state: value.state,
    updated_at: value.updated_at,
  };
}

function fromTransportError(error: ApiTransportError): RecipeVisibilityApiError {
  const message =
    error.status === 401
      ? "Your session expired. Sign in again before changing recipe visibility."
      : error.status === 403
        ? "Recipe Lab could not verify this visibility change. Refresh the page and try again."
        : error.status === 404
          ? "This recipe is no longer available in your account."
          : error.status === 409
            ? "This recipe’s visibility changed. Refresh your recipes and try again."
            : error.status === 429
              ? "Too many visibility changes were requested. Please wait and try again."
              : "Recipe Lab could not change this recipe’s public visibility. Try again.";
  return new RecipeVisibilityApiError(message, error.status, error.code);
}

export async function updateRecipeVisibility(
  recipeVersionId: string,
  state: AuthorRecipeVisibilityState,
): Promise<RecipeVisibilityUpdate> {
  try {
    const input: RecipeVisibilityInput = { state };
    const response = await browserApiRequest(
      `/api/recipes/${encodeURIComponent(recipeVersionId)}/visibility`,
      {
        body: JSON.stringify(input),
        csrf: "member",
        errorContract: RECIPE_VISIBILITY_ERROR_CONTRACT,
        headers: { "Content-Type": "application/json" },
        identity: null,
        kind: "mutation",
        method: "PUT",
      },
    );
    return parseRecipeVisibilityUpdate(response.data as RecipeVisibilityWire);
  } catch (error) {
    if (error instanceof RecipeVisibilityApiError) throw error;
    if (error instanceof ApiTransportError) {
      if (error.reason === "invalid_response") throw invalidResponse();
      throw fromTransportError(error);
    }
    throw invalidResponse();
  }
}
