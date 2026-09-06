import type { operations } from "../../../shared/api/generated/generated";
import { browserApiRequest } from "../../../shared/api/browser";
import { ApiTransportError } from "../../../shared/api/core";
import { IngredientCatalogApiError } from "../ingredient-api-error";
import {
  isRecord,
  parseCatalogIngredient,
  parseMissingIngredientRequest,
} from "../ingredient-contract-parsers";
import type {
  CatalogIngredient,
  IngredientCatalogRequestStatus,
  MissingIngredientRequest,
} from "../ingredient-model";
import {
  INGREDIENT_REQUEST_ERROR_CONTRACT,
  ingredientRequestError,
} from "../ingredient-request-error-contract";

type CreateIngredientRequestOperation =
  operations["create_ingredient_request_api_ingredient_requests_post"];
type CreateIngredientRequestInput =
  CreateIngredientRequestOperation["requestBody"]["content"]["application/json"];
type CreateIngredientRequestWire =
  CreateIngredientRequestOperation["responses"][201]["content"]["application/json"];
type MyIngredientRequestsWire =
  operations["my_ingredient_requests_api_ingredient_requests_mine_get"]["responses"][200]["content"]["application/json"];
type IngredientRequestDetailWire =
  operations["ingredient_request_detail_api_ingredient_requests__request_id__get"]["responses"][200]["content"]["application/json"];

export interface MemberIngredientRequest extends MissingIngredientRequest {
  resolved_ingredient: CatalogIngredient | null;
}

export interface MemberIngredientRequestPage {
  items: MemberIngredientRequest[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface MissingIngredientRequestInput {
  proposed_name: string;
  context: string | null;
}

function invalidMemberIngredientRequestResponse(): IngredientCatalogApiError {
  return new IngredientCatalogApiError(
    "Recipe Lab received an invalid ingredient request response.",
    502,
    "invalid_ingredient_request_response",
  );
}

function parseMemberIngredientRequest(value: unknown): MemberIngredientRequest {
  const request = parseMissingIngredientRequest(value);
  if (!isRecord(value)) {
    throw invalidMemberIngredientRequestResponse();
  }

  const resolvedIngredient =
    value.resolved_ingredient === null
      ? null
      : parseCatalogIngredient(value.resolved_ingredient);
  const resolvedStatus =
    request.status === "approved" || request.status === "duplicate";

  if (
    (resolvedStatus &&
      (request.resolved_ingredient_id === null ||
        resolvedIngredient === null ||
        resolvedIngredient.id !== request.resolved_ingredient_id)) ||
    (!resolvedStatus &&
      (request.resolved_ingredient_id !== null ||
        value.resolved_ingredient !== null))
  ) {
    throw invalidMemberIngredientRequestResponse();
  }

  return {
    ...request,
    resolved_ingredient: resolvedIngredient,
  };
}

function parseMemberIngredientRequestPage(
  value: unknown,
): MemberIngredientRequestPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !Number.isInteger(value.page) ||
    !Number.isInteger(value.page_size) ||
    !Number.isInteger(value.total) ||
    !Number.isInteger(value.total_pages)
  ) {
    throw invalidMemberIngredientRequestResponse();
  }

  const items = value.items.map(parseMemberIngredientRequest);
  if (
    (value.page as number) < 1 ||
    (value.page_size as number) < 1 ||
    (value.page_size as number) > 100 ||
    (value.total as number) < 0 ||
    (value.total_pages as number) < 0
  ) {
    throw invalidMemberIngredientRequestResponse();
  }

  return {
    items,
    page: value.page as number,
    page_size: value.page_size as number,
    total: value.total as number,
    total_pages: value.total_pages as number,
  };
}

export async function submitMissingIngredientRequest(
  input: MissingIngredientRequestInput,
): Promise<MissingIngredientRequest> {
  try {
    const wireInput: CreateIngredientRequestInput = input;
    const response = await browserApiRequest("/api/ingredient-requests", {
      body: JSON.stringify(wireInput),
      csrf: "member",
      errorContract: INGREDIENT_REQUEST_ERROR_CONTRACT,
      headers: { "Content-Type": "application/json" },
      identity: null,
      kind: "mutation",
      method: "POST",
    });
    return parseMissingIngredientRequest(
      response.data as CreateIngredientRequestWire,
    );
  } catch (error) {
    if (error instanceof IngredientCatalogApiError) throw error;
    if (error instanceof ApiTransportError) {
      throw ingredientRequestError(
        error,
        "The ingredient request could not be submitted. Please try again.",
      );
    }
    throw error;
  }
}

export async function browseMyIngredientRequests({
  status,
  reviewedOnly = false,
  page = 1,
  pageSize = 20,
  query = "",
  signal,
}: {
  status?: IngredientCatalogRequestStatus;
  reviewedOnly?: boolean;
  page?: number;
  pageSize?: number;
  query?: string;
  signal?: AbortSignal;
} = {}): Promise<MemberIngredientRequestPage> {
  const search = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (status) {
    search.set("status", status);
  }
  if (reviewedOnly) {
    search.set("reviewed_only", "true");
  }
  const normalizedQuery = query.trim();
  if (normalizedQuery) {
    search.set("q", normalizedQuery);
  }

  try {
    const response = await browserApiRequest(
      `/api/ingredient-requests/mine?${search.toString()}`,
      {
        errorContract: INGREDIENT_REQUEST_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        sessionExpiry: "local",
        signal,
      },
    );
    return parseMemberIngredientRequestPage(
      response.data as MyIngredientRequestsWire,
    );
  } catch (error) {
    if (error instanceof IngredientCatalogApiError) throw error;
    if (error instanceof ApiTransportError) {
      if (signal?.aborted) {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      throw ingredientRequestError(
        error,
        "Your ingredient requests could not be loaded. Please try again.",
      );
    }
    throw error;
  }
}

export async function fetchMyIngredientRequest(
  requestId: string,
  signal?: AbortSignal,
): Promise<MemberIngredientRequest> {
  try {
    const response = await browserApiRequest(
      `/api/ingredient-requests/${encodeURIComponent(requestId)}`,
      {
        errorContract: INGREDIENT_REQUEST_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        sessionExpiry: "local",
        signal,
      },
    );
    return parseMemberIngredientRequest(
      response.data as IngredientRequestDetailWire,
    );
  } catch (error) {
    if (error instanceof IngredientCatalogApiError) throw error;
    if (error instanceof ApiTransportError) {
      if (signal?.aborted) {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      throw ingredientRequestError(
        error,
        "The ingredient request could not be loaded. Please try again.",
      );
    }
    throw error;
  }
}
