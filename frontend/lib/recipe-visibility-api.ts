import {
  memberMutationHeaders,
  notifySessionExpired,
} from "./auth-api";
import type { RecipeVisibilityState } from "./recipe-library-api";

export type AuthorRecipeVisibilityState = Extract<
  RecipeVisibilityState,
  "published" | "author_withdrawn"
>;

export interface RecipeVisibilityUpdate {
  recipe_version_id: string;
  state: RecipeVisibilityState;
  updated_at: string;
}

interface ApiErrorPayload {
  error?: { code?: unknown; message?: unknown };
}

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

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
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

export function parseRecipeVisibilityUpdate(value: unknown): RecipeVisibilityUpdate {
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

async function apiError(response: Response): Promise<RecipeVisibilityApiError> {
  let code = "recipe_visibility_api_error";
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord((payload as ApiErrorPayload).error)) {
      const error = (payload as ApiErrorPayload).error!;
      if (typeof error.code === "string" && /^[a-z][a-z0-9_]{0,99}$/.test(error.code)) {
        code = error.code;
      }
    }
  } catch {
    // Keep the stable fallback instead of exposing an upstream response body.
  }
  const message =
    response.status === 401
      ? "Your session expired. Sign in again before changing recipe visibility."
      : response.status === 403
        ? "Recipe Lab could not verify this visibility change. Refresh the page and try again."
        : response.status === 404
          ? "This recipe is no longer available in your account."
          : response.status === 409
            ? "This recipe’s visibility changed. Refresh your recipes and try again."
            : response.status === 429
              ? "Too many visibility changes were requested. Please wait and try again."
              : "Recipe Lab could not change this recipe’s public visibility. Try again.";
  return new RecipeVisibilityApiError(message, response.status, code);
}

export async function updateRecipeVisibility(
  recipeVersionId: string,
  state: AuthorRecipeVisibilityState,
): Promise<RecipeVisibilityUpdate> {
  const response = await fetch(
    `/api/recipes/${encodeURIComponent(recipeVersionId)}/visibility`,
    {
      method: "PUT",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...memberMutationHeaders(),
      },
      body: JSON.stringify({ state }),
    },
  );
  if (!response.ok) {
    if (response.status === 401) notifySessionExpired();
    throw await apiError(response);
  }
  try {
    return parseRecipeVisibilityUpdate(await response.json());
  } catch (error) {
    if (error instanceof RecipeVisibilityApiError) throw error;
    throw invalidResponse();
  }
}
