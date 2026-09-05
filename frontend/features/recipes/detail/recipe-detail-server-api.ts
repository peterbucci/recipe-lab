import "server-only";

import type { operations } from "../../../shared/api/generated/generated";
import { ApiTransportError } from "../../../shared/api/core";
import { serverApiRequest } from "../../../shared/api/server";
import {
  RECIPE_ERROR_CONTRACT,
  fromRecipeTransportError,
} from "../shared/recipe-api-error";
import type { RecipeDetail, RecipeDiff } from "../shared/recipe-contracts";

type RecipeDetailWire =
  operations["recipe_detail_api_recipes__recipe_version_id__get"]["responses"][200]["content"]["application/json"];

type RecipeDiffWire =
  operations["recipe_diff_api_recipes__recipe_version_id__diff_get"]["responses"][200]["content"]["application/json"];

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

export { RecipeApiError } from "../shared/recipe-api-error";
