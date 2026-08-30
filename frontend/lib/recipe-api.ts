import type { operations } from "./api-contracts/generated";
import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "./api-transport/core";
import { serverApiRequest } from "./api-transport/server";
import type { RecipeViewerState } from "./recipe-viewer-state";
import type { RecipeInstructionAction } from "./structured-action";
import type { RecipeIngredientMeasure } from "./structured-measure";

export type { RecipeIngredientMeasure } from "./structured-measure";

type BrowseRecipesOperation = operations["browse_recipes_api_recipes_get"];
export type RecipePage =
  BrowseRecipesOperation["responses"][200]["content"]["application/json"];
export type RecipeSummary = RecipePage["items"][number];
type RecipeCategoriesOperation =
  operations["recipe_categories_api_recipe_categories_get"];
export type RecipeCategoryList =
  RecipeCategoriesOperation["responses"][200]["content"]["application/json"];
export type RecipeCategory = RecipeCategoryList["items"][number];
type FeaturedRecipesOperation =
  operations["featured_recipes_api_recipes_featured_get"];
export type FeaturedRecipeList =
  FeaturedRecipesOperation["responses"][200]["content"]["application/json"];
export type PublicUserReference = Omit<
  RecipeSummary["author"],
  "handle"
> & {
  readonly handle: string | null;
};
export type RecipeVersionReference = NonNullable<RecipeSummary["parent"]>;

export interface ActivePublicUserReference extends PublicUserReference {
  handle: string;
}

export interface RecipeIngredient {
  id: string;
  ingredient_id: string;
  canonical_name: string;
  display_name: string;
  measure: RecipeIngredientMeasure;
  preparation_notes: string | null;
  display_order: number;
}

export interface RecipeInstruction {
  id: string;
  text: string;
  display_order: number;
  actions: RecipeInstructionAction[];
}

export interface RecipeDetail extends RecipeSummary {
  average_rating: number | null;
  rating_count: number;
  viewer_state: RecipeViewerState | null;
  children: RecipeVersionReference[];
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
}

export type RecipeFieldName = "title" | "description" | "servings";

export type RecipeIngredientChangedField =
  "ingredient" | "display_name" | "measure" | "preparation_notes";

export type RecipeInstructionChangedField =
  "text" | "actions" | "inputs" | "action_order" | "duration" | "temperature";

export interface RecipeFieldChange {
  field: RecipeFieldName;
  before: string | null;
  after: string | null;
}

export interface RecipeIngredientPairChange {
  before: RecipeIngredient;
  after: RecipeIngredient;
  changed_fields: RecipeIngredientChangedField[];
}

export interface RecipeIngredientDiff {
  added: RecipeIngredient[];
  removed: RecipeIngredient[];
  replaced: RecipeIngredientPairChange[];
  modified: RecipeIngredientPairChange[];
}

export interface RecipeInstructionPairChange {
  before: RecipeInstruction;
  after: RecipeInstruction;
  changed_fields: RecipeInstructionChangedField[];
}

export interface RecipeInstructionDiff {
  added: RecipeInstruction[];
  removed: RecipeInstruction[];
  modified: RecipeInstructionPairChange[];
}

export interface RecipeDiff {
  lineage_id: string;
  base_version: RecipeVersionReference;
  target_version: RecipeVersionReference;
  metadata_changes: RecipeFieldChange[];
  ingredients: RecipeIngredientDiff;
  ingredient_context: {
    base: RecipeIngredient[];
    target: RecipeIngredient[];
  };
  instructions: RecipeInstructionDiff;
  has_changes: boolean;
}

interface RecipePageQuery {
  category?: string;
  isVariant?: boolean;
  page?: number;
  pageSize?: number;
  query?: string;
  sort?: "newest" | "title";
}

interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

const KNOWN_RECIPE_ERROR_CODES = new Set([
  "invalid_identifier",
  "recipe_has_no_parent",
  "recipe_lineage_mismatch",
  "recipe_not_found",
  "validation_error",
]);

const RECIPE_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_api_error",
  knownCodes: KNOWN_RECIPE_ERROR_CODES,
};

