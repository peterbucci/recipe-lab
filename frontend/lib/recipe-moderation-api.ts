import { memberMutationHeaders, notifySessionExpired } from "./auth-api";
import type { PublicUserReference } from "./recipe-api";
import type { RecipeReportReason } from "./recipe-report-api";

export const MODERATION_PRIVATE_NOTE_MAX_LENGTH = 1_000;

export type RecipeModerationStatus = "open" | "resolved";
export type RecipeModerationAction = "hide" | "restore" | "resolve";
export type RecipeModerationVisibility =
  | "published"
  | "author_withdrawn"
  | "moderation_hidden";

export interface RecipeModerationCaseSummary {
  recipe_version_id: string;
  title: string;
  author: PublicUserReference;
  status: RecipeModerationStatus;
  visibility_state: RecipeModerationVisibility;
  reporter_count: number;
  opened_at: string;
  last_reported_at: string;
  resolved_at: string | null;
}

export interface RecipeModerationCasePage {
  items: RecipeModerationCaseSummary[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface RecipeReportReasonCount {
  reason: RecipeReportReason;
  count: number;
}

export interface DeidentifiedRecipeReport {
  id: string;
  reason: RecipeReportReason;
  details: string | null;
  submitted_at: string;
}

export interface RecipeModerationAuditEntry {
  id: number;
  action: RecipeModerationAction;
  previous_status: RecipeModerationStatus;
  status: RecipeModerationStatus;
  visibility_state: RecipeModerationVisibility;
  private_note: string | null;
  occurred_at: string;
  actor: PublicUserReference;
}

export interface RecipeModerationCaseDetail extends RecipeModerationCaseSummary {
  reason_counts: RecipeReportReasonCount[];
  reports: DeidentifiedRecipeReport[];
  reports_total: number;
  reports_truncated: boolean;
  history: RecipeModerationAuditEntry[];
  history_total: number;
  history_truncated: boolean;
}

export interface RecipeModerationActionResult {
  recipe_version_id: string;
  action: RecipeModerationAction;
  changed: boolean;
  case_status: RecipeModerationStatus;
  visibility_state: RecipeModerationVisibility;
  acted_at: string;
}

export class RecipeModerationApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "recipe_moderation_api_error") {
    super(message);
    this.name = "RecipeModerationApiError";
    this.status = status;
    this.code = code;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = new Set<RecipeReportReason>([
  "spam",
  "harassment",
  "dangerous_content",
  "intellectual_property",
  "other",
]);
const ACTIONS = new Set<RecipeModerationAction>(["hide", "restore", "resolve"]);
const STATUSES = new Set<RecipeModerationStatus>(["open", "resolved"]);
const VISIBILITIES = new Set<RecipeModerationVisibility>([
  "published",
  "author_withdrawn",
  "moderation_hidden",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100 && !Number.isNaN(Date.parse(value));
}

function isOptionalPrivateText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length >= 1 && value.length <= 1_000);
}

function isReason(value: unknown): value is RecipeReportReason {
  return typeof value === "string" && REASONS.has(value as RecipeReportReason);
}

function isAction(value: unknown): value is RecipeModerationAction {
  return typeof value === "string" && ACTIONS.has(value as RecipeModerationAction);
}

function isStatus(value: unknown): value is RecipeModerationStatus {
  return typeof value === "string" && STATUSES.has(value as RecipeModerationStatus);
}

function isVisibility(value: unknown): value is RecipeModerationVisibility {
  return typeof value === "string" && VISIBILITIES.has(value as RecipeModerationVisibility);
}

function parseAuthor(value: unknown): PublicUserReference | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "handle", "display_name"]) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    (value.handle !== null && typeof value.handle !== "string") ||
    typeof value.display_name !== "string" ||
    value.display_name.length < 1 ||
    value.display_name.length > 120
  ) {
    return null;
  }
  return { id: value.id, handle: value.handle, display_name: value.display_name };
}

const SUMMARY_KEYS = [
  "recipe_version_id",
  "title",
  "author",
  "status",
  "visibility_state",
  "reporter_count",
  "opened_at",
  "last_reported_at",
  "resolved_at",
] as const;

