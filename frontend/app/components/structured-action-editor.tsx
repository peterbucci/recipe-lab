"use client";

import { useEffect, useRef, useState } from "react";

import {
  catalogActionTypeSummary,
  type CatalogActionType,
} from "../../lib/cooking-action-api";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import {
  createStructuredActionDraft,
  MAX_STRUCTURED_ACTIONS_PER_INSTRUCTION,
  structuredActionFieldKey,
  type IngredientOccurrenceOption,
  type StructuredActionDraft,
} from "../../lib/structured-action";
import { formatDecimal } from "../../lib/format";
import type { StructuredMeasureField } from "../../lib/structured-measure";
import {
  DurationMeasureControl,
  TemperatureMeasureControl,
} from "./structured-measure-control";

interface StructuredActionEditorProps {
  idPrefix: string;
  stepLabel: string;
  value: readonly StructuredActionDraft[];
  actionTypes: readonly CatalogActionType[];
  ingredientOccurrences: readonly IngredientOccurrenceOption[];
  measurementUnits: readonly CatalogUnit[];
  errors?: Readonly<Record<string, string>>;
  disabled?: boolean;
  onChange: (value: StructuredActionDraft[]) => void;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="structured-action__error">
      {message}
    </p>
  ) : null;
}

function measureErrors(
  errors: Readonly<Record<string, string>>,
  actionKey: string,
  field: "duration" | "temperature",
): Partial<Record<StructuredMeasureField, string>> {
  const fields: StructuredMeasureField[] = ["mode", "amount", "minimum", "maximum", "unit"];
  return Object.fromEntries(
    fields.flatMap((measureField) => {
      const message = errors[structuredActionFieldKey(actionKey, field, measureField)];
      return message ? [[measureField, message]] : [];
    }),
  );
}

function measureSummary(
  measure: StructuredActionDraft["duration"],
): string | null {
  if (!measure.enabled || !measure.value.unit) {
    return null;
  }
  const { unit } = measure.value;
  const displayDecimal = (value: string) => {
    const formatted = formatDecimal(value);
    const negative = formatted.startsWith("-");
    const unsigned = negative ? formatted.slice(1) : formatted;
    const normalized = unsigned.replace(/^0+(?=\d)/, "");
    return `${negative ? "-" : ""}${normalized}`;
  };
  const amount =
    measure.value.mode === "exact"
      ? displayDecimal(measure.value.exactValue.trim())
      : measure.value.mode === "range"
        ? `${displayDecimal(measure.value.rangeMinimum.trim())}\u2013${displayDecimal(
            measure.value.rangeMaximum.trim(),
          )}`
        : "";
  if (!amount || amount.startsWith("\u2013") || amount.endsWith("\u2013")) {
    return null;
  }
  if (unit.display_style === "symbol" && unit.symbol) {
    return `${amount} ${unit.symbol}`;
  }
  const singular = !amount.includes("\u2013") && Number(amount) === 1;
  return `${amount} ${singular ? unit.canonical_label : unit.plural_label}`;
}

function ingredientSummary(
  keys: readonly string[],
  ingredientOccurrences: readonly IngredientOccurrenceOption[],
): string | null {
  const selected = keys.flatMap((key) => {
    const ingredient = ingredientOccurrences.find((item) => item.key === key);
    return ingredient ? [ingredient.label.replace(/^Ingredient \d+:\s*/, "")] : [];
  });
  if (selected.length === 0) {
    return null;
  }
  return selected.length === 1 ? selected[0] : `${selected.length} ingredients`;
}

function actionSummary(
  action: StructuredActionDraft,
  ingredientOccurrences: readonly IngredientOccurrenceOption[],
): string {
  const parts = [
    action.actionType?.canonical_verb ?? "Action not chosen",
    ingredientSummary(action.ingredientKeys, ingredientOccurrences),
    measureSummary(action.duration),
    measureSummary(action.temperature),
  ].filter((part): part is string => Boolean(part));
  return parts.join(" \u00b7 ");
}

function cookingDetailsSummary(
  value: readonly StructuredActionDraft[],
  ingredientOccurrences: readonly IngredientOccurrenceOption[],
): string {
  if (value.length === 0) {
    return "Optional while you write. Add the actions, ingredients, time, or temperature you want to confirm.";
  }
  const visible = value.slice(0, 2).map((action) => actionSummary(action, ingredientOccurrences));
  const remaining = value.length - visible.length;
  return `${visible.join(" \u2192 ")}${remaining > 0 ? ` \u00b7 ${remaining} more` : ""}`;
}

