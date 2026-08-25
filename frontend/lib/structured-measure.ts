import type {
  CatalogUnit,
  CatalogUnitSummary,
  UnitDimension,
} from "./measurement-unit-api";

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

export type VariantMeasureInput =
  | { kind: "exact"; value: string; unit_id: string; package_size_id?: string }
  | {
      kind: "range";
      minimum: string;
      maximum: string;
      unit_id: string;
      package_size_id?: string;
    }
  | { kind: "qualitative"; value: QualitativeMeasureValue };

export type StructuredMeasureMode =
  | "exact"
  | "range"
  | QualitativeMeasureValue;

export interface StructuredMeasureDraft {
  mode: StructuredMeasureMode;
  exactValue: string;
  rangeMinimum: string;
  rangeMaximum: string;
  unit: CatalogUnitSummary | null;
  packageSizeId: string | null;
}

export type StructuredMeasureField = "mode" | "amount" | "minimum" | "maximum" | "unit";

export interface StructuredMeasureValidation {
  fieldErrors: Partial<Record<StructuredMeasureField, string>>;
  measure: VariantMeasureInput | null;
}

export interface StructuredMeasurePolicy {
  semantic: "ingredient_amount" | "action_duration" | "temperature";
  allowedDimensions: readonly UnitDimension[];
  qualitativeValues: readonly QualitativeMeasureValue[];
  allowSignedValues: boolean;
  maxWholeDigits: number;
  maxDecimalPlaces: number;
  numericLabel: string;
}

export const ingredientAmountPolicy: StructuredMeasurePolicy = {
  semantic: "ingredient_amount",
  allowedDimensions: ["mass", "volume", "count", "package"],
  qualitativeValues: ["to_taste", "as_needed", "unspecified"],
  allowSignedValues: false,
  maxWholeDigits: 8,
  maxDecimalPlaces: 4,
  numericLabel: "Amount",
};

export const durationPolicy: StructuredMeasurePolicy = {
  semantic: "action_duration",
  allowedDimensions: ["time"],
  qualitativeValues: [],
  allowSignedValues: false,
  maxWholeDigits: 12,
  maxDecimalPlaces: 6,
  numericLabel: "Duration",
};

export const temperaturePolicy: StructuredMeasurePolicy = {
  semantic: "temperature",
  allowedDimensions: ["temperature"],
  qualitativeValues: [],
  allowSignedValues: true,
  maxWholeDigits: 12,
  maxDecimalPlaces: 6,
  numericLabel: "Temperature",
};

export function createStructuredMeasureDraft(
  measure: RecipeIngredientMeasure,
): StructuredMeasureDraft {
  if (measure.kind === "exact") {
    return {
      mode: "exact",
      exactValue: measure.value,
      rangeMinimum: "",
      rangeMaximum: "",
      unit: measure.unit,
      packageSizeId: measure.package_size_id ?? null,
    };
  }
  if (measure.kind === "range") {
    return {
      mode: "range",
      exactValue: "",
      rangeMinimum: measure.minimum,
      rangeMaximum: measure.maximum,
      unit: measure.unit,
      packageSizeId: measure.package_size_id ?? null,
    };
  }
  if (measure.kind === "qualitative") {
    return {
      mode: measure.value,
      exactValue: "",
      rangeMinimum: "",
      rangeMaximum: "",
      unit: null,
      packageSizeId: null,
    };
  }
  const exhaustiveMeasure: never = measure;
  return exhaustiveMeasure;
}

export function createUnspecifiedMeasureDraft(): StructuredMeasureDraft {
  return {
    mode: "unspecified",
    exactValue: "",
    rangeMinimum: "",
    rangeMaximum: "",
    unit: null,
    packageSizeId: null,
  };
}

function trimmed(value: string): string {
  return value.trim();
}

function parsedDecimal(value: string): {
  negative: boolean;
  whole: string;
  fraction: string;
} {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  const whole = wholePart.replace(/^0+/, "") || "0";
  const fraction = fractionPart.replace(/0+$/, "");
  const zero = whole === "0" && fraction === "";
  return { negative: negative && !zero, whole, fraction };
}

