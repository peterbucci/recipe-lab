import { memberMutationHeaders, notifySessionExpired } from "./auth-api";

export interface CatalogIngredient {
  id: string;
  canonical_name: string;
  aliases: string[];
}

export interface CatalogIngredientPage {
  items: CatalogIngredient[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface CatalogIngredientSelection {
  ingredientId: string;
  canonicalName: string;
  displayName: string;
}

export interface MissingIngredientRequest {
  id: string;
  proposed_name: string;
  context: string | null;
  status: "pending" | "approved" | "rejected" | "duplicate";
  created_at: string;
  reviewed_at: string | null;
  decision_reason: string | null;
  resolved_ingredient_id: string | null;
}

export interface MissingIngredientRequestInput {
  proposed_name: string;
  context: string | null;
}

interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export class IngredientCatalogApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "ingredient_catalog_api_error") {
    super(message);
    this.name = "IngredientCatalogApiError";
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

function parseCatalogIngredient(value: unknown): CatalogIngredient | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isBoundedText(value.canonical_name, 200) ||
    !Array.isArray(value.aliases) ||
    !value.aliases.every((alias) => isBoundedText(alias, 200))
  ) {
    return null;
  }

  return {
    id: value.id,
    canonical_name: value.canonical_name,
    aliases: value.aliases,
  };
}

function parseCatalogPage(value: unknown): CatalogIngredientPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !Number.isInteger(value.page) ||
    !Number.isInteger(value.page_size) ||
    !Number.isInteger(value.total) ||
    !Number.isInteger(value.total_pages)
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient catalog response.",
      502,
      "invalid_ingredient_catalog_response",
    );
  }

  const items = value.items.map(parseCatalogIngredient);
  if (
    items.some((item) => item === null) ||
    (value.page as number) < 1 ||
    (value.page_size as number) < 1 ||
    (value.page_size as number) > 100 ||
    (value.total as number) < 0 ||
    (value.total_pages as number) < 0
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient catalog response.",
      502,
      "invalid_ingredient_catalog_response",
    );
  }

  return {
    items: items as CatalogIngredient[],
    page: value.page as number,
    page_size: value.page_size as number,
    total: value.total as number,
    total_pages: value.total_pages as number,
  };
}

function parseMissingIngredientRequest(value: unknown): MissingIngredientRequest {
  const statuses = new Set(["pending", "approved", "rejected", "duplicate"]);
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isBoundedText(value.proposed_name, 200) ||
    (value.context !== null && typeof value.context !== "string") ||
    typeof value.status !== "string" ||
    !statuses.has(value.status) ||
    typeof value.created_at !== "string" ||
    (value.reviewed_at !== null && typeof value.reviewed_at !== "string") ||
    (value.decision_reason !== null && typeof value.decision_reason !== "string") ||
    (value.resolved_ingredient_id !== null && !isUuid(value.resolved_ingredient_id))
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient request response.",
      502,
      "invalid_ingredient_request_response",
    );
  }

  return {
    id: value.id,
    proposed_name: value.proposed_name,
    context: value.context,
    status: value.status as MissingIngredientRequest["status"],
    created_at: value.created_at,
    reviewed_at: value.reviewed_at,
    decision_reason: value.decision_reason,
    resolved_ingredient_id: value.resolved_ingredient_id,
  };
}

function isErrorPayload(value: unknown): value is ApiErrorPayload {
  return isRecord(value) && "error" in value;
}

async function apiError(
  response: Response,
  fallback: string,
): Promise<IngredientCatalogApiError> {
  let message = fallback;
  let code = "ingredient_catalog_api_error";

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
    // Keep the stable user-facing fallback when the upstream body is not JSON.
  }

  return new IngredientCatalogApiError(message, response.status, code);
}

export async function searchCatalogIngredients({
  query = "",
  page = 1,
  pageSize = 20,
  signal,
}: {
  query?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
} = {}): Promise<CatalogIngredientPage> {
  const search = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const normalizedQuery = query.trim();
  if (normalizedQuery) {
    search.set("q", normalizedQuery);
  }

  const response = await fetch(`/api/ingredients?${search.toString()}`, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw await apiError(response, "The ingredient catalog could not be searched.");
  }
  return parseCatalogPage(await response.json());
}

export async function submitMissingIngredientRequest(
  input: MissingIngredientRequestInput,
): Promise<MissingIngredientRequest> {
  const response = await fetch("/api/ingredient-requests", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...memberMutationHeaders(),
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    if (response.status === 401) {
      notifySessionExpired();
    }
    throw await apiError(response, "The ingredient request could not be submitted.");
  }
  return parseMissingIngredientRequest(await response.json());
}

export function selectionForCatalogIngredient(
  ingredient: CatalogIngredient,
  query: string,
): CatalogIngredientSelection {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const exactCanonical = ingredient.canonical_name.toLocaleLowerCase() === normalizedQuery;
  const exactAlias = ingredient.aliases.find(
    (alias) => alias.toLocaleLowerCase() === normalizedQuery,
  );
  const canonicalContains = ingredient.canonical_name
    .toLocaleLowerCase()
    .includes(normalizedQuery);
  const matchingAlias = ingredient.aliases.find((alias) =>
    alias.toLocaleLowerCase().includes(normalizedQuery),
  );

  let displayName = ingredient.canonical_name;
  if (!exactCanonical && exactAlias) {
    displayName = exactAlias;
  } else if (!exactCanonical && !canonicalContains && matchingAlias) {
    displayName = matchingAlias;
  }

  return {
    ingredientId: ingredient.id,
    canonicalName: ingredient.canonical_name,
    displayName,
  };
}
