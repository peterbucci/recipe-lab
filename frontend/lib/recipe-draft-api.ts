import {
  type ApiValidationIssue,
} from "./auth-api";
import type { operations } from "./api-contracts/generated";
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

type RecipeDraftPageWire =
  operations["my_private_recipe_drafts_api_recipe_drafts_get"]["responses"][200]["content"]["application/json"];
type RecipeDraftCreateOperation =
  operations["create_private_recipe_draft_api_recipe_drafts_post"];
type RecipeDraftCreateWireInput =
  RecipeDraftCreateOperation["requestBody"]["content"]["application/json"];
type RecipeDraftCreateWire =
  RecipeDraftCreateOperation["responses"][201]["content"]["application/json"];
type RecipeDraftDetailWire =
  operations["private_recipe_draft_detail_api_recipe_drafts__draft_id__get"]["responses"][200]["content"]["application/json"];
type RecipeDraftUpdateWire =
  operations["save_private_recipe_draft_api_recipe_drafts__draft_id__put"]["responses"][200]["content"]["application/json"];
type RecipeDraftUpdateWireInput =
  operations["save_private_recipe_draft_api_recipe_drafts__draft_id__put"]["requestBody"]["content"]["application/json"];
type RecipeDraftDeleteQuery =
  operations["delete_private_recipe_draft_api_recipe_drafts__draft_id__delete"]["parameters"]["query"];

export type RecipeDraftStatus = "active";
export type RecipeDifficulty = "easy" | "medium" | "hard";

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
  title: string | null;
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
  total_time_minutes: number | null;
  active_time_minutes: number | null;
  difficulty: RecipeDifficulty | null;
  notes: string | null;
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
  title: string | null;
  text: string;
  actions: RecipeDraftActionInput[];
}

export interface RecipeDraftUpdateRequest {
  revision: number;
  title: string;
  description: string | null;
  servings: string | null;
  total_time_minutes: number | null;
  active_time_minutes: number | null;
  difficulty: RecipeDifficulty | null;
  notes: string | null;
  category_ids: string[];
  ingredients: RecipeDraftIngredientInput[];
  instructions: RecipeDraftInstructionInput[];
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
    (value.title !== undefined &&
      value.title !== null &&
      !boundedText(value.title, 200)) ||
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
    title:
      value.title === undefined || value.title === null
        ? null
        : (value.title as string),
    text: value.text,
    actions: actions as RecipeDraftAction[],
  };
}

function ordered<T extends { display_order: number }>(items: T[]): boolean {
  return items.every((item, index) => item.display_order === index);
}

function optionalRecipeTime(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isInteger(value) &&
      (value as number) > 0 &&
      (value as number) <= 525_600)
  );
}