export function compareDecimalStrings(left: string, right: string): number {
  const a = parsedDecimal(trimmed(left));
  const b = parsedDecimal(trimmed(right));
  if (a.negative !== b.negative) {
    return a.negative ? -1 : 1;
  }

  const direction = a.negative ? -1 : 1;
  if (a.whole.length !== b.whole.length) {
    return a.whole.length < b.whole.length ? -direction : direction;
  }
  if (a.whole !== b.whole) {
    return a.whole < b.whole ? -direction : direction;
  }

  const length = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(length, "0");
  const bFraction = b.fraction.padEnd(length, "0");
  if (aFraction === bFraction) {
    return 0;
  }
  return aFraction < bFraction ? -direction : direction;
}

function decimalError(
  value: string,
  label: string,
  policy: StructuredMeasurePolicy,
): string | null {
  const amount = trimmed(value);
  if (!amount) {
    return `${label} is required.`;
  }
  const pattern = policy.allowSignedValues
    ? /^-?\d+(?:\.\d+)?$/
    : /^\d+(?:\.\d+)?$/;
  if (!pattern.test(amount)) {
    return policy.allowSignedValues
      ? `${label} must be a decimal number.`
      : `${label} must be a positive decimal number.`;
  }

  const unsigned = amount.startsWith("-") ? amount.slice(1) : amount;
  const [wholePart, fractionalPart = ""] = unsigned.split(".");
  const significantWholePart = wholePart.replace(/^0+/, "") || "0";
  if (significantWholePart.length > policy.maxWholeDigits) {
    return `${label} can have at most ${policy.maxWholeDigits} digits before the decimal point.`;
  }
  if (fractionalPart.length > policy.maxDecimalPlaces) {
    return `${label} can have at most ${policy.maxDecimalPlaces} decimal places.`;
  }
  if (!policy.allowSignedValues && compareDecimalStrings(amount, "0") === 0) {
    return `${label} must be greater than zero.`;
  }
  return null;
}

function activeCompatibleUnit(
  selected: CatalogUnitSummary | null,
  units: readonly CatalogUnit[],
  allowedDimensions: readonly UnitDimension[],
): CatalogUnit | null {
  if (selected === null) {
    return null;
  }
  return (
    units.find(
      (unit) =>
        unit.id === selected.id &&
        unit.active &&
        allowedDimensions.includes(unit.dimension),
    ) ?? null
  );
}

export function validateStructuredMeasureDraft(
  draft: StructuredMeasureDraft,
  policy: StructuredMeasurePolicy,
  units: readonly CatalogUnit[],
): StructuredMeasureValidation {
  const fieldErrors: Partial<Record<StructuredMeasureField, string>> = {};

  if (draft.mode === "to_taste" || draft.mode === "as_needed" || draft.mode === "unspecified") {
    if (!policy.qualitativeValues.includes(draft.mode)) {
      fieldErrors.mode = `Choose a supported ${policy.numericLabel.toLowerCase()} type.`;
      return { fieldErrors, measure: null };
    }
    return {
      fieldErrors,
      measure: { kind: "qualitative", value: draft.mode },
    };
  }

  const selectedUnit = activeCompatibleUnit(
    draft.unit,
    units,
    policy.allowedDimensions,
  );
  if (selectedUnit === null) {
    fieldErrors.unit = draft.unit
      ? "Choose an active compatible unit."
      : "Choose a unit from the curated catalog.";
  }

  if (draft.mode === "exact") {
    const error = decimalError(
      draft.exactValue,
      policy.numericLabel,
      policy,
    );
    if (error) {
      fieldErrors.amount = error;
    }
    return {
      fieldErrors,
      measure:
        Object.keys(fieldErrors).length === 0 && selectedUnit
          ? {
              kind: "exact",
              value: trimmed(draft.exactValue),
              unit_id: selectedUnit.id,
              ...(draft.packageSizeId
                ? { package_size_id: draft.packageSizeId }
                : {}),
            }
          : null,
    };
  }

  const minimumError = decimalError(
    draft.rangeMinimum,
    `Minimum ${policy.numericLabel.toLowerCase()}`,
    policy,
  );
  if (minimumError) {
    fieldErrors.minimum = minimumError;
  }
  const maximumError = decimalError(
    draft.rangeMaximum,
    `Maximum ${policy.numericLabel.toLowerCase()}`,
    policy,
  );
  if (maximumError) {
    fieldErrors.maximum = maximumError;
  }
  if (
    !minimumError &&
    !maximumError &&
    compareDecimalStrings(draft.rangeMinimum, draft.rangeMaximum) >= 0
  ) {
    fieldErrors.maximum = "Maximum must be greater than minimum.";
  }

  return {
    fieldErrors,
    measure:
      Object.keys(fieldErrors).length === 0 && selectedUnit
        ? {
            kind: "range",
            minimum: trimmed(draft.rangeMinimum),
            maximum: trimmed(draft.rangeMaximum),
            unit_id: selectedUnit.id,
            ...(draft.packageSizeId
              ? { package_size_id: draft.packageSizeId }
              : {}),
          }
        : null,
  };
}

