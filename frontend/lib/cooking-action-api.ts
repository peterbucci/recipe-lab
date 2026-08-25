export interface CatalogActionType {
  id: string;
  key: string;
  canonical_verb: string;
  active: boolean;
  provenance: string;
}

export type CatalogActionTypeSummary = Omit<CatalogActionType, "provenance">;

interface CookingActionTypeResponse {
  items: CatalogActionType[];
}

interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export class CookingActionApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code = "cooking_action_api_error",
  ) {
    super(message);
    this.name = "CookingActionApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function parseCatalogActionType(value: unknown): CatalogActionType | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isBoundedText(value.key, 64) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.key) ||
    !isBoundedText(value.canonical_verb, 64) ||
    typeof value.active !== "boolean" ||
    !isBoundedText(value.provenance, 2_000)
  ) {
    return null;
  }

  return {
    id: value.id,
    key: value.key,
    canonical_verb: value.canonical_verb,
    active: value.active,
    provenance: value.provenance,
  };
}

export function parseCookingActionTypeResponse(value: unknown): CookingActionTypeResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new CookingActionApiError(
      "Recipe Lab received an invalid cooking action response.",
      502,
      "invalid_cooking_action_response",
    );
  }

  const items = value.items.map(parseCatalogActionType);
  if (items.some((item) => item === null)) {
    throw new CookingActionApiError(
      "Recipe Lab received an invalid cooking action response.",
      502,
      "invalid_cooking_action_response",
    );
  }

  const typedItems = items as CatalogActionType[];
  const uniqueIds = new Set(typedItems.map((item) => item.id));
  const uniqueKeys = new Set(typedItems.map((item) => item.key));
  if (uniqueIds.size !== typedItems.length || uniqueKeys.size !== typedItems.length) {
    throw new CookingActionApiError(
      "Recipe Lab received an invalid cooking action response.",
      502,
      "invalid_cooking_action_response",
    );
  }

  return { items: typedItems };
}

function apiBaseUrl(): string {
  const configured =
    process.env.RECIPE_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8000";
  return configured.trim().replace(/\/+$/, "");
}

function isErrorPayload(value: unknown): value is ApiErrorPayload {
  return isRecord(value) && "error" in value;
}

async function apiError(response: Response): Promise<CookingActionApiError> {
  let message = "The cooking action service could not complete this request.";
  let code = "cooking_action_api_error";

  try {
    const payload: unknown = await response.json();
    if (isErrorPayload(payload) && isRecord(payload.error)) {
      if (typeof payload.error.message === "string") {
        message = payload.error.message;
      }
      if (typeof payload.error.code === "string") {
        code = payload.error.code;
      }
    }
  } catch {
    // Keep the stable fallback when the upstream body is not JSON.
  }

  return new CookingActionApiError(message, response.status, code);
}

export async function fetchCookingActionTypes(): Promise<CatalogActionType[]> {
  const url = new URL("/api/cooking-action-types", `${apiBaseUrl()}/`);
  url.searchParams.set("limit", "100");
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  return parseCookingActionTypeResponse(await response.json()).items;
}

export function catalogActionTypeSummary(
  actionType: CatalogActionType,
): CatalogActionTypeSummary {
  return {
    id: actionType.id,
    key: actionType.key,
    canonical_verb: actionType.canonical_verb,
    active: actionType.active,
  };
}
