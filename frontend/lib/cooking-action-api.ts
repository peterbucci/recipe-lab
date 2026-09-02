import type { operations } from "./api-contracts/generated";
import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "./api-transport/core";
import { serverApiRequest } from "./api-transport/server";

type CookingActionTypeOperation =
  operations["cooking_action_type_catalog_api_cooking_action_types_get"];
type CookingActionTypeResponseContract =
  CookingActionTypeOperation["responses"][200]["content"]["application/json"];
type CookingActionTypeQuery = NonNullable<
  CookingActionTypeOperation["parameters"]["query"]
>;
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

export type CatalogActionType =
  Mutable<CookingActionTypeResponseContract["items"][number]>;

export type CatalogActionTypeSummary = Omit<CatalogActionType, "provenance">;

interface CookingActionTypeResponse {
  items: CatalogActionType[];
}

const KNOWN_COOKING_ACTION_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "catalog_unavailable",
  "invalid_identifier",
  "rate_limit_exceeded",
  "validation_error",
]);

const COOKING_ACTION_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "cooking_action_api_error",
  knownCodes: KNOWN_COOKING_ACTION_ERROR_CODES,
};

function cookingActionErrorMessage(status: number): string {
  if (status === 422) return "Review the cooking action request and try again.";
  if (status === 429) {
    return "The cooking action catalog is receiving too many requests. Please wait and try again.";
  }
  return "The cooking action service could not complete this request.";
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
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

export function parseCookingActionTypeResponse(
  value: unknown,
): CookingActionTypeResponse {
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
  if (
    uniqueIds.size !== typedItems.length ||
    uniqueKeys.size !== typedItems.length
  ) {
    throw new CookingActionApiError(
      "Recipe Lab received an invalid cooking action response.",
      502,
      "invalid_cooking_action_response",
    );
  }

  return { items: typedItems };
}

function fromTransportError(error: ApiTransportError): CookingActionApiError {
  if (error.reason === "invalid_response") {
    return new CookingActionApiError(
      "Recipe Lab received an invalid cooking action response.",
      502,
      "invalid_cooking_action_response",
    );
  }
  return new CookingActionApiError(
    cookingActionErrorMessage(error.status),
    error.status,
    error.code,
  );
}

export async function fetchCookingActionTypes(): Promise<CatalogActionType[]> {
  const query = { limit: 100 } satisfies CookingActionTypeQuery;
  const search = new URLSearchParams({ limit: String(query.limit) });
  try {
    const response = await serverApiRequest(
      `/api/cooking-action-types?${search.toString()}`,
      {
        errorContract: COOKING_ACTION_ERROR_CONTRACT,
        kind: "query",
      },
    );
    return parseCookingActionTypeResponse(response.data).items;
  } catch (error) {
    if (error instanceof CookingActionApiError) throw error;
    if (error instanceof ApiTransportError) throw fromTransportError(error);
    throw error;
  }
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
