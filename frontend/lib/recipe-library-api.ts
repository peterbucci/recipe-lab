import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "./api-transport/core";
import { serverApiRequest } from "./api-transport/server";
import type { operations } from "./api-contracts/generated";
import type { RecipeDraftListItem } from "./recipe-draft-api";
import type {
  ActivePublicUserReference,
  PublicUserReference,
  RecipeCardSummary,
  RecipeSummary,
  RecipeVersionReference,
} from "./recipe-api";
import {
  MAX_RECIPE_CATEGORIES,
  parseRecipeCategories,
} from "./recipe-category";

type MyRecipeLibraryOperation =
  operations["my_recipe_library_api_my_recipes_get"];
type MyRecipeLibraryContractPage =
  MyRecipeLibraryOperation["responses"][200]["content"]["application/json"];
type MyPublishedRecipeItem = Extract<
  MyRecipeLibraryContractPage["items"][number],
  { readonly kind: "published" }
>;
type PublicCookProfileWire =
  operations["public_cook_profile_api_cooks__handle__get"]["responses"][200]["content"]["application/json"];
type SavedRecipeLibraryWire =
  operations["my_saved_recipe_library_api_my_saved_recipes_get"]["responses"][200]["content"]["application/json"];

export type RecipeVisibilityState = MyPublishedRecipeItem["visibility_state"];
export type MyRecipeLibraryView =
  MyRecipeLibraryOperation["parameters"]["query"]["view"];

export interface PublicCookProfilePage {
  cook: ActivePublicUserReference;
  follower_count: number;
  description: string | null;
  items: RecipeCardSummary[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export type MyRecipeLibraryItem = MyRecipeLibraryContractPage["items"][number];
export type MyRecipeLibraryPage = MyRecipeLibraryContractPage;

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

const RECIPE_LIBRARY_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_library_api_error",
  knownCodes: KNOWN_RECIPE_LIBRARY_ERROR_CODES,
};

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
    !isTimestamp(value.created_at) ||
    !isTimestamp(value.published_at)
  ) {
    return null;
  }
  const author = parsePublicUserReference(value.author);
  const parent =
    value.parent === null ? null : parseVersionReference(value.parent);
  const categories = parseRecipeCategories(
    value.categories,
    MAX_RECIPE_CATEGORIES,
  );
  if (
    !author ||
    !categories ||
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
    published_at: value.published_at,
    author,
    parent,
    categories,
  };
}

