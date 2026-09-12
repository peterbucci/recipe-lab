import type { components, operations } from "../../../shared/api/generated/generated";

import type {
  RecipeIngredientMeasure,
  RecipeInstructionAction,
} from "./recipe-structure";
import type { RecipeViewerState } from "./recipe-viewer-state";

type BrowseRecipesOperation = operations["browse_recipes_api_recipes_get"];

export type RecipePage =
  BrowseRecipesOperation["responses"][200]["content"]["application/json"];

export type RecipeCardSummary = RecipePage["items"][number];

export type RecipeSummary = components["schemas"]["RecipeSummary"];

type RecipeCategoriesOperation =
  operations["recipe_categories_api_recipe_categories_get"];

export type RecipeCategoryList =
  RecipeCategoriesOperation["responses"][200]["content"]["application/json"];

export type RecipeCategory = RecipeCategoryList["items"][number];

type FeaturedRecipesOperation =
  operations["featured_recipes_api_recipes_featured_get"];

export type FeaturedRecipeList =
  FeaturedRecipesOperation["responses"][200]["content"]["application/json"];

export type PublicUserReference = Omit<RecipeSummary["author"], "handle"> & {
  readonly handle: string | null;
};

export type RecipeVersionReference = NonNullable<RecipeSummary["parent"]>;

export interface ActivePublicUserReference extends PublicUserReference {
  handle: string;
}

export interface RecipeIngredient {
  id: string;
  ingredient_id: string;
  canonical_name: string;
  display_name: string;
  measure: RecipeIngredientMeasure;
  preparation_notes: string | null;
  display_order: number;
}

export interface RecipeInstruction {
  id: string;
  title: string | null;
  text: string;
  display_order: number;
  actions: RecipeInstructionAction[];
}

export type RecipeDifficulty = "easy" | "medium" | "hard";

export interface RecipeDetail extends RecipeSummary {
  average_rating: number | null;
  rating_count: number;
  save_count: number;
  total_time_minutes: number | null;
  active_time_minutes: number | null;
  difficulty: RecipeDifficulty | null;
  notes: string | null;
  viewer_state: RecipeViewerState | null;
  children: RecipeVersionReference[];
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
}

export type RecipeFieldName =
  | "title"
  | "description"
  | "servings"
  | "total_time_minutes"
  | "active_time_minutes"
  | "difficulty"
  | "notes";

export type RecipeFieldValue = string | number | null;

export type RecipeIngredientChangedField =
  "ingredient" | "display_name" | "measure" | "preparation_notes";

export type RecipeInstructionChangedField =
  | "title"
  | "text"
  | "actions"
  | "inputs"
  | "action_order"
  | "duration"
  | "temperature";

export interface RecipeFieldChange {
  field: RecipeFieldName;
  before: RecipeFieldValue;
  after: RecipeFieldValue;
}

export interface RecipeIngredientPairChange {
  before: RecipeIngredient;
  after: RecipeIngredient;
  changed_fields: RecipeIngredientChangedField[];
}

export interface RecipeIngredientDiff {
  added: RecipeIngredient[];
  removed: RecipeIngredient[];
  replaced: RecipeIngredientPairChange[];
  modified: RecipeIngredientPairChange[];
}

export interface RecipeInstructionPairChange {
  before: RecipeInstruction;
  after: RecipeInstruction;
  changed_fields: RecipeInstructionChangedField[];
  unchanged_action_pairs: RecipeInstructionActionMatch[];
}

export interface RecipeInstructionActionMatch {
  before_id: string;
  after_id: string;
}

export interface RecipeInstructionDiff {
  added: RecipeInstruction[];
  removed: RecipeInstruction[];
  modified: RecipeInstructionPairChange[];
}

export interface RecipeDiff {
  lineage_id: string;
  base_version: RecipeVersionReference;
  target_version: RecipeVersionReference;
  metadata_changes: RecipeFieldChange[];
  ingredients: RecipeIngredientDiff;
  ingredient_context: {
    base: RecipeIngredient[];
    target: RecipeIngredient[];
  };
  instructions: RecipeInstructionDiff;
  has_changes: boolean;
}

export type { RecipeIngredientMeasure } from "./recipe-structure";