export function StructuredActionEditor({
  idPrefix,
  stepLabel,
  value,
  actionTypes,
  ingredientOccurrences,
  measurementUnits,
  errors = {},
  disabled = false,
  onChange,
}: StructuredActionEditorProps) {
  const pendingFocusId = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const hasErrors = Object.values(errors).some(Boolean);
  const [expanded, setExpanded] = useState(false);
  const activeActionTypes = actionTypes.filter((item) => item.active);
  const addButtonId = `${idPrefix}-add-action`;
  const disclosureId = `${idPrefix}-cooking-details`;
  const disclosureSummaryId = `${idPrefix}-cooking-details-summary`;
  const disclosureStatusId = `${idPrefix}-cooking-details-status`;
  const helpId = `${idPrefix}-actions-help`;
  const actionsErrorId = `${idPrefix}-actions-error`;
  const showEditor = expanded || hasErrors;

  useEffect(() => {
    if (!pendingFocusId.current) {
      return;
    }
    document.getElementById(pendingFocusId.current)?.focus();
    pendingFocusId.current = null;
  }, [value]);

  function replaceAction(key: string, action: StructuredActionDraft) {
    onChange(value.map((item) => (item.key === key ? action : item)));
  }

  function addAction() {
    const key = `added-action-${crypto.randomUUID()}`;
    pendingFocusId.current = `${idPrefix}-${key}-type`;
    onChange([...value, createStructuredActionDraft(key)]);
    setAnnouncement(`Added action ${value.length + 1} to ${stepLabel}.`);
  }

  function moveAction(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= value.length) {
      return;
    }
    const next = [...value];
    const [moved] = next.splice(index, 1);
    if (!moved) {
      return;
    }
    next.splice(destination, 0, moved);
    pendingFocusId.current = `${idPrefix}-${moved.key}-type`;
    onChange(next);
    setAnnouncement(
      `Moved ${moved.actionType?.canonical_verb ?? "action"} to position ${destination + 1} of ${next.length}.`,
    );
  }

  function removeAction(index: number) {
    const removed = value[index];
    if (!removed) {
      return;
    }
    const next = value.filter((_, candidateIndex) => candidateIndex !== index);
    const focusAction = next[Math.min(index, next.length - 1)];
    pendingFocusId.current = focusAction
      ? `${idPrefix}-${focusAction.key}-type`
      : addButtonId;
    onChange(next);
    setAnnouncement(
      `Removed ${removed.actionType?.canonical_verb ?? `action ${index + 1}`} from ${stepLabel}.`,
    );
  }

  return (
    <div className="cooking-details">
      <button
        className="cooking-details__disclosure"
        type="button"
        disabled={disabled}
        aria-expanded={showEditor}
        aria-controls={disclosureId}
        aria-label={`${value.length > 0 ? "Edit" : "Add"} cooking details for ${stepLabel}`}
        aria-describedby={`${disclosureSummaryId}${hasErrors ? ` ${disclosureStatusId}` : ""}`}
        onClick={() => {
          if (!hasErrors) {
            setExpanded((current) => !current);
          }
        }}
      >
        <span className="cooking-details__disclosure-copy">
          <strong>{value.length > 0 ? "Cooking details" : "Add cooking details"}</strong>
          <small id={disclosureSummaryId}>
            {cookingDetailsSummary(value, ingredientOccurrences)}
          </small>
        </span>
        <span id={disclosureStatusId} className="cooking-details__disclosure-action">
          {hasErrors ? "Needs attention" : expanded ? "Hide" : value.length > 0 ? "Edit" : "Add"}
        </span>
      </button>
      <div hidden={!showEditor}>
        <fieldset
          id={disclosureId}
          className="structured-action"
          disabled={disabled}
          aria-describedby={`${helpId}${errors.actions ? ` ${actionsErrorId}` : ""}`}
        >
          <legend>Author-added cooking details</legend>
          <p id={helpId} className="structured-action__help">
            These details come only from what you choose here. Recipe Lab does not infer them from
            your written instruction.
          </p>
          <FieldError id={actionsErrorId} message={errors.actions} />
          <ol className="structured-action__list">
        {value.map((action, index) => {
          const actionId = `${idPrefix}-${action.key}`;
          const typeError = errors[structuredActionFieldKey(action.key, "type")];
          const inputError = errors[structuredActionFieldKey(action.key, "inputs")];
          const unavailableType =
            action.actionType &&
            !activeActionTypes.some((item) => item.id === action.actionType?.id)
              ? action.actionType
              : null;
          const selectedIngredientKeys = new Set(action.ingredientKeys);
          const contextLabel = `Action ${index + 1}: ${action.actionType?.canonical_verb ?? "not selected"}`;

          return (
            <li key={action.key}>
              <fieldset className="structured-action__card">
                <legend>Action {index + 1}</legend>
                <div className="structured-action__toolbar">
                  <div className="recipe-form-field structured-action__type">
                    <label htmlFor={`${actionId}-type`}>Cooking action</label>
                    <select
                      id={`${actionId}-type`}
                      value={action.actionType?.id ?? ""}
                      aria-invalid={Boolean(typeError)}
                      aria-describedby={typeError ? `${actionId}-type-error` : undefined}
                      onChange={(event) => {
                        const selected = activeActionTypes.find(
                          (item) => item.id === event.target.value,
                        );
                        replaceAction(action.key, {
                          ...action,
                          actionType: selected ? catalogActionTypeSummary(selected) : null,
                        });
                      }}
                    >
                      <option value="">Choose an action</option>
                      {unavailableType ? (
                        <option value={unavailableType.id} disabled>
                          {unavailableType.canonical_verb} — unavailable
                        </option>
                      ) : null}
                      {activeActionTypes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.canonical_verb}
                        </option>
                      ))}
                    </select>
                    <FieldError id={`${actionId}-type-error`} message={typeError} />
                  </div>
                  <div className="structured-action__order" aria-label={`Reorder action ${index + 1}`}>
                    <button
                      id={`${actionId}-move-up`}
                      className="button button--secondary"
                      type="button"
                      aria-label={`Move up action ${index + 1}`}
                      disabled={index === 0}
                      onClick={() => moveAction(index, -1)}
                    >
                      Move up
                      <span className="visually-hidden"> action {index + 1}</span>
                    </button>
                    <button
                      id={`${actionId}-move-down`}
                      className="button button--secondary"
                      type="button"
                      aria-label={`Move down action ${index + 1}`}
                      disabled={index === value.length - 1}
                      onClick={() => moveAction(index, 1)}
                    >
                      Move down
                      <span className="visually-hidden"> action {index + 1}</span>
                    </button>
                  </div>
                </div>

                <fieldset
                  className="structured-action__inputs"
                  aria-describedby={inputError ? `${actionId}-inputs-error` : undefined}
                >
                  <legend>Ingredient inputs</legend>
                  {ingredientOccurrences.length > 0 ? (
                    <div className="structured-action__input-options">
                      {ingredientOccurrences.map((ingredient) => (
                        <label
                          key={ingredient.key}
                          className={ingredient.removed ? "structured-action__input--removed" : undefined}
                        >
                           <input
                             type="checkbox"
                             checked={selectedIngredientKeys.has(ingredient.key)}
                             disabled={
                               ingredient.removed &&
                               !selectedIngredientKeys.has(ingredient.key)
                             }
                             aria-invalid={Boolean(
                               inputError && selectedIngredientKeys.has(ingredient.key),
                             )}
                            onChange={(event) => {
                              const nextSelected = new Set(action.ingredientKeys);
                              if (event.target.checked) {
                                nextSelected.add(ingredient.key);
                              } else {
                                nextSelected.delete(ingredient.key);
                              }
                              replaceAction(action.key, {
                                ...action,
                                ingredientKeys: ingredientOccurrences
                                  .filter((item) => nextSelected.has(item.key))
                                  .map((item) => item.key),
                              });
                            }}
                          />
                          <span>
                            {ingredient.label}
                            {ingredient.removed ? " — marked for removal" : ""}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="structured-action__empty-inputs">No ingredient rows are available.</p>
                  )}
                  <FieldError id={`${actionId}-inputs-error`} message={inputError} />
                </fieldset>

                <div className="structured-action__parameters">
                  <div>
                    <label className="structured-action__parameter-toggle">
                      <input
                        type="checkbox"
                        checked={action.duration.enabled}
                        onChange={(event) =>
                          replaceAction(action.key, {
                            ...action,
                            duration: { ...action.duration, enabled: event.target.checked },
                          })
                        }
                      />
                      <span>Include duration</span>
                    </label>
                    {action.duration.enabled ? (
                      <DurationMeasureControl
                        idPrefix={`${actionId}-duration`}
                        label="Duration"
                        contextLabel={contextLabel}
                        value={action.duration.value}
                        units={measurementUnits}
                        errors={measureErrors(errors, action.key, "duration")}
                        onChange={(measure) =>
                          replaceAction(action.key, {
                            ...action,
                            duration: { enabled: true, value: measure },
                          })
                        }
                      />
                    ) : null}
                  </div>
                  <div>
                    <label className="structured-action__parameter-toggle">
                      <input
                        type="checkbox"
                        checked={action.temperature.enabled}
                        onChange={(event) =>
                          replaceAction(action.key, {
                            ...action,
                            temperature: {
                              ...action.temperature,
                              enabled: event.target.checked,
                            },
                          })
                        }
                      />
                      <span>Include temperature</span>
                    </label>
                    {action.temperature.enabled ? (
                      <TemperatureMeasureControl
                        idPrefix={`${actionId}-temperature`}
                        label="Temperature"
                        contextLabel={contextLabel}
                        value={action.temperature.value}
                        units={measurementUnits}
                        errors={measureErrors(errors, action.key, "temperature")}
                        onChange={(measure) =>
                          replaceAction(action.key, {
                            ...action,
                            temperature: { enabled: true, value: measure },
                          })
                        }
                      />
                    ) : null}
                  </div>
                </div>

                <button
                  className="button button--quiet structured-action__remove"
                  type="button"
                  onClick={() => removeAction(index)}
                >
                  Remove action {index + 1}
                </button>
              </fieldset>
            </li>
          );
        })}
          </ol>
          <button
            id={addButtonId}
            className="button button--secondary"
            type="button"
            disabled={disabled || value.length >= MAX_STRUCTURED_ACTIONS_PER_INSTRUCTION}
            onClick={addAction}
          >
            Add cooking action
          </button>
        </fieldset>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