function parseRecipeCardSummary(value: unknown): RecipeCardSummary | null {
  const recipe = parseRecipeSummary(value);
  if (
    recipe === null ||
    !isRecord(value) ||
    (value.average_rating !== null &&
      (typeof value.average_rating !== "number" ||
        !Number.isFinite(value.average_rating) ||
        value.average_rating < 1 ||
        value.average_rating > 5)) ||
    !Number.isInteger(value.rating_count) ||
    (value.rating_count as number) < 0 ||
    !Number.isInteger(value.save_count) ||
    (value.save_count as number) < 0
  ) {
    return null;
  }
  return {
    ...recipe,
    average_rating: value.average_rating as number | null,
    rating_count: value.rating_count as number,
    save_count: value.save_count as number,
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
  const items = envelope.items.map(parseRecipeCardSummary);
  if (!cook || cook.handle === null || items.some((item) => item === null)) {
    throw invalidResponse();
  }
  if (
    !Number.isInteger(value.follower_count) ||
    (value.follower_count as number) < 0
  ) {
    throw invalidResponse();
  }
  const description = value.description ?? null;
  if (description !== null && !boundedText(description, 500)) {
    throw invalidResponse();
  }
  const activeCook: ActivePublicUserReference = {
    ...cook,
    handle: cook.handle,
  };
  return {
    ...envelope,
    cook: activeCook,
    follower_count: value.follower_count as number,
    description: description as string | null,
    items: items as RecipeCardSummary[],
  };
}

export function parseMyRecipeLibraryPage(value: unknown): MyRecipeLibraryPage {
  const envelope = parsePageEnvelope(value);
  const items = envelope.items.map((item): MyRecipeLibraryItem | null => {
    if (!isRecord(item)) return null;
    if (item.kind === "draft") {
      const draft = parseDraft(item.draft);
      const sourceRecipeTitle = item.source_recipe_title;
      const description = item.description;
      if (
        sourceRecipeTitle !== undefined &&
        sourceRecipeTitle !== null &&
        !boundedText(sourceRecipeTitle, 200)
      ) {
        return null;
      }
      if (
        description !== undefined &&
        description !== null &&
        !boundedText(description, 2_000)
      ) {
        return null;
      }
      return draft
        ? {
            kind: "draft",
            draft,
            source_recipe_title: sourceRecipeTitle ?? null,
            description: description ?? null,
          }
        : null;
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

export async function fetchPublicCookProfile({
  handle,
  page = 1,
  pageSize = 12,
}: {
  handle: string;
  page?: number;
  pageSize?: number;
}): Promise<PublicCookProfilePage | null> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  try {
    const response = await serverApiRequest(
      `/api/cooks/${encodeURIComponent(handle)}?${query.toString()}`,
      { errorContract: RECIPE_LIBRARY_ERROR_CONTRACT, kind: "query", retry: "never" },
    );
    const payload = response.data as PublicCookProfileWire;
    return parsePublicCookProfilePage(payload);
  } catch (error) {
    if (error instanceof ApiTransportError) {
      if (error.status === 404) return null;
      throw fromTransportError(error);
    }
    throw error;
  }
}

function pageQuery(page: number, pageSize: number): string {
  return new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  }).toString();
}

export async function fetchMyRecipeLibrary({
  view,
  page = 1,
  pageSize = 12,
  signal,
}: {
  view: MyRecipeLibraryView;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<MyRecipeLibraryPage> {
  const query = new URLSearchParams({
    view,
    page: String(page),
    page_size: String(pageSize),
  });
  try {
    const response = await browserApiRequest(
      `/api/my/recipes?${query.toString()}`,
      {
        errorContract: RECIPE_LIBRARY_ERROR_CONTRACT,
        kind: "query",
        signal,
      },
    );
    const result = parseMyRecipeLibraryPage(response.data);
    const matchesView = result.items.every((item) => {
      if (view === "drafts") return item.kind === "draft";
      if (item.kind !== "published") return false;
      return view === "withdrawn"
        ? item.visibility_state === "author_withdrawn"
        : item.visibility_state === "published" || item.visibility_state === "moderation_hidden";
    });
    if (!matchesView) throw invalidResponse();
    return result;
  } catch (error) {
    if (error instanceof RecipeLibraryApiError) throw error;
    if (error instanceof ApiTransportError) {
      if (error.reason === "aborted") {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      throw fromTransportError(error);
    }
    throw new RecipeLibraryApiError(
      "Recipe Lab could not load this recipe library. Please try again.",
      0,
    );
  }
}

function recipeLibraryErrorMessage(status: number): string {
  return status === 401
    ? "Your session expired. Sign in again to load your recipes."
    : status === 403
      ? "This recipe library is not available to your account."
      : status === 404
        ? "This recipe library could not be found."
        : status === 429
          ? "Recipe Lab is receiving too many requests. Please wait before refreshing your recipes."
          : "Recipe Lab could not load this recipe library. Please try again.";
}

function fromTransportError(error: ApiTransportError): RecipeLibraryApiError {
  if (error.reason === "invalid_response") return invalidResponse();
  return new RecipeLibraryApiError(
    recipeLibraryErrorMessage(error.status),
    error.status,
    error.code,
  );
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
  try {
    const response = await browserApiRequest(
      `/api/my/saved-recipes?${pageQuery(page, pageSize)}`,
      {
        errorContract: RECIPE_LIBRARY_ERROR_CONTRACT,
        kind: "query",
        retry: "never",
        signal,
      },
    );
    return parseSavedRecipeLibraryPage(response.data as SavedRecipeLibraryWire);
  } catch (error) {
    if (error instanceof RecipeLibraryApiError) throw error;
    if (error instanceof ApiTransportError) {
      if (error.reason === "aborted") {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      throw fromTransportError(error);
    }
    throw new RecipeLibraryApiError(
      "Recipe Lab could not load this recipe library. Please try again.",
      0,
    );
  }
}
