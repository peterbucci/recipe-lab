"use client";

import type { operations } from "./api-contracts/generated";
import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  createRequestFingerprint,
  type PublicApiErrorContract,
} from "./api-transport/core";
import {
  parseRecipeViewerState,
  type RatingValue,
  type RecipeViewerState,
} from "./recipe-viewer-state";

export type { RatingValue, RecipeViewerState } from "./recipe-viewer-state";

type RatingOperation =
  operations["rate_recipe_for_current_user_api_recipes__recipe_version_id__rating_put"];
type RatingInput =
  RatingOperation["requestBody"]["content"]["application/json"];
type InteractionMutationOperation =
  | RatingOperation
  | operations["unrate_recipe_for_current_user_api_recipes__recipe_version_id__rating_delete"]
  | operations["save_recipe_for_current_user_api_recipes__recipe_version_id__save_put"]
  | operations["unsave_recipe_for_current_user_api_recipes__recipe_version_id__save_delete"]
  | operations["record_recipe_view_for_current_user_api_recipes__recipe_version_id__view_post"];
type RecipeDetailOperation =
  operations["recipe_detail_api_recipes__recipe_version_id__get"];
type ViewerStatesOperation =
  operations["recipe_viewer_states_for_current_user_api_recipes_viewer_states_get"];
type ViewerStatesQuery = ViewerStatesOperation["parameters"]["query"];
type InteractionRecipeVersionId =
  | InteractionMutationOperation["parameters"]["path"]["recipe_version_id"]
  | RecipeDetailOperation["parameters"]["path"]["recipe_version_id"];

const KNOWN_INTERACTION_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "activity_unavailable",
  "authentication_required",
  "idempotency_key_conflict",
  "invalid_csrf",
  "invalid_identifier",
  "rate_limit_exceeded",
  "recipe_not_found",
  "validation_error",
]);

const INTERACTION_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "interaction_api_error",
  knownCodes: KNOWN_INTERACTION_ERROR_CODES,
};

function interactionErrorMessage(status: number): string {
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 403) {
    return "Recipe Lab could not verify this recipe activity request. Refresh the page and try again.";
  }
  if (status === 404) return "This recipe is no longer available.";
  if (status === 409)
    return "Your recipe activity changed. Refresh the recipe and try again.";
  if (status === 422) return "Review this recipe activity and try again.";
  if (status === 429) {
    return "Too many recipe activity requests were made. Please wait and try again.";
  }
  return "The recipe service could not update your recipe activity.";
}

export class InteractionApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "interaction_api_error") {
    super(message);
    this.name = "InteractionApiError";
    this.status = status;
    this.code = code;
  }
}

function interactionUrl(
  recipeVersionId: InteractionRecipeVersionId,
  resource: "rating" | "save" | "view",
): string {
  return `/api/recipes/${encodeURIComponent(recipeVersionId)}/${resource}`;
}

function invalidInteractionResponse(message: string): InteractionApiError {
  return new InteractionApiError(message, 502, "invalid_interaction_response");
}

function interactionFailure(
  error: unknown,
  invalidResponseMessage: string,
): InteractionApiError {
  if (error instanceof InteractionApiError) return error;
  if (error instanceof ApiTransportError) {
    if (error.reason === "invalid_response") {
      return invalidInteractionResponse(invalidResponseMessage);
    }
    return new InteractionApiError(
      interactionErrorMessage(error.status),
      error.status,
      error.code,
    );
  }
  return new InteractionApiError(
    "The recipe service could not update your recipe activity.",
    0,
  );
}

function rethrowCallerAbort(error: unknown, signal?: AbortSignal): void {
  if (
    error instanceof ApiTransportError &&
    (error.reason === "aborted" || error.reason === "not_sent") &&
    signal?.aborted
  ) {
    throw (
      signal.reason ??
      new DOMException("The request was aborted.", "AbortError")
    );
  }
}

async function interactionRequestFingerprint(
  recipeVersionId: InteractionRecipeVersionId,
  resource: "rating" | "save" | "view",
  method: "DELETE" | "POST" | "PUT",
  payload: RatingInput | null = null,
): Promise<string> {
  return createRequestFingerprint({
    method,
    payload,
    recipe_version_id: recipeVersionId,
    resource,
  });
}

function requiredViewerState(value: unknown): RecipeViewerState {
  try {
    const state = parseRecipeViewerState(value);
    if (state === null) {
      throw new TypeError("Member mutations must return private recipe state.");
    }
    return state;
  } catch {
    throw invalidInteractionResponse(
      "Recipe Lab received an invalid recipe activity response.",
    );
  }
}

async function interactionRequest({
  body,
  idempotencyKey,
  method,
  recipeVersionId,
  resource,
}: {
  body?: RatingInput;
  idempotencyKey: string;
  method: "DELETE" | "PUT";
  recipeVersionId: InteractionRecipeVersionId;
  resource: "rating" | "save";
}): Promise<RecipeViewerState> {
  try {
    const requestFingerprint = await interactionRequestFingerprint(
      recipeVersionId,
      resource,
      method,
      body ?? null,
    );
    const response = await browserApiRequest(
      interactionUrl(recipeVersionId, resource),
      {
        body: body === undefined ? undefined : JSON.stringify(body),
        csrf: "member",
        errorContract: INTERACTION_ERROR_CONTRACT,
        headers:
          body === undefined ? undefined : { "Content-Type": "application/json" },
        identity: { idempotencyKey, requestFingerprint },
        kind: "mutation",
        method,
      },
    );
    return requiredViewerState(response.data);
  } catch (error) {
    throw interactionFailure(
      error,
      "Recipe Lab received an invalid recipe activity response.",
    );
  }
}

