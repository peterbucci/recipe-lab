import {
  memberMutationHeaders,
  notifySessionExpired,
} from "./auth-api";
import {
  parseRecipeViewerState,
  type RatingValue,
  type RecipeViewerState,
} from "./recipe-viewer-state";

export type { RatingValue, RecipeViewerState } from "./recipe-viewer-state";

interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
  };
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
  recipeVersionId: string,
  resource: "rating" | "save" | "view",
): string {
  return `/api/recipes/${encodeURIComponent(recipeVersionId)}/${resource}`;
}

function isErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === "object" && value !== null && "error" in value;
}

async function apiError(response: Response): Promise<InteractionApiError> {
  let message = "The recipe service could not update your recipe activity.";
  let code = "interaction_api_error";

  try {
    const payload: unknown = await response.json();
    if (isErrorPayload(payload) && typeof payload.error === "object" && payload.error !== null) {
      if (typeof payload.error.message === "string") {
        message = payload.error.message;
      }
      if (typeof payload.error.code === "string") {
        code = payload.error.code;
      }
    }
  } catch {
    // Keep the stable user-facing fallback when the upstream body is not JSON.
  }

  return new InteractionApiError(message, response.status, code);
}

async function interactionRequest(
  url: string,
  init: RequestInit,
): Promise<RecipeViewerState> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...memberMutationHeaders(),
      ...init.headers,
    },
    credentials: "same-origin",
  });

  if (!response.ok) {
    if (response.status === 401) {
      notifySessionExpired();
    }
    throw await apiError(response);
  }

  try {
    const state = parseRecipeViewerState(await response.json());
    if (state === null) {
      throw new TypeError("Member mutations must return private recipe state.");
    }
    return state;
  } catch (reason) {
    if (reason instanceof InteractionApiError) {
      throw reason;
    }
    throw new InteractionApiError(
      "Recipe Lab received an invalid recipe activity response.",
      502,
      "invalid_interaction_response",
    );
  }
}

export async function setRecipeSaved(
  recipeVersionId: string,
  saved: boolean,
  idempotencyKey: string,
): Promise<RecipeViewerState> {
  return interactionRequest(interactionUrl(recipeVersionId, "save"), {
    method: saved ? "PUT" : "DELETE",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export async function setRecipeRating(
  recipeVersionId: string,
  rating: RatingValue,
  idempotencyKey: string,
): Promise<RecipeViewerState> {
  return interactionRequest(interactionUrl(recipeVersionId, "rating"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ rating }),
  });
}

export async function recordRecipeView(
  recipeVersionId: string,
  idempotencyKey: string,
): Promise<void> {
  const response = await fetch(interactionUrl(recipeVersionId, "view"), {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Idempotency-Key": idempotencyKey,
      ...memberMutationHeaders(),
    },
    credentials: "same-origin",
  });

  if (!response.ok) {
    if (response.status === 401) {
      notifySessionExpired();
    }
    throw await apiError(response);
  }
}

export async function fetchRecipeViewerState(
  recipeVersionId: string,
  signal?: AbortSignal,
): Promise<RecipeViewerState | null> {
  const response = await fetch(
    `/api/recipes/${encodeURIComponent(recipeVersionId)}`,
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    },
  );

  if (!response.ok) {
    if (response.status === 401) {
      notifySessionExpired();
    }
    throw await apiError(response);
  }

  try {
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || !("viewer_state" in payload)) {
      throw new TypeError("Missing viewer state.");
    }
    const viewerState = parseRecipeViewerState(
      (payload as Record<string, unknown>).viewer_state,
    );
    if (viewerState !== null && viewerState.recipe_version_id !== recipeVersionId) {
      throw new TypeError("Private state belongs to a different recipe.");
    }
    return viewerState;
  } catch (reason) {
    if (reason instanceof InteractionApiError) {
      throw reason;
    }
    throw new InteractionApiError(
      "Recipe Lab received an invalid private recipe state.",
      502,
      "invalid_interaction_response",
    );
  }
}
