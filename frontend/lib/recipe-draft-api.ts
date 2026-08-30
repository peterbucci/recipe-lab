import {
  type ApiValidationIssue,
  memberMutationHeaders,
  notifySessionExpired,
} from "./auth-api";
import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  createRequestFingerprint,
  type ApiAuthenticationRecovery,
  type ApiMutationOutcome,
  type PublicApiErrorContract,
} from "./api-transport/core";
import type { CatalogActionTypeSummary } from "./cooking-action-api";
import type { CatalogIngredient } from "./ingredient-catalog-api";
import type { CatalogUnitSummary } from "./measurement-unit-api";
import type { RecipeCategory } from "./recipe-api";
import {
  MAX_RECIPE_CATEGORIES,
  parseRecipeCategories,
} from "./recipe-category";
import type { RecipeNumericMeasure } from "./structured-action";
import type {
  RecipeIngredientMeasure,
  VariantMeasureInput,
} from "./structured-measure";

export type RecipeDraftStatus = "active";

export interface RecipeDraftListItem {
  id: string;
  source_version_id: string | null;
  status: RecipeDraftStatus;
  revision: number;
  title: string;
  ingredient_count: number;
  instruction_count: number;
  created_at: string;
  updated_at: string;
}

export interface RecipeDraftPage {
  items: RecipeDraftListItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface RecipeDraftRequestSelection {
  kind: "request";
  request: {
    id: string;
    proposed_name: string;
    status: "pending" | "approved" | "rejected" | "duplicate";
    resolved_ingredient: CatalogIngredient | null;
  };
}

export interface RecipeDraftCatalogSelection {
  kind: "catalog";
  ingredient: CatalogIngredient;
  display_name: string;
}

export interface RecipeDraftIngredient {
  id: string;
  display_order: number;
  selection: RecipeDraftCatalogSelection | RecipeDraftRequestSelection;
  measure: RecipeIngredientMeasure;
  preparation_notes: string | null;
}

export interface RecipeDraftAction {
  id: string;
  display_order: number;
  action_type: CatalogActionTypeSummary;
  ingredient_occurrence_ids: string[];
  duration: RecipeNumericMeasure | null;
  temperature: RecipeNumericMeasure | null;
}

export interface RecipeDraftInstruction {
  id: string;
  display_order: number;
  text: string;
  actions: RecipeDraftAction[];
}

export interface RecipeDraftDetail {
  id: string;
  source_version_id: string | null;
  status: RecipeDraftStatus;
  revision: number;
  title: string;
  description: string | null;
  servings: string | null;
  categories: RecipeCategory[];
  ingredients: RecipeDraftIngredient[];
  instructions: RecipeDraftInstruction[];
  created_at: string;
  updated_at: string;
}

export type RecipeDraftIngredientInput =
  | {
      ref: string;
      selection: {
        kind: "catalog";
        ingredient_id: string;
        display_name: string;
      };
      measure: VariantMeasureInput;
      preparation_notes: string | null;
    }
  | {
      ref: string;
      selection: {
        kind: "request";
        ingredient_request_id: string;
      };
      measure: VariantMeasureInput;
      preparation_notes: string | null;
    };

export interface RecipeDraftActionInput {
  action_type_id: string;
  ingredient_refs: string[];
  duration: Exclude<VariantMeasureInput, { kind: "qualitative" }> | null;
  temperature: Exclude<VariantMeasureInput, { kind: "qualitative" }> | null;
}

export interface RecipeDraftInstructionInput {
  ref: string;
  text: string;
  actions: RecipeDraftActionInput[];
}

export interface RecipeDraftUpdateRequest {
  revision: number;
  title: string;
  description: string | null;
  servings: string | null;
  category_ids: string[];
  ingredients: RecipeDraftIngredientInput[];
  instructions: RecipeDraftInstructionInput[];
}

interface ApiErrorPayload {
  error?: { code?: unknown; message?: unknown; issues?: unknown };
}

const KNOWN_RECIPE_DRAFT_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "authentication_required",
  "idempotency_key_conflict",
  "invalid_csrf",
  "invalid_identifier",
  "invalid_recipe_draft",
  "rate_limit_exceeded",
  "recipe_draft_not_found",
  "recipe_draft_revision_conflict",
  "recipe_source_not_found",
  "validation_error",
]);

