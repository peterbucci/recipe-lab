export interface RecipeSummary {
  id: string;
  lineage_id: string;
  parent_version_id: string | null;
  version_number: number;
  title: string;
  description: string | null;
  servings: string;
  created_at: string;
}

export interface RecipeVersionReference {
  id: string;
  version_number: number;
  title: string;
}

export interface RecipeIngredient {
  id: string;
  ingredient_id: string;
  canonical_name: string;
  display_name: string;
  quantity: string | null;
  unit: string | null;
  preparation_notes: string | null;
  display_order: number;
}

export interface RecipeInstruction {
  id: string;
  text: string;
  display_order: number;
}

export interface RecipeDetail extends RecipeSummary {
  average_rating: number | null;
  rating_count: number;
  parent: RecipeVersionReference | null;
  children: RecipeVersionReference[];
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
}

export interface RecipePage {
  items: RecipeSummary[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

interface RecipePageQuery {
  page?: number;
  pageSize?: number;
  query?: string;
}

interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
  };
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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
  let message = "The recipe service could not complete this request.";
  let code = "recipe_api_error";

  try {
    const payload: unknown = await response.json();
    if (isErrorPayload(payload) && typeof payload.error === "object" && payload.error !== null) {
      if (typeof payload.error.message === "string") {
        message = payload.error.message;
      }
      if (typeof payload.error.code === "string") {
        code = payload.error.code;
      }
    }
  } catch {
    // Keep the stable user-facing fallback when an upstream response is not JSON.
  }

  return new RecipeApiError(message, response.status, code);
}

async function apiFetch(url: URL): Promise<Response> {
  return fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
}

export async function fetchRecipePage({
  page = 1,
  pageSize = 12,
  query,
}: RecipePageQuery = {}): Promise<RecipePage> {
  const url = apiUrl("/api/recipes");
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  if (query) {
    url.searchParams.set("q", query);
  }

  const response = await apiFetch(url);
  if (!response.ok) {
    throw await apiError(response);
  }
  return (await response.json()) as RecipePage;
}

export async function fetchRecipe(recipeVersionId: string): Promise<RecipeDetail | null> {
  const response = await apiFetch(apiUrl(`/api/recipes/${encodeURIComponent(recipeVersionId)}`));
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await apiError(response);
  }
  return (await response.json()) as RecipeDetail;
}
