import type { components, operations } from "./api-contracts/generated";
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
export type RecipeCardSummary = RecipePage["items"][number];
export type RecipeSummary = components["schemas"]["RecipeSummary"];
type RecipeCategoriesOperation =
  operations["recipe_categories_api_recipe_categories_get"];
export type RecipeCategoryList =
  RecipeCategoriesOperation["responses"][200]["content"]["application/json"];
export type RecipeCategory = RecipeCategoryList["items"][number];
type FeaturedRecipesOperation =
  operations["featured_recipes_api_recipes_featured_get"];
export type FeaturedRecipeList =
  FeaturedRecipesOperation["responses"][200]["content"]["application/json"];
type RecipeDetailWire =
  operations["recipe_detail_api_recipes__recipe_version_id__get"]["responses"][200]["content"]["application/json"];
type RecipeDiffWire =
  operations["recipe_diff_api_recipes__recipe_version_id__diff_get"]["responses"][200]["content"]["application/json"];
export type PublicUserReference = Omit<RecipeSummary["author"], "handle"> & {
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
  title: string | null;
  text: string;
  display_order: number;
  actions: RecipeInstructionAction[];
}

export type RecipeDifficulty = "easy" | "medium" | "hard";

export interface RecipeDetail extends RecipeSummary {
  average_rating: number | null;
  rating_count: number;
  save_count: number;
  total_time_minutes: number | null;
  active_time_minutes: number | null;
  difficulty: RecipeDifficulty | null;
  notes: string | null;
  viewer_state: RecipeViewerState | null;
  children: RecipeVersionReference[];
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
}

export type RecipeFieldName =
  | "title"
  | "description"
  | "servings"
  | "total_time_minutes"
  | "active_time_minutes"
  | "difficulty"
  | "notes";

export type RecipeFieldValue = string | number | null;

export type RecipeIngredientChangedField =
  "ingredient" | "display_name" | "measure" | "preparation_notes";

export type RecipeInstructionChangedField =
  | "title"
  | "text"
  | "actions"
  | "inputs"
  | "action_order"
  | "duration"
  | "temperature";

export interface RecipeFieldChange {
  field: RecipeFieldName;
  before: RecipeFieldValue;
  after: RecipeFieldValue;
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
  lineageId?: string;
  page?: number;
  pageSize?: number;
  query?: string;
  sort?: "newest" | "title";
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

function fromRecipeTransportError(error: ApiTransportError): RecipeApiError {
  return new RecipeApiError(
    recipeErrorMessage(error.status),
    error.status,
    error.code,
  );
}

export async function fetchRecipePage({
  category,
  isVariant,
  lineageId,
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
  if (lineageId) {
    searchParams.set("lineage_id", lineageId);
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
  try {
    const response = await serverApiRequest(
      `/api/recipes/${encodeURIComponent(recipeVersionId)}`,
      { errorContract: RECIPE_ERROR_CONTRACT, kind: "query", retry: "never" },
    );
    const payload = response.data as RecipeDetailWire;
    return { ...payload, viewer_state: null } as RecipeDetail;
  } catch (error) {
    if (error instanceof ApiTransportError) {
      if (error.status === 404) return null;
      throw fromRecipeTransportError(error);
    }
    throw error;
  }
}

export async function fetchRecipeDiff(
  recipeVersionId: string,
  baseVersionId?: string,
): Promise<RecipeDiff | null> {
  const query = new URLSearchParams();
  if (baseVersionId) query.set("base_version_id", baseVersionId);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  try {
    const response = await serverApiRequest(
      `/api/recipes/${encodeURIComponent(recipeVersionId)}/diff${suffix}`,
      { errorContract: RECIPE_ERROR_CONTRACT, kind: "query", retry: "never" },
    );
    return response.data as RecipeDiffWire as RecipeDiff;
  } catch (error) {
    if (error instanceof ApiTransportError) {
      if (error.status === 404) return null;
      throw fromRecipeTransportError(error);
    }
    throw error;
  }
}