function knownRecipeDraftErrorCode(value: unknown): string {
  return typeof value === "string" && KNOWN_RECIPE_DRAFT_ERROR_CODES.has(value)
    ? value
    : "recipe_draft_api_error";
}

export class RecipeDraftApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiValidationIssue[];
  readonly outcome: ApiMutationOutcome | null;
  readonly authenticationRecovery: ApiAuthenticationRecovery;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    status: number,
    code = "recipe_draft_api_error",
    issues: ApiValidationIssue[] = [],
    outcome: ApiMutationOutcome | null = null,
    authenticationRecovery: ApiAuthenticationRecovery = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "RecipeDraftApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.outcome = outcome;
    this.authenticationRecovery = authenticationRecovery;
    this.retryAfterSeconds = retryAfterSeconds;
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

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function boundedText(
  value: unknown,
  max: number,
  allowBlank = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (allowBlank || value.trim().length > 0)
  );
}

function invalidResponse(): RecipeDraftApiError {
  return new RecipeDraftApiError(
    "Recipe Lab received an invalid private draft response.",
    502,
    "invalid_recipe_draft_response",
  );
}

function parseUnit(value: unknown): CatalogUnitSummary | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !boundedText(value.key, 64) ||
    !boundedText(value.canonical_label, 64) ||
    !boundedText(value.plural_label, 64) ||
    (value.symbol !== null && !boundedText(value.symbol, 16)) ||
    !["mass", "volume", "count", "time", "temperature", "package"].includes(
      String(value.dimension),
    ) ||
    !["symbol", "word", "hidden"].includes(String(value.display_style)) ||
    typeof value.active !== "boolean"
  ) {
    return null;
  }
  return value as unknown as CatalogUnitSummary;
}

function parseMeasure(value: unknown): RecipeIngredientMeasure | null {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return null;
  }
  if (
    value.kind === "qualitative" &&
    (value.value === "to_taste" ||
      value.value === "as_needed" ||
      value.value === "unspecified") &&
    value.unit === null &&
    value.display_unit === null &&
    typeof value.display === "string"
  ) {
    return value as unknown as RecipeIngredientMeasure;
  }
  const unit = parseUnit(value.unit);
  const commonValid =
    unit !== null &&
    (value.package_size_id === undefined ||
      value.package_size_id === null ||
      isUuid(value.package_size_id)) &&
    (value.display_unit === null || typeof value.display_unit === "string") &&
    typeof value.display === "string";
  if (value.kind === "exact" && boundedText(value.value, 64) && commonValid) {
    return { ...value, unit } as RecipeIngredientMeasure;
  }
  if (
    value.kind === "range" &&
    boundedText(value.minimum, 64) &&
    boundedText(value.maximum, 64) &&
    commonValid
  ) {
    return { ...value, unit } as RecipeIngredientMeasure;
  }
  return null;
}

function parseNumericMeasure(value: unknown): RecipeNumericMeasure | null {
  const measure = parseMeasure(value);
  return measure && measure.kind !== "qualitative" ? measure : null;
}

function parseCatalogIngredient(value: unknown): CatalogIngredient | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !boundedText(value.canonical_name, 200) ||
    !Array.isArray(value.aliases) ||
    !value.aliases.every((alias) => boundedText(alias, 200))
  ) {
    return null;
  }
  return value as unknown as CatalogIngredient;
}

function parseActionType(value: unknown): CatalogActionTypeSummary | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !boundedText(value.key, 64) ||
    !boundedText(value.canonical_verb, 64) ||
    typeof value.active !== "boolean"
  ) {
    return null;
  }
  return value as unknown as CatalogActionTypeSummary;
}

