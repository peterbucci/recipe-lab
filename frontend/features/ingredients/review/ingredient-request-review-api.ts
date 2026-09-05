import type { operations } from "../../../shared/api/generated/generated";
import { browserApiRequest } from "../../../shared/api/browser";
import { ApiTransportError } from "../../../shared/api/core";
import { IngredientCatalogApiError } from "../ingredient-api-error";
import {
  isBoundedText,
  isNullableBoundedText,
  isNullableUuid,
  isRecord,
  isUuid,
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

type IngredientReviewQueueWire =
  operations["review_queue_api_ingredient_requests_get"]["responses"][200]["content"]["application/json"];
type IngredientReviewDetailWire =
  operations["review_request_detail_api_ingredient_requests__request_id__review_get"]["responses"][200]["content"]["application/json"];
type IngredientReviewOperation =
  operations["review_ingredient_request_api_ingredient_requests__request_id__review_post"];
type IngredientReviewInputWire =
  IngredientReviewOperation["requestBody"]["content"]["application/json"];
type IngredientReviewItemWire =
  IngredientReviewOperation["responses"][200]["content"]["application/json"];

export interface IngredientCatalogReviewItem extends MissingIngredientRequest {
  updated_at: string;
  requester_user_id: string;
  reviewer_user_id: string | null;
  duplicate_of_request_id: string | null;
  approved_canonical_name: string | null;
  approved_aliases: string[] | null;
  approval_provenance: string | null;
}

export interface IngredientCatalogReviewPage {
  items: IngredientCatalogReviewItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface IngredientCatalogRequester {
  id: string;
  handle: string | null;
  display_name: string;
}

export interface IngredientCatalogRequestCandidate {
  id: string;
  proposed_name: string;
  status: "pending" | "approved";
  created_at: string;
  resolved_ingredient_id: string | null;
  approved_canonical_name: string | null;
}

export interface IngredientCatalogReviewDetail extends IngredientCatalogReviewItem {
  requester: IngredientCatalogRequester;
  catalog_candidates: CatalogIngredient[];
  request_candidates: IngredientCatalogRequestCandidate[];
}

export interface ApproveIngredientCatalogRequestInput {
  decision: "approve";
  canonical_name: string;
  aliases: string[];
  reason: string;
  provenance: string;
}

export interface RejectIngredientCatalogRequestInput {
  decision: "reject";
  reason: string;
}

export interface DuplicateIngredientCatalogRequestInput {
  decision: "duplicate";
  reason: string;
  ingredient_id: string | null;
  request_id: string | null;
}

export type IngredientCatalogReviewInput =
  | ApproveIngredientCatalogRequestInput
  | RejectIngredientCatalogRequestInput
  | DuplicateIngredientCatalogRequestInput;

function parseReviewItem(value: unknown): IngredientCatalogReviewItem {
  const request = parseMissingIngredientRequest(value);
  if (
    !isRecord(value) ||
    typeof value.updated_at !== "string" ||
    !isUuid(value.requester_user_id) ||
    !isNullableUuid(value.reviewer_user_id) ||
    !isNullableUuid(value.duplicate_of_request_id) ||
    !isNullableBoundedText(value.approved_canonical_name, 200) ||
    (value.approved_aliases !== null &&
      (!Array.isArray(value.approved_aliases) ||
        !value.approved_aliases.every((alias) => isBoundedText(alias, 200)))) ||
    !isNullableBoundedText(value.approval_provenance, 1_000)
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient review response.",
      502,
      "invalid_ingredient_review_response",
    );
  }

  return {
    ...request,
    updated_at: value.updated_at,
    requester_user_id: value.requester_user_id,
    reviewer_user_id: value.reviewer_user_id,
    duplicate_of_request_id: value.duplicate_of_request_id,
    approved_canonical_name: value.approved_canonical_name,
    approved_aliases: value.approved_aliases as string[] | null,
    approval_provenance: value.approval_provenance,
  };
}

function parseReviewPage(value: unknown): IngredientCatalogReviewPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !Number.isInteger(value.page) ||
    !Number.isInteger(value.page_size) ||
    !Number.isInteger(value.total) ||
    !Number.isInteger(value.total_pages)
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient review queue.",
      502,
      "invalid_ingredient_review_response",
    );
  }

  const items = value.items.map(parseReviewItem);
  if (
    (value.page as number) < 1 ||
    (value.page_size as number) < 1 ||
    (value.page_size as number) > 100 ||
    (value.total as number) < 0 ||
    (value.total_pages as number) < 0
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient review queue.",
      502,
      "invalid_ingredient_review_response",
    );
  }

  return {
    items,
    page: value.page as number,
    page_size: value.page_size as number,
    total: value.total as number,
    total_pages: value.total_pages as number,
  };
}

