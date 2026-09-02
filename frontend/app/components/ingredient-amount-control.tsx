"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  catalogUnitSummary,
  type CatalogUnit,
  type CatalogUnitSummary,
} from "../../lib/measurement-unit-api";
import {
  formatStructuredMeasureDraft,
  ingredientAmountPolicy,
  type QualitativeMeasureValue,
  type StructuredMeasureDraft,
  type StructuredMeasureField,
} from "../../lib/structured-measure";
import { useFloatingPanelPlacement } from "./use-floating-panel-placement";

export interface IngredientAmountControlProps {
  idPrefix: string;
  label: string;
  contextLabel?: string;
  value: StructuredMeasureDraft;
  units: readonly CatalogUnit[];
  errors?: Partial<Record<StructuredMeasureField, string>>;
  disabled?: boolean;
  describedBy?: string;
  presentation?: "form" | "popover";
  onChange: (value: StructuredMeasureDraft) => void;
}

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
  if (value === "to_taste") return "To taste";
  if (value === "as_needed") return "As needed";
  return "No amount specified";
}

function isAdvancedValue(value: StructuredMeasureDraft): boolean {
  return (
    value.mode === "range" ||
    value.mode === "to_taste" ||
    value.mode === "as_needed" ||
    value.mode === "unspecified" ||
    value.unit?.dimension === "package" ||
    Boolean(value.packageSizeId)
  );
}