function parseIngredient(value: unknown): RecipeDraftIngredient | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !Number.isInteger(value.display_order) ||
    (value.display_order as number) < 0 ||
    !isRecord(value.selection)
  ) {
    return null;
  }
  const measure = parseMeasure(value.measure);
  if (
    !measure ||
    (value.preparation_notes !== null &&
      typeof value.preparation_notes !== "string")
  ) {
    return null;
  }
  let selection: RecipeDraftIngredient["selection"];
  if (value.selection.kind === "catalog") {
    const ingredient = parseCatalogIngredient(value.selection.ingredient);
    if (!ingredient || !boundedText(value.selection.display_name, 200)) {
      return null;
    }
    selection = {
      kind: "catalog",
      ingredient,
      display_name: value.selection.display_name,
    };
  } else if (
    value.selection.kind === "request" &&
    isRecord(value.selection.request)
  ) {
    const request = value.selection.request;
    const resolved =
      request.resolved_ingredient === null
        ? null
        : parseCatalogIngredient(request.resolved_ingredient);
    if (
      !isUuid(request.id) ||
      !boundedText(request.proposed_name, 200) ||
      !["pending", "approved", "rejected", "duplicate"].includes(
        String(request.status),
      ) ||
      (request.resolved_ingredient !== null && resolved === null)
    ) {
      return null;
    }
    selection = {
      kind: "request",
      request: {
        id: request.id,
        proposed_name: request.proposed_name,
        status:
          request.status as RecipeDraftRequestSelection["request"]["status"],
        resolved_ingredient: resolved,
      },
    };
  } else {
    return null;
  }
  return {
    id: value.id,
    display_order: value.display_order as number,
    selection,
    measure,
    preparation_notes: value.preparation_notes as string | null,
  };
}

function parseAction(value: unknown): RecipeDraftAction | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !Number.isInteger(value.display_order) ||
    (value.display_order as number) < 0 ||
    !Array.isArray(value.ingredient_occurrence_ids) ||
    !value.ingredient_occurrence_ids.every(isUuid)
  ) {
    return null;
  }
  const actionType = parseActionType(value.action_type);
  const duration =
    value.duration === null ? null : parseNumericMeasure(value.duration);
  const temperature =
    value.temperature === null ? null : parseNumericMeasure(value.temperature);
  if (
    !actionType ||
    (value.duration !== null && !duration) ||
    (value.temperature !== null && !temperature)
  ) {
    return null;
  }
  return {
    id: value.id,
    display_order: value.display_order as number,
    action_type: actionType,
    ingredient_occurrence_ids: value.ingredient_occurrence_ids as string[],
    duration,
    temperature,
  };
}

function parseInstruction(value: unknown): RecipeDraftInstruction | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !Number.isInteger(value.display_order) ||
    (value.display_order as number) < 0 ||
    !boundedText(value.text, 5_000) ||
    !Array.isArray(value.actions)
  ) {
    return null;
  }
  const actions = value.actions.map(parseAction);
  if (actions.some((action) => action === null)) {
    return null;
  }
  return {
    id: value.id,
    display_order: value.display_order as number,
    text: value.text,
    actions: actions as RecipeDraftAction[],
  };
}

function ordered<T extends { display_order: number }>(items: T[]): boolean {
  return items.every((item, index) => item.display_order === index);
}

