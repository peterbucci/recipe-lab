"use client";

import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "./api-transport/core";
import type { RecipeCategoryList } from "./recipe-api";
import { parseRecipeCategories } from "./recipe-category";

const CATEGORY_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_category_api_error",
  knownCodes: new Set(["validation_error"]),
};

export class RecipeCategoryApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message = "Recipe Lab could not load the curated categories.",
    status = 0,
    code = "recipe_category_api_error",
  ) {
    super(message);
    this.name = "RecipeCategoryApiError";
    this.code = code;
    this.status = status;
  }
}

export async function fetchActiveRecipeCategories(
  signal?: AbortSignal,
): Promise<RecipeCategoryList> {
  try {
    const response = await browserApiRequest("/api/recipe-categories", {
      errorContract: CATEGORY_ERROR_CONTRACT,
      kind: "query",
      signal,
    });
    const items =
      typeof response.data === "object" &&
      response.data !== null &&
      "items" in response.data
        ? parseRecipeCategories(response.data.items)
        : null;
    if (!items) {
      throw new RecipeCategoryApiError(
        "Recipe Lab received an invalid curated category response.",
        502,
        "invalid_recipe_category_response",
      );
    }
    return { items };
  } catch (error) {
    if (error instanceof RecipeCategoryApiError) throw error;
    if (error instanceof ApiTransportError) {
      throw new RecipeCategoryApiError(undefined, error.status, error.code);
    }
    throw error;
  }
}