function parseSummary(value: unknown, exact = true): RecipeModerationCaseSummary | null {
  if (!isRecord(value) || (exact && !hasExactKeys(value, SUMMARY_KEYS))) return null;
  const author = parseAuthor(value.author);
  if (
    typeof value.recipe_version_id !== "string" ||
    !UUID_PATTERN.test(value.recipe_version_id) ||
    typeof value.title !== "string" ||
    value.title.length < 1 ||
    value.title.length > 200 ||
    !author ||
    !isStatus(value.status) ||
    !isVisibility(value.visibility_state) ||
    !Number.isSafeInteger(value.reporter_count) ||
    (value.reporter_count as number) < 1 ||
    !isTimestamp(value.opened_at) ||
    !isTimestamp(value.last_reported_at) ||
    (value.resolved_at !== null && !isTimestamp(value.resolved_at))
  ) {
    return null;
  }
  return {
    recipe_version_id: value.recipe_version_id,
    title: value.title,
    author,
    status: value.status,
    visibility_state: value.visibility_state,
    reporter_count: value.reporter_count as number,
    opened_at: value.opened_at,
    last_reported_at: value.last_reported_at,
    resolved_at: value.resolved_at,
  };
}

function invalidResponse(): RecipeModerationApiError {
  return new RecipeModerationApiError(
    "Recipe Lab received an invalid moderation response.",
    502,
    "invalid_recipe_moderation_response",
  );
}

export function parseRecipeModerationCasePage(value: unknown): RecipeModerationCasePage {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["items", "page", "page_size", "total", "total_pages"]) ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !Number.isSafeInteger(value.page) ||
    (value.page as number) < 1 ||
    !Number.isSafeInteger(value.page_size) ||
    (value.page_size as number) < 1 ||
    (value.page_size as number) > 100 ||
    !Number.isSafeInteger(value.total) ||
    (value.total as number) < 0 ||
    !Number.isSafeInteger(value.total_pages) ||
    (value.total_pages as number) < 0
  ) {
    throw invalidResponse();
  }
  const items = value.items.map((item) => parseSummary(item));
  if (items.some((item) => item === null)) throw invalidResponse();
  return {
    items: items as RecipeModerationCaseSummary[],
    page: value.page as number,
    page_size: value.page_size as number,
    total: value.total as number,
    total_pages: value.total_pages as number,
  };
}

export function parseRecipeModerationCaseDetail(
  value: unknown,
  expectedRecipeVersionId?: string,
): RecipeModerationCaseDetail {
  const keys = [
    ...SUMMARY_KEYS,
    "reason_counts",
    "reports",
    "reports_total",
    "reports_truncated",
    "history",
    "history_total",
    "history_truncated",
  ];
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    !Array.isArray(value.reason_counts) ||
    value.reason_counts.length > 5 ||
    !Array.isArray(value.reports) ||
    value.reports.length > 100 ||
    !Array.isArray(value.history) ||
    value.history.length > 100
  ) {
    throw invalidResponse();
  }
  const summary = parseSummary(value, false);
  if (!summary || (expectedRecipeVersionId && summary.recipe_version_id !== expectedRecipeVersionId)) {
    throw invalidResponse();
  }
  const reasonCounts = value.reason_counts.flatMap((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["reason", "count"]) ||
      !isReason(item.reason) ||
      !Number.isSafeInteger(item.count) ||
      (item.count as number) < 1
    ) return [];
    return [{ reason: item.reason, count: item.count as number }];
  });
  const reports = value.reports.flatMap((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["id", "reason", "details", "submitted_at"]) ||
      typeof item.id !== "string" ||
      !UUID_PATTERN.test(item.id) ||
      !isReason(item.reason) ||
      !isOptionalPrivateText(item.details) ||
      !isTimestamp(item.submitted_at)
    ) return [];
    return [{ id: item.id, reason: item.reason, details: item.details, submitted_at: item.submitted_at }];
  });
  const history = value.history.flatMap((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        "id",
        "action",
        "previous_status",
        "status",
        "visibility_state",
        "private_note",
        "occurred_at",
        "actor",
      ]) ||
      !Number.isSafeInteger(item.id) ||
      (item.id as number) < 1 ||
      !isAction(item.action) ||
      !isStatus(item.previous_status) ||
      !isStatus(item.status) ||
      !isVisibility(item.visibility_state) ||
      !isOptionalPrivateText(item.private_note) ||
      !isTimestamp(item.occurred_at)
    ) return [];
    const actor = parseAuthor(item.actor);
    if (!actor) return [];
    return [{
      id: item.id as number,
      action: item.action,
      previous_status: item.previous_status,
      status: item.status,
      visibility_state: item.visibility_state,
      private_note: item.private_note,
      occurred_at: item.occurred_at,
      actor,
    }];
  });
  if (
    reasonCounts.length !== value.reason_counts.length ||
    reports.length !== value.reports.length ||
    history.length !== value.history.length ||
    !Number.isSafeInteger(value.reports_total) ||
    (value.reports_total as number) < reports.length ||
    typeof value.reports_truncated !== "boolean" ||
    value.reports_truncated !== ((value.reports_total as number) > reports.length) ||
    !Number.isSafeInteger(value.history_total) ||
    (value.history_total as number) < history.length ||
    typeof value.history_truncated !== "boolean" ||
    value.history_truncated !== ((value.history_total as number) > history.length)
  ) {
    throw invalidResponse();
  }
  return {
    ...summary,
    reason_counts: reasonCounts,
    reports,
    reports_total: value.reports_total as number,
    reports_truncated: value.reports_truncated,
    history,
    history_total: value.history_total as number,
    history_truncated: value.history_truncated,
  };
}