export function parseRecipeDraftDetail(value: unknown): RecipeDraftDetail {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    (value.source_version_id !== null && !isUuid(value.source_version_id)) ||
    value.status !== "active" ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !boundedText(value.title, 200, true) ||
    (value.description !== null && !boundedText(value.description, 2_000)) ||
    (value.servings !== null && !boundedText(value.servings, 64)) ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.ingredients) ||
    !Array.isArray(value.instructions) ||
    !isTimestamp(value.created_at) ||
    !isTimestamp(value.updated_at)
  ) {
    throw invalidResponse();
  }
  const ingredients = value.ingredients.map(parseIngredient);
  const instructions = value.instructions.map(parseInstruction);
  const categories = parseRecipeCategories(
    value.categories,
    MAX_RECIPE_CATEGORIES,
  );
  if (
    !categories ||
    ingredients.some((item) => item === null) ||
    instructions.some((item) => item === null) ||
    !ordered(ingredients as RecipeDraftIngredient[]) ||
    !ordered(instructions as RecipeDraftInstruction[]) ||
    !(instructions as RecipeDraftInstruction[]).every((instruction) =>
      ordered(instruction.actions),
    )
  ) {
    throw invalidResponse();
  }
  const occurrenceIds = new Set(
    (ingredients as RecipeDraftIngredient[]).map((item) => item.id),
  );
  if (
    !(instructions as RecipeDraftInstruction[]).every((instruction) =>
      instruction.actions.every((action) =>
        action.ingredient_occurrence_ids.every((id) => occurrenceIds.has(id)),
      ),
    )
  ) {
    throw invalidResponse();
  }
  return {
    id: value.id,
    source_version_id: value.source_version_id as string | null,
    status: "active",
    revision: value.revision as number,
    title: value.title,
    description: value.description as string | null,
    servings: value.servings as string | null,
    categories,
    ingredients: ingredients as RecipeDraftIngredient[],
    instructions: instructions as RecipeDraftInstruction[],
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function parseListItem(value: unknown): RecipeDraftListItem | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    (value.source_version_id !== null && !isUuid(value.source_version_id)) ||
    value.status !== "active" ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !boundedText(value.title, 200, true) ||
    !Number.isInteger(value.ingredient_count) ||
    !Number.isInteger(value.instruction_count) ||
    (value.ingredient_count as number) < 0 ||
    (value.instruction_count as number) < 0 ||
    !isTimestamp(value.created_at) ||
    !isTimestamp(value.updated_at)
  ) {
    return null;
  }
  return value as unknown as RecipeDraftListItem;
}

export function parseRecipeDraftPage(value: unknown): RecipeDraftPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !Number.isInteger(value.page) ||
    !Number.isInteger(value.page_size) ||
    !Number.isInteger(value.total) ||
    !Number.isInteger(value.total_pages)
  ) {
    throw invalidResponse();
  }
  const items = value.items.map(parseListItem);
  if (
    items.some((item) => item === null) ||
    (value.page as number) < 1 ||
    (value.page_size as number) < 1 ||
    (value.page_size as number) > 100 ||
    (value.total as number) < 0 ||
    (value.total_pages as number) < 0
  ) {
    throw invalidResponse();
  }
  return {
    items: items as RecipeDraftListItem[],
    page: value.page as number,
    page_size: value.page_size as number,
    total: value.total as number,
    total_pages: value.total_pages as number,
  };
}

const SAFE_DRAFT_ISSUE_PARTS = new Set([
  "body",
  "revision",
  "title",
  "description",
  "servings",
  "categories",
  "category_ids",
  "ingredients",
  "selection",
  "ingredient_id",
  "ingredient_request_id",
  "preparation_notes",
  "measure",
  "mode",
  "kind",
  "value",
  "minimum",
  "maximum",
  "unit",
  "unit_id",
  "package_size_id",
  "instructions",
  "text",
  "actions",
  "action_type_id",
  "action_type",
  "ingredient_refs",
  "inputs",
  "duration",
  "temperature",
]);

function safeIssueLocation(value: unknown): Array<string | number> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8)
    return null;
  const safe = value.every(
    (part) =>
      (typeof part === "string" && SAFE_DRAFT_ISSUE_PARTS.has(part)) ||
      (typeof part === "number" &&
        Number.isInteger(part) &&
        part >= 0 &&
        part <= 200),
  );
  return safe ? (value as Array<string | number>) : null;
}

