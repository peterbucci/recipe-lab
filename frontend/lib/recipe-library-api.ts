import { notifySessionExpired } from "./auth-api";
import type { RecipeDraftListItem } from "./recipe-draft-api";
import type {
  ActivePublicUserReference,
  PublicUserReference,
  RecipeSummary,
  RecipeVersionReference,
} from "./recipe-api";

export type RecipeVisibilityState =
  "published" | "author_withdrawn" | "moderation_hidden";

export interface PublicCookProfilePage {
  cook: ActivePublicUserReference;
  items: RecipeSummary[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export type MyRecipeLibraryItem =
  | { kind: "draft"; draft: RecipeDraftListItem }
  | {
      kind: "published";
      recipe: RecipeSummary;
      visibility_state: RecipeVisibilityState;
    };

export interface MyRecipeLibraryPage {
  items: MyRecipeLibraryItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface SavedRecipeLibraryItem {
  recipe: RecipeSummary;
  saved_at: string;
}

export interface SavedRecipeLibraryPage {
  items: SavedRecipeLibraryItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

interface ApiErrorPayload {
  error?: { code?: unknown; message?: unknown };
}

const KNOWN_RECIPE_LIBRARY_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "authentication_required",
  "cook_not_found",
  "invalid_identifier",
  "rate_limit_exceeded",
  "recipe_library_unavailable",
  "validation_error",
]);

function knownRecipeLibraryErrorCode(value: unknown): string {
  return typeof value === "string" &&
    KNOWN_RECIPE_LIBRARY_ERROR_CODES.has(value)
    ? value
    : "recipe_library_api_error";
}

export class RecipeLibraryApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code = "recipe_library_api_error",
  ) {
    super(message);
    this.name = "RecipeLibraryApiError";
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

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function boundedText(
  value: unknown,
  maximum: number,
  allowBlank = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (allowBlank || value.trim().length > 0)
  );
}

function invalidResponse(): RecipeLibraryApiError {
  return new RecipeLibraryApiError(
    "Recipe Lab could not load this recipe library. Please try again.",
    502,
    "invalid_recipe_library_response",
  );
}

const DEMO_COOK_ID = "1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9";
const DEMO_COOK_DISPLAY_NAME = "Demo Cook";

export function parsePublicUserReference(
  value: unknown,
): PublicUserReference | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !boundedText(value.display_name, 120)
  ) {
    return null;
  }
  if (
    value.handle !== null &&
    (!boundedText(value.handle, 30) ||
      !/^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/.test(value.handle))
  ) {
    return null;
  }
  if (value.handle === null) {
    const isDeletedCook = value.display_name === "Deleted cook";
    const isDemoCook =
      value.id === DEMO_COOK_ID &&
      value.display_name === DEMO_COOK_DISPLAY_NAME;
    if (!isDeletedCook && !isDemoCook) return null;
  }
  return {
    id: value.id,
    handle: value.handle as string | null,
    display_name: value.display_name,
  };
}

function parseVersionReference(value: unknown): RecipeVersionReference | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !Number.isInteger(value.version_number) ||
    (value.version_number as number) < 1 ||
    !boundedText(value.title, 200)
  ) {
    return null;
  }
  const author = parsePublicUserReference(value.author);
  if (!author) return null;
  return {
    id: value.id,
    version_number: value.version_number as number,
    title: value.title,
    author,
  };
}

export function parseRecipeSummary(value: unknown): RecipeSummary | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.lineage_id) ||
    (value.parent_version_id !== null && !isUuid(value.parent_version_id)) ||
    !Number.isInteger(value.version_number) ||
    (value.version_number as number) < 1 ||
    !boundedText(value.title, 200) ||
    (value.description !== null && !boundedText(value.description, 2_000)) ||
    !boundedText(value.servings, 64) ||
    !isTimestamp(value.created_at)
  ) {
    return null;
  }
  const author = parsePublicUserReference(value.author);
  const parent =
    value.parent === null ? null : parseVersionReference(value.parent);
  if (
    !author ||
    (value.parent !== null && !parent) ||
    (value.parent_version_id === null && parent !== null) ||
    (parent && parent.id !== value.parent_version_id)
  ) {
    return null;
  }
  return {
    id: value.id,
    lineage_id: value.lineage_id,
    parent_version_id: value.parent_version_id as string | null,
    version_number: value.version_number as number,
    title: value.title,
    description: value.description as string | null,
    servings: value.servings,
    created_at: value.created_at,
    author,
    parent,
  };
}

