import type { operations } from "../../shared/api/generated/generated";
import type {
  ActivePublicUserReference,
  RecipeCardSummary,
} from "../recipes/shared/recipe-contracts";
import { invalidPublicCookProfileResponse } from "./public-cook-profile-error";
import {
  isBoundedRecipeText,
  isRecipeRecord,
  parsePublicUserReference,
  parseRecipeCardSummary,
} from "../recipes/shared/recipe-summary-parser";

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
    throw invalidPublicCookProfileResponse();
  }
  const cook = parsePublicUserReference(value.cook);
  const items = value.items.map(parseRecipeCardSummary);
  if (!cook || cook.handle === null || items.some((item) => item === null)) {
    throw invalidPublicCookProfileResponse();
  }
  if (
    !Number.isInteger(value.follower_count) ||
    (value.follower_count as number) < 0
  ) {
    throw invalidPublicCookProfileResponse();
  }
  const description = value.description ?? null;
  if (description !== null && !isBoundedRecipeText(description, 500)) {
    throw invalidPublicCookProfileResponse();
  }
  const activeCook: ActivePublicUserReference = {
    ...cook,
    handle: cook.handle,
  };
  return {
    cook: activeCook,
    follower_count: value.follower_count as number,
    description: description as string | null,
    items: items as RecipeCardSummary[],
    page: value.page as number,
    page_size: value.page_size as number,
    total: value.total as number,
    total_pages: value.total_pages as number,
  };
}
