"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
import type { StructuredMeasureField } from "../../lib/structured-measure";
import { EditorRowIcon } from "./editor-row-icon";
import {
  draftActionMeasureLabel,
  recipeActionLabel,
} from "./recipe-instruction-actions";
import {
  DurationMeasureControl,
  TemperatureMeasureControl,
} from "./structured-measure-control";
import { useFloatingPanelPlacement } from "./use-floating-panel-placement";

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
  const fields: StructuredMeasureField[] = [
    "mode",
    "amount",
    "minimum",
    "maximum",
    "unit",
  ];
  return Object.fromEntries(
    fields.flatMap((measureField) => {
      const message =
        errors[structuredActionFieldKey(actionKey, field, measureField)];
      return message ? [[measureField, message]] : [];
    }),
  );
}

function ingredientSummary(
  keys: readonly string[],
  ingredientOccurrences: readonly IngredientOccurrenceOption[],
): string | null {
  const selected = keys.flatMap((key) => {
    const ingredient = ingredientOccurrences.find((item) => item.key === key);
    return ingredient
      ? [ingredient.label.replace(/^Ingredient \d+:\s*/, "")]
      : [];
  });
  if (selected.length === 0) {
    return null;
  }
  return selected.length === 1 ? selected[0] : `${selected.length} ingredients`;
}

function detailTitle(action: StructuredActionDraft): string {
  const verb = action.actionType?.canonical_verb.trim() ?? "";
  return verb ? recipeActionLabel(verb) : "Choose cooking detail";
}

