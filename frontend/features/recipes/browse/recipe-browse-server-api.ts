import "server-only";

import { ApiTransportError } from "../../../shared/api/core";
import { serverApiRequest } from "../../../shared/api/server";
import {
  RECIPE_ERROR_CONTRACT,
  fromRecipeTransportError,
} from "../shared/recipe-api-error";
import type {
  FeaturedRecipeList,
  RecipeCategoryList,
  RecipePage,
} from "../shared/recipe-contracts";

interface RecipePageQuery {
  category?: string;
  isVariant?: boolean;
  lineageId?: string;
  page?: number;
  pageSize?: number;
  query?: string;
  sort?: "newest" | "title";
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
  if (query) searchParams.set("q", query);
  if (isVariant !== undefined) searchParams.set("is_variant", String(isVariant));
  if (lineageId) searchParams.set("lineage_id", lineageId);
  if (category) searchParams.set("category", category);
  if (sort) searchParams.set("sort", sort);

  try {
    const response = await serverApiRequest(
      `/api/recipes?${searchParams.toString()}`,
      { errorContract: RECIPE_ERROR_CONTRACT, kind: "query" },
    );
    return response.data as RecipePage;
  } catch (error) {
    if (error instanceof ApiTransportError) {
      throw fromRecipeTransportError(error);
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
      throw fromRecipeTransportError(error);
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
