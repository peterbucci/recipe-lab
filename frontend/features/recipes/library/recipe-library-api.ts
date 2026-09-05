"use client";

import { browserApiRequest } from "../../../shared/api/browser";
import { ApiTransportError } from "../../../shared/api/core";
import {
  parseMyRecipeLibraryPage,
  parseSavedRecipeLibraryPage,
  type MyRecipeLibraryPage,
  type MyRecipeLibraryView,
  type SavedRecipeLibraryPage,
  type SavedRecipeLibraryWire,
} from "./recipe-library-model";
import {
  RecipeLibraryApiError,
  RECIPE_LIBRARY_ERROR_CONTRACT,
  invalidRecipeLibraryResponse as invalidResponse,
  recipeLibraryErrorFromTransport as fromTransportError,
} from "../shared/recipe-library-error";

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
