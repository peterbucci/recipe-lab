import { invalidRecipeLibraryResponse } from "./recipe-library-error";
import { isRecipeRecord } from "./recipe-summary-parser";

export interface RecipeLibraryPageEnvelope {
  items: unknown[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export function parseRecipeLibraryPageEnvelope(
  value: unknown,
): RecipeLibraryPageEnvelope {
  if (
    !isRecipeRecord(value) ||
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
    throw invalidRecipeLibraryResponse();
  }
  return value as unknown as RecipeLibraryPageEnvelope;
}