function parseDraft(value: unknown): RecipeDraftListItem | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    (value.source_version_id !== null && !isUuid(value.source_version_id)) ||
    value.status !== "active" ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !boundedText(value.title, 200, true) ||
    !Number.isInteger(value.ingredient_count) ||
    (value.ingredient_count as number) < 0 ||
    !Number.isInteger(value.instruction_count) ||
    (value.instruction_count as number) < 0 ||
    !isTimestamp(value.created_at) ||
    !isTimestamp(value.updated_at)
  ) {
    return null;
  }
  return {
    id: value.id,
    source_version_id: value.source_version_id as string | null,
    status: "active",
    revision: value.revision as number,
    title: value.title,
    ingredient_count: value.ingredient_count as number,
    instruction_count: value.instruction_count as number,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function parsePageEnvelope(value: unknown): {
  items: unknown[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
} {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !Number.isInteger(value.page) ||
    (value.page as number) < 1 ||
    !Number.isInteger(value.page_size) ||
    (value.page_size as number) < 1 ||
    (value.page_size as number) > 100 ||
    !Number.isInteger(value.total) ||
    (value.total as number) < 0 ||
    !Number.isInteger(value.total_pages) ||
    (value.total_pages as number) < 0
  ) {
    throw invalidResponse();
  }
  return value as unknown as {
    items: unknown[];
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

export function parsePublicCookProfilePage(
  value: unknown,
): PublicCookProfilePage {
  const envelope = parsePageEnvelope(value);
  if (!isRecord(value)) throw invalidResponse();
  const cook = parsePublicUserReference(value.cook);
  const items = envelope.items.map(parseRecipeSummary);
  if (!cook || cook.handle === null || items.some((item) => item === null)) {
    throw invalidResponse();
  }
  const activeCook: ActivePublicUserReference = {
    ...cook,
    handle: cook.handle,
  };
  return { ...envelope, cook: activeCook, items: items as RecipeSummary[] };
}

export function parseMyRecipeLibraryPage(value: unknown): MyRecipeLibraryPage {
  const envelope = parsePageEnvelope(value);
  const items = envelope.items.map((item): MyRecipeLibraryItem | null => {
    if (!isRecord(item)) return null;
    if (item.kind === "draft") {
      const draft = parseDraft(item.draft);
      return draft ? { kind: "draft", draft } : null;
    }
    if (item.kind === "published") {
      const recipe = parseRecipeSummary(item.recipe);
      const visibilityState = item.visibility_state;
      return recipe &&
        (visibilityState === "published" ||
          visibilityState === "author_withdrawn" ||
          visibilityState === "moderation_hidden")
        ? { kind: "published", recipe, visibility_state: visibilityState }
        : null;
    }
    return null;
  });
  if (items.some((item) => item === null)) throw invalidResponse();
  return { ...envelope, items: items as MyRecipeLibraryItem[] };
}

export function parseSavedRecipeLibraryPage(
  value: unknown,
): SavedRecipeLibraryPage {
  const envelope = parsePageEnvelope(value);
  const items = envelope.items.map((item): SavedRecipeLibraryItem | null => {
    if (!isRecord(item) || !isTimestamp(item.saved_at)) return null;
    const recipe = parseRecipeSummary(item.recipe);
    return recipe ? { recipe, saved_at: item.saved_at } : null;
  });
  if (items.some((item) => item === null)) throw invalidResponse();
  return { ...envelope, items: items as SavedRecipeLibraryItem[] };
}

async function apiError(response: Response): Promise<RecipeLibraryApiError> {
  let code = "recipe_library_api_error";
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord((payload as ApiErrorPayload).error)) {
      const error = (payload as ApiErrorPayload).error!;
      code = knownRecipeLibraryErrorCode(error.code);
    }
  } catch {
    // Keep the stable fallback instead of exposing an upstream response body.
  }
  const message =
    response.status === 401
      ? "Your session expired. Sign in again to load your recipes."
      : response.status === 403
        ? "This recipe library is not available to your account."
        : response.status === 404
          ? "This recipe library could not be found."
          : response.status === 429
            ? "Recipe Lab is receiving too many requests. Please wait before refreshing your recipes."
            : "Recipe Lab could not load this recipe library. Please try again.";
  return new RecipeLibraryApiError(message, response.status, code);
}

function apiBaseUrl(): string {
  const configured =
    process.env.RECIPE_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8000";
  return configured.trim().replace(/\/+$/, "");
}

export async function fetchPublicCookProfile({
  handle,
  page = 1,
  pageSize = 12,
}: {
  handle: string;
  page?: number;
  pageSize?: number;
}): Promise<PublicCookProfilePage | null> {
  const url = new URL(
    `/api/cooks/${encodeURIComponent(handle)}`,
    `${apiBaseUrl()}/`,
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await apiError(response);
  return parsePublicCookProfilePage(await response.json());
}

async function memberFetch(
  path: string,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    if (response.status === 401) notifySessionExpired();
    throw await apiError(response);
  }
  return response;
}

function pageQuery(page: number, pageSize: number): string {
  return new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  }).toString();
}

export async function fetchMyRecipeLibrary({
  page = 1,
  pageSize = 12,
  signal,
}: {
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
} = {}): Promise<MyRecipeLibraryPage> {
  const response = await memberFetch(
    `/api/my/recipes?${pageQuery(page, pageSize)}`,
    signal,
  );
  return parseMyRecipeLibraryPage(await response.json());
}

export async function fetchSavedRecipeLibrary({
  page = 1,
  pageSize = 12,
  signal,
}: {
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
} = {}): Promise<SavedRecipeLibraryPage> {
  const response = await memberFetch(
    `/api/my/saved-recipes?${pageQuery(page, pageSize)}`,
    signal,
  );
  return parseSavedRecipeLibraryPage(await response.json());
}
