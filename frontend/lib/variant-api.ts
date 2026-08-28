import type { RecipeDetail } from "./recipe-api";
import { memberMutationHeaders, notifySessionExpired } from "./auth-api";
import { parseRecipeViewerState } from "./recipe-viewer-state";
import type { StructuredActionInput } from "./structured-action";
import type { VariantMeasureInput } from "./structured-measure";

export type { VariantMeasureInput } from "./structured-measure";

export type IngredientEdit =
  | {
      op: "set_measure";
      recipe_ingredient_id: string;
      measure: VariantMeasureInput;
    }
  | {
      op: "replace";
      recipe_ingredient_id: string;
      ingredient_id: string;
      display_name: string;
    }
  | {
      op: "add";
      edit_ref: string;
      ingredient_id: string;
      display_name: string;
      measure: VariantMeasureInput;
      preparation_notes: string | null;
    }
  | {
      op: "remove";
      recipe_ingredient_id: string;
    };

export type InstructionEdit =
  | {
      op: "update";
      recipe_instruction_id: string;
      text: string;
    }
  | {
      op: "add";
      text: string;
      actions: StructuredActionInput[];
    }
  | {
      op: "set_actions";
      recipe_instruction_id: string;
      actions: StructuredActionInput[];
    }
  | {
      op: "remove";
      recipe_instruction_id: string;
    };

export interface RecipeVariantCreateRequest {
  title: string;
  description: string | null;
  servings: string;
  ingredient_edits: IngredientEdit[];
  instruction_edits: InstructionEdit[];
}

interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

const KNOWN_VARIANT_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "authentication_required",
  "idempotency_key_conflict",
  "invalid_csrf",
  "invalid_identifier",
  "invalid_recipe_edits",
  "rate_limit_exceeded",
  "recipe_fork_source_unavailable",
  "recipe_not_found",
  "recipe_variant_publication_requires_draft",
  "validation_error",
]);

function knownVariantErrorCode(value: unknown): string {
  return typeof value === "string" && KNOWN_VARIANT_ERROR_CODES.has(value)
    ? value
    : "variant_api_error";
}

export class VariantApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "variant_api_error") {
    super(message);
    this.name = "VariantApiError";
    this.status = status;
    this.code = code;
  }
}

function variantUrl(sourceRecipeVersionId: string): string {
  return `/api/recipes/${encodeURIComponent(sourceRecipeVersionId)}/variants`;
}

function isErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === "object" && value !== null && "error" in value;
}

async function apiError(response: Response): Promise<VariantApiError> {
  let code = "variant_api_error";

  try {
    const payload: unknown = await response.json();
    if (
      isErrorPayload(payload) &&
      typeof payload.error === "object" &&
      payload.error !== null
    ) {
      code = knownVariantErrorCode(payload.error.code);
    }
  } catch {
    // Keep the stable user-facing fallback when the upstream body is not JSON.
  }

  const message =
    response.status === 401
      ? "Your session expired. Your version was not created; sign in again to continue."
      : response.status === 404
        ? "The recipe you started from is no longer available. Your version was not created."
        : response.status === 409 &&
            code === "recipe_variant_publication_requires_draft"
          ? "Save this version as a private draft before publishing it."
          : response.status === 409
            ? "This version changed before it could be created. Refresh the recipe and try again."
            : response.status === 422
              ? "Some recipe fields need attention. Review your version and try again."
              : "Recipe Lab could not create your version. Your edits are still here; please try again.";
  return new VariantApiError(message, response.status, code);
}

export async function createRecipeVariant(
  sourceRecipeVersionId: string,
  payload: RecipeVariantCreateRequest,
  idempotencyKey: string,
): Promise<RecipeDetail> {
  const response = await fetch(variantUrl(sourceRecipeVersionId), {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...memberMutationHeaders(),
    },
    body: JSON.stringify(payload),
    credentials: "same-origin",
  });

  if (!response.ok) {
    if (response.status === 401) {
      notifySessionExpired();
    }
    throw await apiError(response);
  }

  try {
    const payload = (await response.json()) as RecipeDetail;
    const viewerState = parseRecipeViewerState(payload.viewer_state);
    if (viewerState !== null && viewerState.recipe_version_id !== payload.id) {
      throw new TypeError("Private state belongs to a different recipe.");
    }
    return { ...payload, viewer_state: viewerState };
  } catch {
    throw new VariantApiError(
      "Recipe Lab could not confirm that your version was created. Check My recipes before trying again.",
      502,
      "invalid_variant_response",
    );
  }
}