function detailSummary(
  action: StructuredActionDraft,
  ingredientOccurrences: readonly IngredientOccurrenceOption[],
): string {
  const parts = [
    ingredientSummary(action.ingredientKeys, ingredientOccurrences),
    draftActionMeasureLabel(action.duration),
    draftActionMeasureLabel(action.temperature),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0
    ? parts.join(" \u00b7 ")
    : "Choose ingredients, time, or temperature if they apply.";
}

function actionHasErrors(
  errors: Readonly<Record<string, string>>,
  actionKey: string,
): boolean {
  const prefix = `${actionKey}.`;
  return Object.entries(errors).some(
    ([field, message]) => Boolean(message) && field.startsWith(prefix),
  );
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
  const activePopoverRef = useRef<HTMLDivElement>(null);
  const activeTriggerRef = useRef<HTMLButtonElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const [openActionKey, setOpenActionKey] = useState<string | null>(null);
  const activeActionTypes = actionTypes.filter((item) => item.active);
  const addButtonId = `${idPrefix}-add-action`;
  const actionsErrorId = `${idPrefix}-actions-error`;
  const firstErrorActionKey = useMemo(
    () =>
      value.find((action) => actionHasErrors(errors, action.key))?.key ??
      (errors.actions && value[0] ? value[0].key : null),
    [errors, value],
  );
  const visibleActionKey = openActionKey ?? firstErrorActionKey;
  const popoverPlacement = useFloatingPanelPlacement({
    contentKey: visibleActionKey,
    open: Boolean(visibleActionKey),
    panelRef: activePopoverRef,
    triggerRef: activeTriggerRef,
  });

  useEffect(() => {
    if (!pendingFocusId.current) {
      return;
    }
    document.getElementById(pendingFocusId.current)?.focus();
    pendingFocusId.current = null;
  }, [value, visibleActionKey]);

  useEffect(() => {
    if (!visibleActionKey) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const popover = activePopoverRef.current;
      const trigger = activeTriggerRef.current;
      if (!popover?.contains(target) && !trigger?.contains(target)) {
        setOpenActionKey(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setOpenActionKey(null);
      document
        .getElementById(`${idPrefix}-${visibleActionKey}-trigger`)
        ?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [idPrefix, visibleActionKey]);

  function replaceAction(key: string, action: StructuredActionDraft) {
    onChange(value.map((item) => (item.key === key ? action : item)));
  }

  function addAction() {
    const key = `added-action-${crypto.randomUUID()}`;
    pendingFocusId.current = `${idPrefix}-${key}-type`;
    setOpenActionKey(key);
    onChange([...value, createStructuredActionDraft(key)]);
    setAnnouncement(
      `Added cooking detail ${value.length + 1} to ${stepLabel}.`,
    );
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
    onChange(next);
    setAnnouncement(
      `Moved ${detailTitle(moved)} to position ${destination + 1} of ${next.length}.`,
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
      ? `${idPrefix}-${focusAction.key}-trigger`
      : addButtonId;
    if (openActionKey === removed.key) {
      setOpenActionKey(null);
    }
    onChange(next);
    setAnnouncement(`Removed ${detailTitle(removed)} from ${stepLabel}.`);
  }

  return (
    <div className="cooking-details draft-editor__cooking-details">
      <ol
        className="cooking-details__list"
        aria-label={`Cooking details for ${stepLabel}`}
      >
        {value.map((action, index) => {
          const actionId = `${idPrefix}-${action.key}`;
          const typeError =
            errors[structuredActionFieldKey(action.key, "type")];
          const inputError =
            errors[structuredActionFieldKey(action.key, "inputs")];
          const unavailableType =
            action.actionType &&
            !activeActionTypes.some((item) => item.id === action.actionType?.id)
              ? action.actionType
              : null;
          const selectedIngredientKeys = new Set(action.ingredientKeys);
          const contextLabel = `Cooking detail ${index + 1}: ${
            action.actionType?.canonical_verb ?? "not selected"
          }`;
          const hasActionErrors = actionHasErrors(errors, action.key);
          const statusId = `${actionId}-status`;
          const popoverId = `${actionId}-popover`;
          const isOpen = visibleActionKey === action.key;

          return (
            <li key={action.key} className="cooking-details__row">
              <button
                ref={isOpen ? activeTriggerRef : undefined}
                id={`${actionId}-trigger`}
                className="cooking-details__trigger"
                type="button"
                disabled={disabled}
                aria-expanded={isOpen}
                aria-controls={popoverId}
                aria-describedby={hasActionErrors ? statusId : undefined}
                aria-label={`Edit cooking detail ${index + 1} for ${stepLabel}`}
                data-invalid={hasActionErrors || undefined}
                onClick={() => {
                  const nextKey = isOpen ? null : action.key;
                  setOpenActionKey(nextKey);
                  if (nextKey) {
                    pendingFocusId.current = `${actionId}-type`;
                  }
                }}
              >
                <strong>{detailTitle(action)}</strong>
                <small>{detailSummary(action, ingredientOccurrences)}</small>
              </button>
              <span id={statusId} className="visually-hidden">
                {hasActionErrors ? "This cooking detail needs attention." : ""}
              </span>
              <div
                className="cooking-details__actions"
                aria-label={`Arrange cooking detail ${index + 1}`}
              >
                <button
                  className="recipe-workspace__ingredient-icon"
                  type="button"
                  aria-label={`Move cooking detail ${index + 1} up`}
                  disabled={disabled || index === 0}
                  onClick={() => moveAction(index, -1)}
                >
                  <EditorRowIcon kind="up" />
                </button>
                <button
                  className="recipe-workspace__ingredient-icon"
                  type="button"
                  aria-label={`Move cooking detail ${index + 1} down`}
                  disabled={disabled || index === value.length - 1}
                  onClick={() => moveAction(index, 1)}
                >
                  <EditorRowIcon kind="down" />
                </button>
                <button
                  className="recipe-workspace__ingredient-icon"
                  type="button"
                  aria-label={`Remove cooking detail ${index + 1}`}
                  disabled={disabled}
                  onClick={() => removeAction(index)}
                >
                  <EditorRowIcon kind="remove" />
                </button>
              </div>

              {isOpen ? (
                <div
                  ref={activePopoverRef}
                  id={popoverId}
                  className="cooking-details__popover"
                  role="dialog"
                  data-placement={popoverPlacement.placement}
                  style={popoverPlacement.style}
                  aria-label={`Cooking detail ${index + 1} for ${stepLabel}`}
                >
                  <fieldset
                    className="structured-action cooking-details__form"
                    disabled={disabled}
                  >
                    <legend className="visually-hidden">
                      Cooking detail {index + 1} for {stepLabel}
                    </legend>
                    <p className="cooking-details__help">
                      Choose an action from the cooking breakdown, then add only
                      the ingredients, time, or temperature that apply.
                    </p>
                    <div className="recipe-form-field structured-action__type">
                      <label htmlFor={`${actionId}-type`}>Cooking action</label>
                      <select
                        id={`${actionId}-type`}
                        value={action.actionType?.id ?? ""}
                        aria-invalid={Boolean(typeError)}
                        aria-describedby={
                          typeError ? `${actionId}-type-error` : undefined
                        }
                        onChange={(event) => {
                          const selected = activeActionTypes.find(
                            (item) => item.id === event.target.value,
                          );
                          replaceAction(action.key, {
                            ...action,
                            actionType: selected
                              ? catalogActionTypeSummary(selected)
                              : null,
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
                      <FieldError
                        id={`${actionId}-type-error`}
                        message={typeError}
                      />
                    </div>

                    <fieldset
                      className="structured-action__inputs"
                      aria-describedby={
                        inputError ? `${actionId}-inputs-error` : undefined
                      }
                    >
                      <legend>Ingredient inputs</legend>
                      {ingredientOccurrences.length > 0 ? (
                        <div className="structured-action__input-options">
                          {ingredientOccurrences.map((ingredient) => (
                            <label
                              key={ingredient.key}
                              className={
                                ingredient.removed
                                  ? "structured-action__input--removed"
                                  : undefined
                              }
                            >
                              <input
                                type="checkbox"
                                checked={selectedIngredientKeys.has(
                                  ingredient.key,
                                )}
                                disabled={
                                  ingredient.removed &&
                                  !selectedIngredientKeys.has(ingredient.key)
                                }
                                aria-invalid={Boolean(
                                  inputError &&
                                  selectedIngredientKeys.has(ingredient.key),
                                )}
                                onChange={(event) => {
                                  const nextSelected = new Set(
                                    action.ingredientKeys,
                                  );
                                  if (event.target.checked) {
                                    nextSelected.add(ingredient.key);
                                  } else {
                                    nextSelected.delete(ingredient.key);
                                  }
                                  replaceAction(action.key, {
                                    ...action,
                                    ingredientKeys: ingredientOccurrences
                                      .filter((item) =>
                                        nextSelected.has(item.key),
                                      )
                                      .map((item) => item.key),
                                  });
                                }}
                              />
                              <span>
                                {ingredient.label}
                                {ingredient.removed
                                  ? " — marked for removal"
                                  : ""}
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="structured-action__empty-inputs">
                          No ingredient rows are available.
                        </p>
                      )}
                      <FieldError
                        id={`${actionId}-inputs-error`}
                        message={inputError}
                      />
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
                                duration: {
                                  ...action.duration,
                                  enabled: event.target.checked,
                                },
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
                            errors={measureErrors(
                              errors,
                              action.key,
                              "duration",
                            )}
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
                            errors={measureErrors(
                              errors,
                              action.key,
                              "temperature",
                            )}
                            onChange={(measure) =>
                              replaceAction(action.key, {
                                ...action,
                                temperature: {
                                  enabled: true,
                                  value: measure,
                                },
                              })
                            }
                          />
                        ) : null}
                      </div>
                    </div>
                  </fieldset>
                  <div className="cooking-details__popover-actions">
                    <button
                      className="button button--quiet"
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setOpenActionKey(null);
                        document.getElementById(`${actionId}-trigger`)?.focus();
                      }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <FieldError id={actionsErrorId} message={errors.actions} />
      <button
        id={addButtonId}
        className="cooking-details__add"
        type="button"
        aria-label={`Add cooking detail to ${stepLabel}`}
        disabled={
          disabled || value.length >= MAX_STRUCTURED_ACTIONS_PER_INSTRUCTION
        }
        onClick={addAction}
      >
        Add cooking detail
        <span className="visually-hidden"> to {stepLabel}</span>
      </button>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
