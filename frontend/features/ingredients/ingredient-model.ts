import type { operations } from "../../shared/api/generated/generated";

type IngredientCatalogOperation =
  operations["ingredient_catalog_api_ingredients_get"];
type IngredientCatalogResponse =
  IngredientCatalogOperation["responses"][200]["content"]["application/json"];
type IngredientCatalogContract = IngredientCatalogResponse["items"][number];
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

export type CatalogIngredient = Omit<
  Mutable<IngredientCatalogContract>,
  "aliases"
> & { aliases: string[] };

export type CatalogIngredientPage = Omit<
  Mutable<IngredientCatalogResponse>,
  "items"
> & { items: CatalogIngredient[] };

export interface CatalogIngredientSelection {
  ingredientId: string;
  canonicalName: string;
  displayName: string;
}

export type IngredientCatalogRequestStatus =
  "pending" | "approved" | "rejected" | "duplicate";

export interface MissingIngredientRequest {
  id: string;
  proposed_name: string;
  context: string | null;
  status: IngredientCatalogRequestStatus;
  created_at: string;
  reviewed_at: string | null;
  decision_reason: string | null;
  resolved_ingredient_id: string | null;
}