export async function setRecipeSaved(
  recipeVersionId: string,
  saved: boolean,
  idempotencyKey: string,
): Promise<RecipeViewerState> {
  return interactionRequest({
    idempotencyKey,
    method: saved ? "PUT" : "DELETE",
    recipeVersionId,
    resource: "save",
  });
}

export async function setRecipeRating(
  recipeVersionId: string,
  rating: RatingValue,
  idempotencyKey: string,
): Promise<RecipeViewerState> {
  const body = { rating } satisfies RatingInput;
  return interactionRequest({
    body,
    idempotencyKey,
    method: "PUT",
    recipeVersionId,
    resource: "rating",
  });
}

export async function clearRecipeRating(
  recipeVersionId: string,
  idempotencyKey: string,
): Promise<RecipeViewerState> {
  return interactionRequest({
    idempotencyKey,
    method: "DELETE",
    recipeVersionId,
    resource: "rating",
  });
}

export async function recordRecipeView(
  recipeVersionId: string,
  idempotencyKey: string,
): Promise<void> {
  try {
    const requestFingerprint = await interactionRequestFingerprint(
      recipeVersionId,
      "view",
      "POST",
    );
    await browserApiRequest(interactionUrl(recipeVersionId, "view"), {
      csrf: "member",
      errorContract: INTERACTION_ERROR_CONTRACT,
      identity: { idempotencyKey, requestFingerprint },
      kind: "mutation",
      method: "POST",
      responseBody: "empty",
    });
  } catch (error) {
    throw interactionFailure(
      error,
      "Recipe Lab received an invalid recipe activity response.",
    );
  }
}

function parseDetailViewerState(
  value: unknown,
  expectedRecipeVersionId: string,
): RecipeViewerState | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      !("viewer_state" in value)
    ) {
      throw new TypeError("Missing viewer state.");
    }
    const viewerState = parseRecipeViewerState(
      (value as Record<string, unknown>).viewer_state,
    );
    if (
      viewerState !== null &&
      viewerState.recipe_version_id !== expectedRecipeVersionId
    ) {
      throw new TypeError("Private state belongs to a different recipe.");
    }
    return viewerState;
  } catch {
    throw invalidInteractionResponse(
      "Recipe Lab received an invalid private recipe state.",
    );
  }
}

function parseViewerStates(
  value: unknown,
  expectedRecipeVersionIds: readonly string[],
): RecipeViewerState[] {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      !("items" in value) ||
      !Array.isArray((value as Record<string, unknown>).items)
    ) {
      throw new TypeError("Missing viewer states.");
    }
    const items = (value as { items: unknown[] }).items.map((item) =>
      parseRecipeViewerState(item),
    );
    if (
      items.some((item) => item === null) ||
      items.length !== expectedRecipeVersionIds.length ||
      items.some(
        (item, index) =>
          item?.recipe_version_id !== expectedRecipeVersionIds[index],
      )
    ) {
      throw new TypeError("Private states do not match the requested recipes.");
    }
    return items as RecipeViewerState[];
  } catch (error) {
    if (error instanceof InteractionApiError) throw error;
    throw invalidInteractionResponse(
      "Recipe Lab received invalid private recipe states.",
    );
  }
}

export async function fetchRecipeViewerState(
  recipeVersionId: string,
  signal?: AbortSignal,
): Promise<RecipeViewerState | null> {
  try {
    const response = await browserApiRequest(
      `/api/recipes/${encodeURIComponent(recipeVersionId)}`,
      {
        errorContract: INTERACTION_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        signal,
      },
    );
    return parseDetailViewerState(response.data, recipeVersionId);
  } catch (error) {
    rethrowCallerAbort(error, signal);
    throw interactionFailure(
      error,
      "Recipe Lab received an invalid private recipe state.",
    );
  }
}

export async function fetchRecipeViewerStates(
  recipeVersionIds: readonly string[],
  signal?: AbortSignal,
): Promise<RecipeViewerState[]> {
  const uniqueIds = [...new Set(recipeVersionIds)];
  if (uniqueIds.length === 0) {
    return [];
  }

  const query = {
    recipe_version_id: uniqueIds,
  } satisfies ViewerStatesQuery;
  const searchParams = new URLSearchParams();
  for (const recipeVersionId of query.recipe_version_id) {
    searchParams.append("recipe_version_id", recipeVersionId);
  }
  try {
    const response = await browserApiRequest(
      `/api/recipes/viewer-states?${searchParams.toString()}`,
      {
        errorContract: INTERACTION_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        signal,
      },
    );
    return parseViewerStates(response.data, uniqueIds);
  } catch (error) {
    rethrowCallerAbort(error, signal);
    throw interactionFailure(
      error,
      "Recipe Lab received invalid private recipe states.",
    );
  }
}
