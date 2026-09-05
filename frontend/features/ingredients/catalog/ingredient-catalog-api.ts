import type { operations } from "../../../shared/api/generated/generated";
import { browserApiRequest } from "../../../shared/api/browser";
import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "../../../shared/api/core";
import { IngredientCatalogApiError } from "../ingredient-api-error";
import {
  isRecord,
  parseCatalogIngredient,
} from "../ingredient-contract-parsers";
import type {
  CatalogIngredient,
  CatalogIngredientPage,
} from "../ingredient-model";

type IngredientCatalogOperation =
  operations["ingredient_catalog_api_ingredients_get"];
type IngredientCatalogQuery = NonNullable<
  IngredientCatalogOperation["parameters"]["query"]
>;

function parseCatalogPage(value: unknown): CatalogIngredientPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !Number.isInteger(value.page) ||
    !Number.isInteger(value.page_size) ||
    !Number.isInteger(value.total) ||
    !Number.isInteger(value.total_pages)
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient catalog response.",
      502,
      "invalid_ingredient_catalog_response",
    );
  }

  const items = value.items.map(parseCatalogIngredient);
  if (
    items.some((item) => item === null) ||
    (value.page as number) < 1 ||
    (value.page_size as number) < 1 ||
    (value.page_size as number) > 100 ||
    (value.total as number) < 0 ||
    (value.total_pages as number) < 0
  ) {
    throw new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient catalog response.",
      502,
      "invalid_ingredient_catalog_response",
    );
  }

  return {
    items: items as CatalogIngredient[],
    page: value.page as number,
    page_size: value.page_size as number,
    total: value.total as number,
    total_pages: value.total_pages as number,
  };
}

const KNOWN_CATALOG_SEARCH_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "catalog_search_unavailable",
  "invalid_identifier",
  "rate_limit_exceeded",
  "validation_error",
]);

const CATALOG_SEARCH_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "ingredient_catalog_api_error",
  knownCodes: KNOWN_CATALOG_SEARCH_ERROR_CODES,
};

function catalogSearchError(
  error: ApiTransportError,
): IngredientCatalogApiError {
  if (error.reason === "invalid_response") {
    return new IngredientCatalogApiError(
      "Recipe Lab received an invalid ingredient catalog response.",
      502,
      "invalid_ingredient_catalog_response",
    );
  }
  const message =
    error.status === 429
      ? "The ingredient catalog is receiving too many searches. Please wait and try again."
      : "The ingredient catalog could not be searched. Please try again.";
  return new IngredientCatalogApiError(message, error.status, error.code);
}

export async function searchCatalogIngredients({
  query = "",
  page = 1,
  pageSize = 20,
  signal,
}: {
  query?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
} = {}): Promise<CatalogIngredientPage> {
  const search = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const normalizedQuery = query.trim();
  const queryContract = {
    page,
    page_size: pageSize,
    ...(normalizedQuery ? { q: normalizedQuery } : {}),
  } satisfies IngredientCatalogQuery;
  if (queryContract.q) {
    search.set("q", queryContract.q);
  }

  try {
    const response = await browserApiRequest(
      `/api/ingredients?${search.toString()}`,
      {
        errorContract: CATALOG_SEARCH_ERROR_CONTRACT,
        kind: "query",
        signal,
      },
    );
    return parseCatalogPage(response.data);
  } catch (error) {
    if (error instanceof IngredientCatalogApiError) throw error;
    if (error instanceof ApiTransportError) throw catalogSearchError(error);
    throw error;
  }
}