function knownRecipeErrorCode(value: unknown): string {
  return typeof value === "string" && KNOWN_RECIPE_ERROR_CODES.has(value)
    ? value
    : "recipe_api_error";
}

function recipeErrorMessage(status: number): string {
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 403) return "This recipe is not available to your account.";
  if (status === 404) return "This recipe is no longer available.";
  if (status === 422) return "Review the recipe request and try again.";
  if (status === 429) {
    return "Recipe Lab is receiving too many recipe requests. Please wait and try again.";
  }
  return "The recipe service could not complete this request.";
}

export class RecipeApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "recipe_api_error") {
    super(message);
    this.name = "RecipeApiError";
    this.status = status;
    this.code = code;
  }
}

export function isRecipeVersionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function apiBaseUrl(): string {
  const configured =
    process.env.RECIPE_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8000";
  return configured.trim().replace(/\/+$/, "");
}

function apiUrl(path: string): URL {
  return new URL(path, `${apiBaseUrl()}/`);
}

function isErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === "object" && value !== null && "error" in value;
}

async function apiError(response: Response): Promise<RecipeApiError> {
  let code = "recipe_api_error";

  try {
    const payload: unknown = await response.json();
    if (
      isErrorPayload(payload) &&
      typeof payload.error === "object" &&
      payload.error !== null
    ) {
      code = knownRecipeErrorCode(payload.error.code);
    }
  } catch {
    // Keep the stable user-facing fallback when an upstream response is not JSON.
  }

  return new RecipeApiError(
    recipeErrorMessage(response.status),
    response.status,
    code,
  );
}

async function apiFetch(url: URL): Promise<Response> {
  return fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });
}

export async function fetchRecipePage({
  category,
  isVariant,
  page = 1,
  pageSize = 12,
  query,
  sort,
}: RecipePageQuery = {}): Promise<RecipePage> {
  const searchParams = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (query) {
    searchParams.set("q", query);
  }
  if (isVariant !== undefined) {
    searchParams.set("is_variant", String(isVariant));
  }
  if (category) {
    searchParams.set("category", category);
  }
  if (sort) {
    searchParams.set("sort", sort);
  }

  try {
    const response = await serverApiRequest(
      `/api/recipes?${searchParams.toString()}`,
      {
        errorContract: RECIPE_ERROR_CONTRACT,
        kind: "query",
      },
    );
    return response.data as RecipePage;
  } catch (error) {
    if (error instanceof ApiTransportError) {
      throw new RecipeApiError(
        recipeErrorMessage(error.status),
        error.status,
        error.code,
      );
    }
    throw error;
  }
}

async function fetchPublicHomepageResource<T>(path: string): Promise<T> {
  try {
    const response = await serverApiRequest(path, {
      errorContract: RECIPE_ERROR_CONTRACT,
      kind: "query",
    });
    return response.data as T;
  } catch (error) {
    if (error instanceof ApiTransportError) {
      throw new RecipeApiError(
        recipeErrorMessage(error.status),
        error.status,
        error.code,
      );
    }
    throw error;
  }
}

export async function fetchFeaturedRecipes(): Promise<FeaturedRecipeList> {
  return fetchPublicHomepageResource<FeaturedRecipeList>(
    "/api/recipes/featured",
  );
}

export async function fetchRecipeCategories(): Promise<RecipeCategoryList> {
  return fetchPublicHomepageResource<RecipeCategoryList>(
    "/api/recipe-categories",
  );
}

export async function fetchRecipe(
  recipeVersionId: string,
): Promise<RecipeDetail | null> {
  const response = await apiFetch(
    apiUrl(`/api/recipes/${encodeURIComponent(recipeVersionId)}`),
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await apiError(response);
  }
  const payload = (await response.json()) as RecipeDetail;
  return { ...payload, viewer_state: null };
}

export async function fetchRecipeDiff(
  recipeVersionId: string,
): Promise<RecipeDiff | null> {
  const response = await apiFetch(
    apiUrl(`/api/recipes/${encodeURIComponent(recipeVersionId)}/diff`),
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await apiError(response);
  }
  return (await response.json()) as RecipeDiff;
}