function safeIssueMessage(location: readonly (string | number)[]): string {
  const path = location[0] === "body" ? location.slice(1) : location;
  if (path[0] === "title") return "Review the recipe title.";
  if (path[0] === "description") return "Review the recipe description.";
  if (path[0] === "servings") return "Review the serving amount.";
  if (path[0] === "category_ids" || path[0] === "categories") {
    return "Review the recipe categories.";
  }
  if (path[0] === "ingredients") return "Review this ingredient.";
  if (path[0] === "instructions" && path.includes("actions")) {
    return "Review this cooking action.";
  }
  if (path[0] === "instructions") return "Review this instruction.";
  return "Review this field and try again.";
}

function parseIssues(value: unknown): ApiValidationIssue[] {
  if (!Array.isArray(value) || value.length > 200) return [];
  return value.flatMap((issue) => {
    if (!isRecord(issue)) return [];
    const location = safeIssueLocation(issue.location);
    if (!location) return [];
    return [
      {
        location,
        message: safeIssueMessage(location),
        type: "validation_error",
      },
    ];
  });
}

const RECIPE_DRAFT_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_draft_api_error",
  knownCodes: KNOWN_RECIPE_DRAFT_ERROR_CODES,
  parseIssues,
};

function draftCreationErrorMessage(
  status: number,
  code: string,
  retryAfterSeconds: number | null,
): string {
  if (status === 401 || code === "authentication_required") {
    return "Your session expired. Sign in again, then try again to recover the same private draft.";
  }
  if (code === "account_setup_required") {
    return "Finish setting up your account, then try again to recover the same private draft.";
  }
  if (status === 403 || code === "invalid_csrf") {
    return "Recipe Lab could not verify this draft request. Refresh the page and try again.";
  }
  if (status === 404 && code === "recipe_source_not_found") {
    return "The recipe you started from is no longer available. No draft was created.";
  }
  if (status === 409 && code === "idempotency_key_conflict") {
    return "Recipe Lab could not safely match this draft attempt. Try again to start a new private draft.";
  }
  if (status === 429 || code === "rate_limit_exceeded") {
    return retryAfterSeconds === null
      ? "Too many draft requests were made. Please wait, then try again."
      : `Too many draft requests were made. Try again in ${retryAfterSeconds} seconds.`;
  }
  return "Recipe Lab could not start this private draft. Try again to recover the same draft.";
}

function fromDraftCreationTransportError(
  error: ApiTransportError,
): RecipeDraftApiError {
  return new RecipeDraftApiError(
    draftCreationErrorMessage(
      error.status,
      error.code,
      error.retryAfterSeconds,
    ),
    error.status,
    error.code,
    error.issues,
    error.outcome ?? "unknown",
    error.authenticationRecovery,
    error.retryAfterSeconds,
  );
}

export function recipeDraftCreationRequestFingerprint(
  sourceVersionId: string | null,
): Promise<string> {
  const normalizedSourceVersionId = sourceVersionId?.toLowerCase() ?? null;
  return createRequestFingerprint({
    intent: normalizedSourceVersionId === null ? "blank" : "source",
    schema: "recipe-draft-creation",
    source_version_id: normalizedSourceVersionId,
    version: 1,
  });
}

function draftErrorMessage(status: number, code: string): string {
  if (status === 401) {
    return "Your session expired. Your private draft is still here; sign in again to continue.";
  }
  if (status === 403) {
    return "Recipe Lab could not verify this draft request. Refresh the page and try again.";
  }
  if (status === 404 && code === "recipe_source_not_found") {
    return "The recipe you started from is no longer available. No draft was created.";
  }
  if (status === 404) return "This private draft is no longer available.";
  if (status === 409 && code === "recipe_draft_revision_conflict") {
    return "This draft changed in another tab. Refresh it before trying again.";
  }
  if (status === 422) {
    return "Some draft fields need attention. Review them and try again.";
  }
  return "Recipe Lab could not complete this private draft request. Please try again.";
}

async function apiError(response: Response): Promise<RecipeDraftApiError> {
  let code = "recipe_draft_api_error";
  let issues: ApiValidationIssue[] = [];
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord((payload as ApiErrorPayload).error)) {
      const error = (payload as ApiErrorPayload).error!;
      code = knownRecipeDraftErrorCode(error.code);
      issues = parseIssues(error.issues);
    }
  } catch {
    // Keep the stable private-draft fallback.
  }
  return new RecipeDraftApiError(
    draftErrorMessage(response.status, code),
    response.status,
    code,
    issues,
  );
}