export function recipeMeasureInput(
  measure: RecipeIngredientMeasure,
): VariantMeasureInput {
  if (measure.kind === "qualitative") {
    return { kind: "qualitative", value: measure.value };
  }
  if (measure.kind === "exact") {
    return {
      kind: "exact",
      value: measure.value,
      unit_id: measure.unit.id,
      ...(measure.package_size_id
        ? { package_size_id: measure.package_size_id }
        : {}),
    };
  }
  return {
    kind: "range",
    minimum: measure.minimum,
    maximum: measure.maximum,
    unit_id: measure.unit.id,
    ...(measure.package_size_id
      ? { package_size_id: measure.package_size_id }
      : {}),
  };
}

export function structuredMeasureDraftMatchesRecipe(
  draft: StructuredMeasureDraft,
  original: RecipeIngredientMeasure,
): boolean {
  if (original.kind === "qualitative") {
    return draft.mode === original.value;
  }
  if (original.kind === "exact") {
    return (
      draft.mode === "exact" &&
      compareDecimalStrings(trimmed(draft.exactValue), original.value) === 0 &&
      draft.unit?.id === original.unit.id &&
      draft.packageSizeId === (original.package_size_id ?? null)
    );
  }
  return (
    draft.mode === "range" &&
    compareDecimalStrings(trimmed(draft.rangeMinimum), original.minimum) === 0 &&
    compareDecimalStrings(trimmed(draft.rangeMaximum), original.maximum) === 0 &&
    draft.unit?.id === original.unit.id &&
    draft.packageSizeId === (original.package_size_id ?? null)
  );
}

function isOne(value: string): boolean {
  return (
    compareDecimalStrings(value, "1") === 0 ||
    compareDecimalStrings(value, "-1") === 0
  );
}

function unitDisplay(unit: CatalogUnitSummary, numericValue: string): string {
  if (unit.display_style === "hidden") {
    return "";
  }
  if (unit.display_style === "symbol") {
    if (!unit.symbol) {
      throw new Error(`Symbol-style unit ${unit.id} has no symbol.`);
    }
    return unit.symbol;
  }
  return isOne(numericValue) ? unit.canonical_label : unit.plural_label;
}

function qualitativeDisplay(value: QualitativeMeasureValue): string {
  if (value === "to_taste") {
    return "To taste";
  }
  if (value === "as_needed") {
    return "As needed";
  }
  return "Amount not specified";
}

function displayDecimal(value: string): string {
  const amount = trimmed(value);
  const [whole, fraction] = amount.split(".", 2);
  if (fraction === undefined) {
    return whole;
  }
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

export function formatStructuredMeasureDraft(draft: StructuredMeasureDraft): string {
  if (draft.mode === "to_taste" || draft.mode === "as_needed" || draft.mode === "unspecified") {
    return qualitativeDisplay(draft.mode);
  }
  if (draft.mode === "exact") {
    const rawValue = trimmed(draft.exactValue);
    if (!rawValue) {
      return "Amount needs attention";
    }
    const value = displayDecimal(rawValue);
    const unit = draft.unit ? unitDisplay(draft.unit, rawValue) : "unit needed";
    const unavailable = draft.unit && !draft.unit.active ? " (unavailable unit)" : "";
    return `${value}${unit ? ` ${unit}` : ""}${unavailable}`;
  }
  const rawMinimum = trimmed(draft.rangeMinimum);
  const rawMaximum = trimmed(draft.rangeMaximum);
  if (!rawMinimum || !rawMaximum) {
    return "Amount range needs attention";
  }
  const minimum = displayDecimal(rawMinimum);
  const maximum = displayDecimal(rawMaximum);
  const unit = draft.unit ? unitDisplay(draft.unit, rawMaximum) : "unit needed";
  const unavailable = draft.unit && !draft.unit.active ? " (unavailable unit)" : "";
  return `${minimum}–${maximum}${unit ? ` ${unit}` : ""}${unavailable}`;
}
