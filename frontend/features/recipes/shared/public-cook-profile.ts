import type { operations } from "../../../shared/api/generated/generated";
import type {
  ActivePublicUserReference,
  RecipeCardSummary,
} from "./recipe-contracts";
import { invalidRecipeLibraryResponse } from "./recipe-library-error";
import { parseRecipeLibraryPageEnvelope } from "./recipe-library-page-parser";
import {
  isBoundedRecipeText,
  isRecipeRecord,
  parsePublicUserReference,
  parseRecipeCardSummary,
} from "./recipe-summary-parser";

export type PublicCookProfileWire =
  operations["public_cook_profile_api_cooks__handle__get"]["responses"][200]["content"]["application/json"];

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

export function parsePublicCookProfilePage(
  value: unknown,
): PublicCookProfilePage {
  const envelope = parseRecipeLibraryPageEnvelope(value);
  if (!isRecipeRecord(value)) throw invalidRecipeLibraryResponse();
  const cook = parsePublicUserReference(value.cook);
  const items = envelope.items.map(parseRecipeCardSummary);
  if (!cook || cook.handle === null || items.some((item) => item === null)) {
    throw invalidRecipeLibraryResponse();
  }
  if (
    !Number.isInteger(value.follower_count) ||
    (value.follower_count as number) < 0
  ) {
    throw invalidRecipeLibraryResponse();
  }
  const description = value.description ?? null;
  if (description !== null && !isBoundedRecipeText(description, 500)) {
    throw invalidRecipeLibraryResponse();
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