function parseRequester(value: unknown): IngredientCatalogRequester | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isBoundedText(value.display_name, 120) ||
    (value.handle !== null && !isBoundedText(value.handle, 30))
  ) {
    return null;
  }
  return {
    id: value.id,
    display_name: value.display_name,
    handle: value.handle,
  };
}

function parseRequestCandidate(
  value: unknown,
): IngredientCatalogRequestCandidate | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isBoundedText(value.proposed_name, 200) ||
    (value.status !== "pending" && value.status !== "approved") ||
    typeof value.created_at !== "string" ||
    !isNullableUuid(value.resolved_ingredient_id) ||
    !isNullableBoundedText(value.approved_canonical_name, 200)
  ) {
    return null;
  }
  return {
    id: value.id,
    proposed_name: value.proposed_name,
    status: value.status,
    created_at: value.created_at,
    resolved_ingredient_id: value.resolved_ingredient_id,
    approved_canonical_name: value.approved_canonical_name,
  };
}

function parseReviewDetail(value: unknown): IngredientCatalogReviewDetail {
  const request = parseReviewItem(value);
  if (
    !isRecord(value) ||
    !Array.isArray(value.catalog_candidates) ||
    value.catalog_candidates.length > 10 ||
    !Array.isArray(value.request_candidates) ||
    value.request_candidates.length > 10
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient review detail.",
      502,
      "invalid_ingredient_review_response",
    );
  }
  const requester = parseRequester(value.requester);
  const catalogCandidates = value.catalog_candidates.map(
    parseCatalogIngredient,
  );
  const requestCandidates = value.request_candidates.map(parseRequestCandidate);
  if (
    requester === null ||
    catalogCandidates.some((candidate) => candidate === null) ||
    requestCandidates.some((candidate) => candidate === null)
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient review detail.",
      502,
      "invalid_ingredient_review_response",
    );
  }
  return {
    ...request,
    requester,
    catalog_candidates: catalogCandidates as CatalogIngredient[],
    request_candidates:
      requestCandidates as IngredientCatalogRequestCandidate[],
  };
}

export async function browseIngredientCatalogReviewRequests({
  status = "pending",
  page = 1,
  pageSize = 20,
  query = "",
  signal,
}: {
  status?: IngredientCatalogRequestStatus;
  page?: number;
  pageSize?: number;
  query?: string;
  signal?: AbortSignal;
} = {}): Promise<IngredientCatalogReviewPage> {
  const search = new URLSearchParams({
    status,
    page: String(page),
    page_size: String(pageSize),
  });
  const normalizedQuery = query.trim();
  if (normalizedQuery) {
    search.set("q", normalizedQuery);
  }
  try {
    const response = await browserApiRequest(
      `/api/ingredient-requests?${search.toString()}`,
      {
        errorContract: INGREDIENT_REQUEST_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        signal,
      },
    );
    return parseReviewPage(response.data as IngredientReviewQueueWire);
  } catch (error) {
    if (error instanceof IngredientCatalogApiError) throw error;
    if (error instanceof ApiTransportError) {
      if (signal?.aborted) {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      throw ingredientRequestError(
        error,
        "The ingredient review queue could not be loaded.",
      );
    }
    throw error;
  }
}

export async function fetchIngredientCatalogReviewDetail(
  requestId: string,
  signal?: AbortSignal,
): Promise<IngredientCatalogReviewDetail> {
  try {
    const response = await browserApiRequest(
      `/api/ingredient-requests/${encodeURIComponent(requestId)}/review`,
      {
        errorContract: INGREDIENT_REQUEST_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        signal,
      },
    );
    return parseReviewDetail(response.data as IngredientReviewDetailWire);
  } catch (error) {
    if (error instanceof IngredientCatalogApiError) throw error;
    if (error instanceof ApiTransportError) {
      if (signal?.aborted) {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      throw ingredientRequestError(
        error,
        "The ingredient request could not be loaded.",
      );
    }
    throw error;
  }
}

export async function reviewIngredientCatalogRequest(
  requestId: string,
  input: IngredientCatalogReviewInput,
): Promise<IngredientCatalogReviewItem> {
  try {
    const wireInput: IngredientReviewInputWire = input;
    const response = await browserApiRequest(
      `/api/ingredient-requests/${encodeURIComponent(requestId)}/review`,
      {
        body: JSON.stringify(wireInput),
        csrf: "member",
        errorContract: INGREDIENT_REQUEST_ERROR_CONTRACT,
        headers: { "Content-Type": "application/json" },
        identity: null,
        kind: "mutation",
        method: "POST",
      },
    );
    return parseReviewItem(response.data as IngredientReviewItemWire);
  } catch (error) {
    if (error instanceof IngredientCatalogApiError) throw error;
    if (error instanceof ApiTransportError) {
      throw ingredientRequestError(
        error,
        "The ingredient review could not be saved.",
      );
    }
    throw error;
  }
}
