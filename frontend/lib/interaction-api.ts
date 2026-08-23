export type RatingValue = 1 | 2 | 3 | 4 | 5;

export interface DemoUser {
  id: string;
  display_name: string;
  identity_mode: "shared_demo";
}

export interface RecipeViewerState {
  recipe_version_id: string;
  user: DemoUser;
  saved: boolean;
  rating: RatingValue | null;
}

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
  let message = "The recipe service could not update your demo activity.";
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
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  return (await response.json()) as RecipeViewerState;
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
    },
  });

  if (!response.ok) {
    throw await apiError(response);
  }
}
