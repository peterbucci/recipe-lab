import type { CatalogActionTypeSummary } from "./cooking-action-model";
import type { CatalogUnitSummary } from "./measurement-unit-model";

export type QualitativeMeasureValue = "to_taste" | "as_needed" | "unspecified";

export type RecipeIngredientMeasure =
  | {
      kind: "exact";
      value: string;
      unit: CatalogUnitSummary;
      package_size_id?: string | null;
      display_unit: string | null;
      display: string;
    }
  | {
      kind: "range";
      minimum: string;
      maximum: string;
      unit: CatalogUnitSummary;
      package_size_id?: string | null;
      display_unit: string | null;
      display: string;
    }
  | {
      kind: "qualitative";
      value: QualitativeMeasureValue;
      unit: null;
      display_unit: null;
      display: string;
    };

export type RecipeNumericMeasure = Extract<
  RecipeIngredientMeasure,
  { kind: "exact" | "range" }
>;

export interface RecipeInstructionAction {
  id: string;
  action_type: CatalogActionTypeSummary;
  display_order: number;
  ingredient_occurrence_ids: string[];
  duration: RecipeNumericMeasure | null;
  temperature: RecipeNumericMeasure | null;
}
