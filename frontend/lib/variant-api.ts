import type { RecipeDetail } from "./recipe-api";

export type IngredientEdit =
  | {
      op: "set_quantity";
      recipe_ingredient_id: string;
      quantity: string | null;
    }
  | {
      op: "set_unit";
      recipe_ingredient_id: string;
      unit: string | null;
    }
  | {
      op: "replace";
      recipe_ingredient_id: string;
      ingredient_name: string;
    }
  | {
      op: "add";
      ingredient_name: string;
      quantity: string | null;
      unit: string | null;
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

function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  return configured.trim().replace(/\/+$/, "");
}

function variantUrl(sourceRecipeVersionId: string): URL {
  return new URL(
    `/api/recipes/${encodeURIComponent(sourceRecipeVersionId)}/variants`,
    `${apiBaseUrl()}/`,
  );
}

function isErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === "object" && value !== null && "error" in value;
}

async function apiError(response: Response): Promise<VariantApiError> {
  let message = "The recipe service could not create your version.";
  let code = "variant_api_error";

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
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  return (await response.json()) as RecipeDetail;
}
