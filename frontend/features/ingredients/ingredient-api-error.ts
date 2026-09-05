import type { ApiValidationIssue } from "../../shared/api/core";

export class IngredientCatalogApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiValidationIssue[];

  constructor(
    message: string,
    status: number,
    code = "ingredient_catalog_api_error",
    issues: ApiValidationIssue[] = [],
  ) {
    super(message);
    this.name = "IngredientCatalogApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}