export function IngredientAmountControl({
  idPrefix,
  label,
  contextLabel,
  value,
  units,
  errors = {},
  disabled = false,
  describedBy,
  presentation = "form",
  onChange,
}: IngredientAmountControlProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRootRef = useRef<HTMLFieldSetElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const simpleValue = value.mode === "exact";
  const advancedValue = isAdvancedValue(value);
  const panelVisible = advancedValue || moreOpen;
  const allowedUnits = units.filter(
    (unit) =>
      unit.active &&
      ingredientAmountPolicy.allowedDimensions.includes(unit.dimension) &&
      (panelVisible || unit.dimension !== "package"),
  );
  const selectedAvailableUnit = value.unit
    ? (allowedUnits.find((unit) => unit.id === value.unit?.id) ?? null)
    : null;
  const unavailableUnit =
    value.unit && !selectedAvailableUnit ? value.unit : null;
  const groupDescription =
    [describedBy, errors.mode ? `${idPrefix}-mode-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  const hasErrors = Object.values(errors).some(Boolean);
  const firstError = Object.values(errors).find(Boolean);
  const showPopover = presentation === "popover" && popoverOpen;
  const popoverPlacement = useFloatingPanelPlacement({
    open: showPopover,
    panelRef: popoverRef,
    triggerRef,
  });
  const formattedAmount = formatStructuredMeasureDraft(value);
  const amountTriggerText = formattedAmount.includes("needs attention")
    ? "Add amount"
    : formattedAmount;

  useEffect(() => {
    if (!showPopover) return;

    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !popoverRootRef.current?.contains(target)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, [showPopover]);

  useEffect(() => {
    if (!showPopover) return;
    popoverRef.current
      ?.querySelector<HTMLElement>("input, select, button")
      ?.focus();
  }, [showPopover]);

  const update = (changes: Partial<StructuredMeasureDraft>) => {
    onChange({ ...value, ...changes });
  };

  const selectedUnit = (event: ChangeEvent<HTMLSelectElement>) =>
    allowedUnits.find((candidate) => candidate.id === event.target.value) ??
    null;

  const updateSimpleUnit = (event: ChangeEvent<HTMLSelectElement>) => {
    const unit = selectedUnit(event);
    update({
      mode: "exact",
      unit: unit ? catalogUnitSummary(unit) : null,
      packageSizeId: null,
    });
  };

  const updateAdvancedUnit = (event: ChangeEvent<HTMLSelectElement>) => {
    const unit = selectedUnit(event);
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
    ...ingredientAmountPolicy.qualitativeValues.map((mode) => ({
      value: mode,
      label: qualitativeLabel(mode),
    })),
  ];

  const unitErrorId = errors.unit ? `${idPrefix}-unit-error` : undefined;
  const advancedId = `${idPrefix}-advanced`;

  const unitOptions = (
    <>
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
    </>
  );

  function closePopover() {
    setPopoverOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function handlePopoverKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closePopover();
  }

  const controls = (
    <>
      {simpleValue ? (
        <div className="ingredient-amount__primary">
          <div className="recipe-form-field">
            <label htmlFor={`${idPrefix}-amount`}>Amount</label>
            <input
              id={`${idPrefix}-amount`}
              value={value.exactValue}
              inputMode="decimal"
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={
                errors.amount ? `${idPrefix}-amount-error` : undefined
              }
              placeholder="2"
              onChange={(event) =>
                update({ mode: "exact", exactValue: event.target.value })
              }
            />
            <FieldError
              id={`${idPrefix}-amount-error`}
              message={errors.amount}
            />
          </div>
          <div className="recipe-form-field">
            <label htmlFor={`${idPrefix}-unit`}>Unit</label>
            <select
              id={`${idPrefix}-unit`}
              value={value.unit?.id ?? ""}
              aria-invalid={Boolean(errors.unit)}
              aria-describedby={unitErrorId}
              onChange={updateSimpleUnit}
            >
              {unitOptions}
            </select>
            <FieldError id={`${idPrefix}-unit-error`} message={errors.unit} />
          </div>
        </div>
      ) : (
        <div className="ingredient-amount__summary" role="status">
          <span>Amount</span>
          <strong>{formatStructuredMeasureDraft(value)}</strong>
          <small>The matching controls are open below.</small>
        </div>
      )}

      {advancedValue ? (
        <p className="ingredient-amount__advanced-heading">
          More amount options
        </p>
      ) : (
        <button
          className="ingredient-amount__toggle"
          type="button"
          aria-expanded={panelVisible}
          aria-controls={advancedId}
          onClick={() => setMoreOpen((current) => !current)}
        >
          {panelVisible ? "Hide more amount options" : "More amount options"}
        </button>
      )}

      {panelVisible ? (
        <div id={advancedId} className="ingredient-amount__advanced">
          {simpleValue ? (
            <p className="ingredient-amount__advanced-summary">
              {formatStructuredMeasureDraft(value)}
              {value.packageSizeId ? " · package details preserved" : ""}
            </p>
          ) : null}
          <div className="structured-measure__modes" aria-label="Amount type">
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

          {value.mode === "range" ? (
            <div className="structured-measure__numeric-grid structured-measure__numeric-grid--range">
              <div className="recipe-form-field">
                <label htmlFor={`${idPrefix}-minimum`}>Minimum amount</label>
                <input
                  id={`${idPrefix}-minimum`}
                  value={value.rangeMinimum}
                  inputMode="decimal"
                  aria-invalid={Boolean(errors.minimum)}
                  aria-describedby={
                    errors.minimum ? `${idPrefix}-minimum-error` : undefined
                  }
                  onChange={(event) =>
                    update({ rangeMinimum: event.target.value })
                  }
                />
                <FieldError
                  id={`${idPrefix}-minimum-error`}
                  message={errors.minimum}
                />
              </div>
              <div className="recipe-form-field">
                <label htmlFor={`${idPrefix}-maximum`}>Maximum amount</label>
                <input
                  id={`${idPrefix}-maximum`}
                  value={value.rangeMaximum}
                  inputMode="decimal"
                  aria-invalid={Boolean(errors.maximum)}
                  aria-describedby={
                    errors.maximum ? `${idPrefix}-maximum-error` : undefined
                  }
                  onChange={(event) =>
                    update({ rangeMaximum: event.target.value })
                  }
                />
                <FieldError
                  id={`${idPrefix}-maximum-error`}
                  message={errors.maximum}
                />
              </div>
              <div className="recipe-form-field">
                <label htmlFor={`${idPrefix}-unit-advanced`}>Unit</label>
                <select
                  id={`${idPrefix}-unit-advanced`}
                  value={value.unit?.id ?? ""}
                  aria-invalid={Boolean(errors.unit)}
                  aria-describedby={unitErrorId}
                  onChange={updateAdvancedUnit}
                >
                  {unitOptions}
                </select>
                <FieldError
                  id={`${idPrefix}-unit-error`}
                  message={errors.unit}
                />
              </div>
            </div>
          ) : null}

          {value.packageSizeId ? (
            <p className="ingredient-amount__preserved-note">
              This recipe includes curated package details. They stay attached
              unless you change the unit.
            </p>
          ) : null}
          <p className="ingredient-amount__catalog-note">
            Changing the unit does not recalculate the amount. Recipe Lab never
            guesses a conversion.
          </p>
        </div>
      ) : null}
    </>
  );

  return (
    <fieldset
      ref={popoverRootRef}
      className={`ingredient-amount${
        presentation === "popover" ? " ingredient-amount--popover" : ""
      }`}
      disabled={disabled}
      aria-label={contextLabel ? `${label} for ${contextLabel}` : label}
      aria-describedby={groupDescription}
    >
      <legend className="visually-hidden">
        {label}
        {contextLabel ? ` for ${contextLabel}` : ""}
      </legend>
      {presentation === "popover" ? (
        <>
          <button
            ref={triggerRef}
            className="ingredient-amount__trigger"
            type="button"
            aria-label={`Edit amount${contextLabel ? ` for ${contextLabel.toLowerCase()}` : ""}`}
            aria-haspopup="dialog"
            aria-expanded={showPopover}
            data-invalid={hasErrors || undefined}
            aria-controls={`${idPrefix}-popover`}
            onClick={() => setPopoverOpen((current) => !current)}
          >
            {amountTriggerText}
          </button>
          {!showPopover && firstError ? (
            <p className="ingredient-amount__trigger-error" role="alert">
              {firstError}
            </p>
          ) : null}
          {showPopover ? (
            <div
              ref={popoverRef}
              id={`${idPrefix}-popover`}
              className="ingredient-amount__popover"
              role="dialog"
              data-placement={popoverPlacement.placement}
              style={popoverPlacement.style}
              aria-label={
                contextLabel
                  ? `${label} for ${contextLabel.toLowerCase()}`
                  : label
              }
              onKeyDown={handlePopoverKeyDown}
            >
              {controls}
              <div className="ingredient-amount__popover-actions">
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={closePopover}
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        controls
      )}
    </fieldset>
  );
}