export function parseRecipeModerationActionResult(
  value: unknown,
  expectedRecipeVersionId: string,
): RecipeModerationActionResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "recipe_version_id",
      "action",
      "changed",
      "case_status",
      "visibility_state",
      "acted_at",
    ]) ||
    value.recipe_version_id !== expectedRecipeVersionId ||
    !isAction(value.action) ||
    typeof value.changed !== "boolean" ||
    !isStatus(value.case_status) ||
    !isVisibility(value.visibility_state) ||
    !isTimestamp(value.acted_at)
  ) {
    throw invalidResponse();
  }
  return {
    recipe_version_id: value.recipe_version_id,
    action: value.action,
    changed: value.changed,
    case_status: value.case_status,
    visibility_state: value.visibility_state,
    acted_at: value.acted_at,
  };
}

async function moderationError(response: Response): Promise<RecipeModerationApiError> {
  let message = "Recipe Lab could not complete this moderation request.";
  let code = "recipe_moderation_api_error";
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord(payload.error)) {
      if (typeof payload.error.message === "string" && payload.error.message.length <= 500) {
        message = payload.error.message;
      }
      if (typeof payload.error.code === "string" && payload.error.code.length <= 100) {
        code = payload.error.code;
      }
    }
  } catch {
    // Keep the stable fallback rather than exposing an upstream response body.
  }
  if (response.status === 401) {
    message = "Your session expired. Sign in again to continue.";
  } else if (response.status === 413) {
    message = "That moderation note is too large. Shorten it and try again.";
  } else if (response.status === 429) {
    message = "Too many moderation changes were submitted. Please wait and try again.";
  }
  return new RecipeModerationApiError(message, response.status, code);
}

async function moderationFetch(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...init.headers },
  });
  if (!response.ok) {
    if (response.status === 401) notifySessionExpired();
    throw await moderationError(response);
  }
  return response;
}

export async function browseRecipeModerationCases(options: {
  status: RecipeModerationStatus;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<RecipeModerationCasePage> {
  const query = new URLSearchParams({
    status: options.status,
    page: String(options.page ?? 1),
    page_size: String(options.pageSize ?? 20),
  });
  const response = await moderationFetch(`/api/moderation/recipe-reports?${query}`, {
    method: "GET",
    signal: options.signal,
  });
  try {
    return parseRecipeModerationCasePage(await response.json());
  } catch (error) {
    if (error instanceof RecipeModerationApiError) throw error;
    throw invalidResponse();
  }
}

export async function fetchRecipeModerationCase(
  recipeVersionId: string,
  signal?: AbortSignal,
): Promise<RecipeModerationCaseDetail> {
  const response = await moderationFetch(
    `/api/moderation/recipe-reports/${encodeURIComponent(recipeVersionId)}`,
    { method: "GET", signal },
  );
  try {
    return parseRecipeModerationCaseDetail(await response.json(), recipeVersionId);
  } catch (error) {
    if (error instanceof RecipeModerationApiError) throw error;
    throw invalidResponse();
  }
}

export async function moderateRecipeCase(
  recipeVersionId: string,
  action: RecipeModerationAction,
  privateNote: string | null,
  idempotencyKey: string,
): Promise<RecipeModerationActionResult> {
  const response = await moderationFetch(
    `/api/moderation/recipe-reports/${encodeURIComponent(recipeVersionId)}/actions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...memberMutationHeaders(),
      },
      body: JSON.stringify({ action, private_note: privateNote }),
    },
  );
  try {
    return parseRecipeModerationActionResult(await response.json(), recipeVersionId);
  } catch (error) {
    if (error instanceof RecipeModerationApiError) throw error;
    throw invalidResponse();
  }
}
