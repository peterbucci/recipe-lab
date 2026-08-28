"use client";

import type { ChangeEvent } from "react";

import {
  catalogUnitSummary,
  type CatalogUnit,
  type CatalogUnitSummary,
} from "../../lib/measurement-unit-api";
import {
  durationPolicy,
  ingredientAmountPolicy,
  temperaturePolicy,
  type QualitativeMeasureValue,
  type StructuredMeasureDraft,
  type StructuredMeasureField,
  type StructuredMeasurePolicy,
} from "../../lib/structured-measure";

export interface StructuredMeasureControlProps {
  idPrefix: string;
  label: string;
  contextLabel?: string;
  value: StructuredMeasureDraft;
  units: readonly CatalogUnit[];
  policy: StructuredMeasurePolicy;
  errors?: Partial<Record<StructuredMeasureField, string>>;
  disabled?: boolean;
  describedBy?: string;
  onChange: (value: StructuredMeasureDraft) => void;
}

type WrapperProps = Omit<StructuredMeasureControlProps, "policy">;

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="structured-measure__error">
      {message}
    </p>
  ) : null;
}

function optionLabel(unit: CatalogUnit | CatalogUnitSummary): string {
  return unit.symbol
    ? `${unit.canonical_label} (${unit.symbol})`
    : unit.canonical_label;
}

function qualitativeLabel(value: QualitativeMeasureValue): string {
  if (value === "to_taste") {
    return "To taste";
  }
  if (value === "as_needed") {
    return "As needed";
  }
  return "Unspecified";
}

export function StructuredMeasureControl({
  idPrefix,
  label,
  contextLabel,
  value,
  units,
  policy,
  errors = {},
  disabled = false,
  describedBy,
  onChange,
}: StructuredMeasureControlProps) {
  const allowedUnits = units.filter(
    (unit) => unit.active && policy.allowedDimensions.includes(unit.dimension),
  );
  const selectedAvailableUnit = value.unit
    ? allowedUnits.find((unit) => unit.id === value.unit?.id) ?? null
    : null;
  const unavailableUnit = value.unit && !selectedAvailableUnit ? value.unit : null;
  const groupDescription = [describedBy, errors.mode ? `${idPrefix}-mode-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;

  const update = (changes: Partial<StructuredMeasureDraft>) => {
    onChange({ ...value, ...changes });
  };

  const handleUnitChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const unit = allowedUnits.find((candidate) => candidate.id === event.target.value);
    update({
      unit: unit ? catalogUnitSummary(unit) : null,
      packageSizeId: null,
    });
  };

  const modes: Array<{
    value: "exact" | "range" | QualitativeMeasureValue;
    label: string;
  }> = [
    { value: "exact", label: "Exact" },
    { value: "range", label: "Range" },
    ...policy.qualitativeValues.map((mode) => ({
      value: mode,
      label: qualitativeLabel(mode),
    })),
  ];

  const unitErrorId = errors.unit ? `${idPrefix}-unit-error` : undefined;

  return (
    <fieldset
      className="structured-measure"
      disabled={disabled}
      aria-label={contextLabel ? `${label} for ${contextLabel}` : undefined}
      aria-describedby={groupDescription}
    >
      <legend>
        {label}
        {contextLabel ? <span className="visually-hidden"> for {contextLabel}</span> : null}
      </legend>
      <div className="structured-measure__modes">
        {modes.map((mode) => (
          <label key={mode.value}>
            <input
              type="radio"
              name={`${idPrefix}-mode`}
              value={mode.value}
              checked={value.mode === mode.value}
              onChange={() => update({ mode: mode.value })}
            />
            <span>{mode.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${idPrefix}-mode-error`} message={errors.mode} />

      {value.mode === "exact" ? (
        <div className="structured-measure__numeric-grid">
          <div className="recipe-form-field">
            <label htmlFor={`${idPrefix}-amount`}>{policy.numericLabel}</label>
            <input
              id={`${idPrefix}-amount`}
              value={value.exactValue}
              inputMode="decimal"
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? `${idPrefix}-amount-error` : undefined}
              onChange={(event) => update({ exactValue: event.target.value })}
            />
            <FieldError id={`${idPrefix}-amount-error`} message={errors.amount} />
          </div>
          <div className="recipe-form-field">
            <label htmlFor={`${idPrefix}-unit`}>Unit</label>
            <select
              id={`${idPrefix}-unit`}
              value={value.unit?.id ?? ""}
              aria-invalid={Boolean(errors.unit)}
              aria-describedby={unitErrorId}
              onChange={handleUnitChange}
            >
              <option value="">Choose a unit</option>
              {unavailableUnit ? (
                <option value={unavailableUnit.id} disabled>
                  {optionLabel(unavailableUnit)} — unavailable
                </option>
              ) : null}
              {allowedUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {optionLabel(unit)}
                </option>
              ))}
            </select>
            <FieldError id={`${idPrefix}-unit-error`} message={errors.unit} />
          </div>
        </div>
      ) : null}

      {value.mode === "range" ? (
        <div className="structured-measure__numeric-grid structured-measure__numeric-grid--range">
          <div className="recipe-form-field">
            <label htmlFor={`${idPrefix}-minimum`}>Minimum {policy.numericLabel.toLowerCase()}</label>
            <input
              id={`${idPrefix}-minimum`}
              value={value.rangeMinimum}
              inputMode="decimal"
              aria-invalid={Boolean(errors.minimum)}
              aria-describedby={errors.minimum ? `${idPrefix}-minimum-error` : undefined}
              onChange={(event) => update({ rangeMinimum: event.target.value })}
            />
            <FieldError id={`${idPrefix}-minimum-error`} message={errors.minimum} />
          </div>
          <div className="recipe-form-field">
            <label htmlFor={`${idPrefix}-maximum`}>Maximum {policy.numericLabel.toLowerCase()}</label>
            <input
              id={`${idPrefix}-maximum`}
              value={value.rangeMaximum}
              inputMode="decimal"
              aria-invalid={Boolean(errors.maximum)}
              aria-describedby={errors.maximum ? `${idPrefix}-maximum-error` : undefined}
              onChange={(event) => update({ rangeMaximum: event.target.value })}
            />
            <FieldError id={`${idPrefix}-maximum-error`} message={errors.maximum} />
          </div>
          <div className="recipe-form-field">
            <label htmlFor={`${idPrefix}-unit`}>Unit</label>
            <select
              id={`${idPrefix}-unit`}
              value={value.unit?.id ?? ""}
              aria-invalid={Boolean(errors.unit)}
              aria-describedby={unitErrorId}
              onChange={handleUnitChange}
            >
              <option value="">Choose a unit</option>
              {unavailableUnit ? (
                <option value={unavailableUnit.id} disabled>
                  {optionLabel(unavailableUnit)} — unavailable
                </option>
              ) : null}
              {allowedUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {optionLabel(unit)}
                </option>
              ))}
            </select>
            <FieldError id={`${idPrefix}-unit-error`} message={errors.unit} />
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

export function IngredientAmountControl(props: WrapperProps) {
  return <StructuredMeasureControl {...props} policy={ingredientAmountPolicy} />;
}

export function DurationMeasureControl(props: WrapperProps) {
  return <StructuredMeasureControl {...props} policy={durationPolicy} />;
}

export function TemperatureMeasureControl(props: WrapperProps) {
  return <StructuredMeasureControl {...props} policy={temperaturePolicy} />;
}
