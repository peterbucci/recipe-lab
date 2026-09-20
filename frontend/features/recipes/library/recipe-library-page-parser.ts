import { invalidRecipeLibraryResponse } from "./recipe-library-error";
import { isRecipeRecord } from "../shared/recipe-summary-parser";

export interface RecipeLibraryPageEnvelope {
  counts: MyRecipeLibraryCounts;
  items: unknown[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface MyRecipeLibraryCounts {
  drafts: number;
  published: number;
  saved: number;
  withdrawn: number;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseRecipeLibraryPageEnvelope(
  value: unknown,
): RecipeLibraryPageEnvelope {
  const counts = isRecipeRecord(value) ? value.counts : null;
  if (
    !isRecipeRecord(value) ||
    !isRecipeRecord(counts) ||
    !isCount(counts.drafts) ||
    !isCount(counts.published) ||
    !isCount(counts.saved) ||
    !isCount(counts.withdrawn) ||
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
  return {
    counts: {
      drafts: counts.drafts,
      published: counts.published,
      saved: counts.saved,
      withdrawn: counts.withdrawn,
    },
    items: value.items,
    page: value.page as number,
    page_size: value.page_size as number,
    total: value.total as number,
    total_pages: value.total_pages as number,
  };
}