function optionalRecipeDifficulty(
  value: unknown,
): value is RecipeDifficulty | null {
  return (
    value === null ||
    value === "easy" ||
    value === "medium" ||
    value === "hard"
  );
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
    !optionalRecipeTime(value.total_time_minutes) ||
    !optionalRecipeTime(value.active_time_minutes) ||
    (typeof value.total_time_minutes === "number" &&
      typeof value.active_time_minutes === "number" &&
      value.active_time_minutes > value.total_time_minutes) ||
    !optionalRecipeDifficulty(value.difficulty) ||
    (value.notes !== null && !boundedText(value.notes, 5_000)) ||
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
    total_time_minutes: value.total_time_minutes as number | null,
    active_time_minutes: value.active_time_minutes as number | null,
    difficulty: value.difficulty as RecipeDifficulty | null,
    notes: value.notes as string | null,
    categories,
    ingredients: ingredients as RecipeDraftIngredient[],
    instructions: instructions as RecipeDraftInstruction[],
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

export function parseRecipeDraftListItem(
  value: unknown,
): RecipeDraftListItem | null {
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
  const items = value.items.map(parseRecipeDraftListItem);
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

function fromDraftTransportError(error: ApiTransportError): RecipeDraftApiError {
  if (error.reason === "invalid_response") return invalidResponse();
  return new RecipeDraftApiError(
    draftErrorMessage(error.status, error.code),
    error.status,
    error.code,
    error.issues,
    error.outcome,
    error.authenticationRecovery,
    error.retryAfterSeconds,
  );
}

function rethrowDraftTransportError(
  error: unknown,
  signal?: AbortSignal,
): never {
  if (error instanceof RecipeDraftApiError) throw error;
  if (error instanceof ApiTransportError) {
    if (signal?.aborted) {
      throw new DOMException("The request was aborted.", "AbortError");
    }
    throw fromDraftTransportError(error);
  }
  throw error;
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
    const input: RecipeDraftCreateWireInput = {
      source_version_id: normalizedSourceVersionId,
    };
    const response = await browserApiRequest("/api/recipe-drafts", {
      body: JSON.stringify(input),
      csrf: "member",
      errorContract: RECIPE_DRAFT_ERROR_CONTRACT,
      headers: { "Content-Type": "application/json" },
      identity: { idempotencyKey, requestFingerprint },
      kind: "mutation",
      method: "POST",
    });
    try {
      const draft = parseRecipeDraftDetail(response.data as RecipeDraftCreateWire);
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
  sourceVersionId,
  signal,
}: {
  page?: number;
  pageSize?: number;
  sourceVersionId?: string;
  signal?: AbortSignal;
} = {}): Promise<RecipeDraftPage> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (sourceVersionId !== undefined) {
    query.set("source_version_id", sourceVersionId.toLowerCase());
  }
  try {
    const response = await browserApiRequest(
      `/api/recipe-drafts?${query.toString()}`,
      {
        errorContract: RECIPE_DRAFT_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        signal,
      },
    );
    return parseRecipeDraftPage(response.data as RecipeDraftPageWire);
  } catch (error) {
    return rethrowDraftTransportError(error, signal);
  }
}

export async function findActiveRecipeDraftForSource(
  sourceVersionId: string,
  signal?: AbortSignal,
): Promise<RecipeDraftListItem | null> {
  if (!isUuid(sourceVersionId)) {
    throw new RecipeDraftApiError(
      "Recipe Lab could not identify the recipe you want to continue.",
      0,
      "invalid_identifier",
    );
  }
  const normalizedSourceVersionId = sourceVersionId.toLowerCase();
  const page = await browseRecipeDrafts({
    pageSize: 1,
    sourceVersionId: normalizedSourceVersionId,
    signal,
  });
  const draft = page.items[0] ?? null;
  if (
    draft !== null &&
    draft.source_version_id?.toLowerCase() !== normalizedSourceVersionId
  ) {
    throw invalidResponse();
  }
  return draft;
}

export async function fetchRecipeDraft(
  draftId: string,
  signal?: AbortSignal,
): Promise<RecipeDraftDetail> {
  try {
    const response = await browserApiRequest(
      `/api/recipe-drafts/${encodeURIComponent(draftId)}`,
      {
        errorContract: RECIPE_DRAFT_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        signal,
      },
    );
    return parseRecipeDraftDetail(response.data as RecipeDraftDetailWire);
  } catch (error) {
    return rethrowDraftTransportError(error, signal);
  }
}

export async function updateRecipeDraft(
  draftId: string,
  payload: RecipeDraftUpdateRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<RecipeDraftDetail> {
  try {
    const wireInput: RecipeDraftUpdateWireInput = payload;
    const requestFingerprint = await createRequestFingerprint({
      draft_id: draftId.toLowerCase(),
      payload_json: JSON.stringify(wireInput),
      schema: "recipe-draft-update",
      version: 1,
    });
    const response = await browserApiRequest(
      `/api/recipe-drafts/${encodeURIComponent(draftId)}`,
      {
        body: JSON.stringify(wireInput),
        csrf: "member",
        errorContract: RECIPE_DRAFT_ERROR_CONTRACT,
        headers: { "Content-Type": "application/json" },
        identity: { idempotencyKey, requestFingerprint },
        kind: "mutation",
        method: "PUT",
        signal,
      },
    );
    return parseRecipeDraftDetail(response.data as RecipeDraftUpdateWire);
  } catch (error) {
    return rethrowDraftTransportError(error, signal);
  }
}

export async function discardRecipeDraft(
  draftId: string,
  revision: number,
  idempotencyKey: string,
): Promise<void> {
  const wireQuery: RecipeDraftDeleteQuery = { revision };
  const query = new URLSearchParams({ revision: String(wireQuery.revision) });
  try {
    const requestFingerprint = await createRequestFingerprint({
      draft_id: draftId.toLowerCase(),
      revision,
      schema: "recipe-draft-discard",
      version: 1,
    });
    await browserApiRequest(
      `/api/recipe-drafts/${encodeURIComponent(draftId)}?${query.toString()}`,
      {
        csrf: "member",
        errorContract: RECIPE_DRAFT_ERROR_CONTRACT,
        identity: { idempotencyKey, requestFingerprint },
        kind: "mutation",
        method: "DELETE",
        responseBody: "empty",
      },
    );
  } catch (error) {
    return rethrowDraftTransportError(error);
  }
}
