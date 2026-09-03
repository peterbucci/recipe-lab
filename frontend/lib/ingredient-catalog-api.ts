import {
  type ApiValidationIssue,
} from "./auth-api";
import type { operations } from "./api-contracts/generated";
import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "./api-transport/core";

type IngredientCatalogOperation =
  operations["ingredient_catalog_api_ingredients_get"];
type IngredientCatalogResponse =
  IngredientCatalogOperation["responses"][200]["content"]["application/json"];
type IngredientCatalogContract = IngredientCatalogResponse["items"][number];
type IngredientCatalogQuery = NonNullable<
  IngredientCatalogOperation["parameters"]["query"]
>;
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
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

export type CatalogIngredient = Omit<
  Mutable<IngredientCatalogContract>,
  "aliases"
> & { aliases: string[] };

export type CatalogIngredientPage = Omit<
  Mutable<IngredientCatalogResponse>,
  "items"
> & { items: CatalogIngredient[] };

export interface CatalogIngredientSelection {
  ingredientId: string;
  canonicalName: string;
  displayName: string;
}

export type IngredientCatalogRequestStatus =
  "pending" | "approved" | "rejected" | "duplicate";

export interface MissingIngredientRequest {
  id: string;
  proposed_name: string;
  context: string | null;
  status: IngredientCatalogRequestStatus;
  created_at: string;
  reviewed_at: string | null;
  decision_reason: string | null;
  resolved_ingredient_id: string | null;
}

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

export interface MissingIngredientRequestInput {
  proposed_name: string;
  context: string | null;
}

export class IngredientCatalogApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiValidationIssue[];

  constructor(
    message: string,
    status: number,
    code = "ingredient_catalog_api_error",
    issues: ApiValidationIssue[] = [],
  ) {
    super(message);
    this.name = "IngredientCatalogApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
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

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isNullableBoundedText(
  value: unknown,
  maxLength: number,
): value is string | null {
  return value === null || isBoundedText(value, maxLength);
}

function isCatalogRequestStatus(
  value: unknown,
): value is IngredientCatalogRequestStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "duplicate"
  );
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

function parseMissingIngredientRequest(
  value: unknown,
): MissingIngredientRequest {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isBoundedText(value.proposed_name, 200) ||
    (value.context !== null && typeof value.context !== "string") ||
    !isCatalogRequestStatus(value.status) ||
    typeof value.created_at !== "string" ||
    (value.reviewed_at !== null && typeof value.reviewed_at !== "string") ||
    (value.decision_reason !== null &&
      typeof value.decision_reason !== "string") ||
    (value.resolved_ingredient_id !== null &&
      !isUuid(value.resolved_ingredient_id))
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
    status: value.status,
    created_at: value.created_at,
    reviewed_at: value.reviewed_at,
    decision_reason: value.decision_reason,
    resolved_ingredient_id: value.resolved_ingredient_id,
  };
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

const KNOWN_CATALOG_SEARCH_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "catalog_search_unavailable",
  "invalid_identifier",
  "rate_limit_exceeded",
  "validation_error",
]);

const CATALOG_SEARCH_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "ingredient_catalog_api_error",
  knownCodes: KNOWN_CATALOG_SEARCH_ERROR_CODES,
};

const KNOWN_MEMBER_INGREDIENT_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "authentication_required",
  "catalog_curator_required",
  "ingredient_catalog_conflict",
  "ingredient_request_conflict",
  "ingredient_request_not_found",
  "ingredient_request_already_reviewed",
  "invalid_csrf",
  "invalid_identifier",
  "rate_limit_exceeded",
  "validation_error",
]);

function catalogSearchError(error: ApiTransportError): IngredientCatalogApiError {
  if (error.reason === "invalid_response") {
    return new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient catalog response.",
      502,
      "invalid_ingredient_catalog_response",
    );
  }
  const message =
    error.status === 429
      ? "The ingredient catalog is receiving too many searches. Please wait and try again."
      : "The ingredient catalog could not be searched. Please try again.";
  return new IngredientCatalogApiError(message, error.status, error.code);
}

function parseIngredientIssues(value: unknown): ApiValidationIssue[] {
  if (!Array.isArray(value) || value.length > 20) return [];
  return value.flatMap((issue) => {
    if (!isRecord(issue) || !Array.isArray(issue.location)) return [];
    const location = issue.location;
    const safeLocation = location.every(
      (part) =>
        (typeof part === "string" &&
          [
            "body",
            "proposed_name",
            "context",
            "decision",
            "canonical_name",
            "aliases",
            "reason",
            "provenance",
            "ingredient_id",
            "request_id",
          ].includes(part)) ||
        (typeof part === "number" &&
          Number.isInteger(part) &&
          part >= 0 &&
          part <= 20),
    );
    if (!safeLocation) return [];
    const field = location.at(-1);
    return [
      {
        location: location as Array<string | number>,
        message:
          field === "proposed_name"
            ? "Review the proposed ingredient name."
            : field === "context"
              ? "Review the ingredient context."
              : "Review this field and try again.",
        type: "validation_error",
      },
    ];
  });
}

const INGREDIENT_REQUEST_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "ingredient_catalog_api_error",
  knownCodes: KNOWN_MEMBER_INGREDIENT_ERROR_CODES,
  parseIssues: parseIngredientIssues,
};

function ingredientRequestError(
  error: ApiTransportError,
  fallback: string,
): IngredientCatalogApiError {
  const code = error.code;
  const message =
    error.status === 401
      ? "Your session expired. Sign in again to continue."
      : error.status === 404
        ? "This ingredient request is no longer available."
        : error.status === 409 && code === "ingredient_request_conflict"
          ? "That ingredient is already approved or has a pending request."
          : error.status === 409
            ? "This ingredient request changed. Refresh it before trying again."
            : error.status === 422
              ? "Review the ingredient request fields and try again."
              : error.status === 429
                ? "Too many ingredient requests were made. Please wait and try again."
                : fallback;
  return new IngredientCatalogApiError(
    message,
    error.status,
    code,
    error.issues,
  );
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
  const queryContract = {
    page,
    page_size: pageSize,
    ...(normalizedQuery ? { q: normalizedQuery } : {}),
  } satisfies IngredientCatalogQuery;
  if (queryContract.q) {
    search.set("q", queryContract.q);
  }

  try {
    const response = await browserApiRequest(
      `/api/ingredients?${search.toString()}`,
      {
        errorContract: CATALOG_SEARCH_ERROR_CONTRACT,
        kind: "query",
        signal,
      },
    );
    return parseCatalogPage(response.data);
  } catch (error) {
    if (error instanceof IngredientCatalogApiError) throw error;
    if (error instanceof ApiTransportError) throw catalogSearchError(error);
    throw error;
  }
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

export function selectionForCatalogIngredient(
  ingredient: CatalogIngredient,
  query: string,
): CatalogIngredientSelection {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const exactCanonical =
    ingredient.canonical_name.toLocaleLowerCase() === normalizedQuery;
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