async function draftFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...init.headers },
  });
  if (!response.ok) {
    if (response.status === 401) notifySessionExpired();
    throw await apiError(response);
  }
  return response;
}

function mutationHeaders(idempotencyKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
    ...memberMutationHeaders(),
  };
}

export async function createRecipeDraft(
  sourceVersionId: string | null,
  idempotencyKey: string,
): Promise<RecipeDraftDetail> {
  if (!isUuid(idempotencyKey)) {
    throw new RecipeDraftApiError(
      "Recipe Lab could not safely prepare this private draft. Try again to recover the same draft.",
      0,
      "invalid_idempotency_key",
      [],
      "rejected",
    );
  }
  const normalizedSourceVersionId = sourceVersionId?.toLowerCase() ?? null;
  let requestFingerprint: string;
  try {
    requestFingerprint = await recipeDraftCreationRequestFingerprint(
      normalizedSourceVersionId,
    );
  } catch {
    throw new RecipeDraftApiError(
      "Recipe Lab could not safely prepare this private draft. Try again to recover the same draft.",
      0,
      "draft_creation_request_unavailable",
      [],
      "rejected",
    );
  }

  try {
    const response = await browserApiRequest("/api/recipe-drafts", {
      body: JSON.stringify({ source_version_id: normalizedSourceVersionId }),
      csrf: "member",
      errorContract: RECIPE_DRAFT_ERROR_CONTRACT,
      headers: { "Content-Type": "application/json" },
      identity: { idempotencyKey, requestFingerprint },
      kind: "mutation",
      method: "POST",
    });
    try {
      const draft = parseRecipeDraftDetail(response.data);
      if (draft.source_version_id !== normalizedSourceVersionId) {
        throw invalidResponse();
      }
      return draft;
    } catch (error) {
      if (error instanceof RecipeDraftApiError) {
        throw new RecipeDraftApiError(
          error.message,
          error.status,
          error.code,
          error.issues,
          "unknown",
        );
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof RecipeDraftApiError) throw error;
    if (error instanceof ApiTransportError) {
      throw fromDraftCreationTransportError(error);
    }
    throw new RecipeDraftApiError(
      "Recipe Lab could not start this private draft. Try again to recover the same draft.",
      0,
      "recipe_draft_api_error",
      [],
      "unknown",
    );
  }
}

export async function browseRecipeDrafts({
  page = 1,
  pageSize = 20,
  signal,
}: {
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
} = {}): Promise<RecipeDraftPage> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const response = await draftFetch(`/api/recipe-drafts?${query.toString()}`, {
    signal,
  });
  return parseRecipeDraftPage(await response.json());
}

export async function fetchRecipeDraft(
  draftId: string,
  signal?: AbortSignal,
): Promise<RecipeDraftDetail> {
  const response = await draftFetch(
    `/api/recipe-drafts/${encodeURIComponent(draftId)}`,
    {
      signal,
    },
  );
  return parseRecipeDraftDetail(await response.json());
}

export async function updateRecipeDraft(
  draftId: string,
  payload: RecipeDraftUpdateRequest,
  idempotencyKey: string,
): Promise<RecipeDraftDetail> {
  const response = await draftFetch(
    `/api/recipe-drafts/${encodeURIComponent(draftId)}`,
    {
      method: "PUT",
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify(payload),
    },
  );
  return parseRecipeDraftDetail(await response.json());
}

export async function discardRecipeDraft(
  draftId: string,
  revision: number,
  idempotencyKey: string,
): Promise<void> {
  const query = new URLSearchParams({ revision: String(revision) });
  await draftFetch(
    `/api/recipe-drafts/${encodeURIComponent(draftId)}?${query.toString()}`,
    { method: "DELETE", headers: mutationHeaders(idempotencyKey) },
  );
}
