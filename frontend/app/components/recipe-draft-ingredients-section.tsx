"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useRef,
  useState,
} from "react";

import type { CatalogIngredientSelection } from "../../lib/ingredient-catalog-api";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import {
  draftIngredientFieldKey,
  draftIngredientMeasureFieldKey,
  requestSelectionFromSubmission,
  type RecipeDraftIngredientState,
} from "../../lib/recipe-draft";
import type { StructuredMeasureField } from "../../lib/structured-measure";
import { EditorRowIcon } from "./editor-row-icon";
import { IngredientAmountControl } from "./ingredient-amount-control";
import { IngredientCatalogPicker } from "./ingredient-catalog-picker";
import { Popover, PopoverContent, PopoverTrigger } from "./overlay-primitives";
import { RecipeDraftFieldError } from "./recipe-draft-field-error";
import { useFloatingPanelPlacement } from "./use-floating-panel-placement";

interface RecipeDraftIngredientsSectionProps {
  disabled: boolean;
  errors: Readonly<Record<string, string>>;
  ingredients: readonly RecipeDraftIngredientState[];
  measurementUnits: readonly CatalogUnit[];
  onAdd: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onReplace: (key: string, ingredient: RecipeDraftIngredientState) => void;
}

function ingredientMeasureErrors(
  errors: Readonly<Record<string, string>>,
  key: string,
): Partial<Record<StructuredMeasureField, string>> {
  const fields: StructuredMeasureField[] = [
    "mode",
    "amount",
    "minimum",
    "maximum",
    "unit",
  ];
  return Object.fromEntries(
    fields.flatMap((field) => {
      const message = errors[draftIngredientMeasureFieldKey(key, field)];
      return message ? [[field, message]] : [];
    }),
  );
}

export function RecipeDraftIngredientsSection({
  disabled,
  errors,
  ingredients,
  measurementUnits,
  onAdd,
  onMove,
  onRemove,
  onReplace,
}: RecipeDraftIngredientsSectionProps) {
  const [openSettingsKey, setOpenSettingsKey] = useState<string | null>(null);
  const [enabledNoteKeys, setEnabledNoteKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsPlacement = useFloatingPanelPlacement({
    contentKey: openSettingsKey,
    open: Boolean(openSettingsKey),
    panelRef: settingsMenuRef,
    triggerRef: settingsTriggerRef,
  });

  function handleSettingsMenuKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const items = Array.from(
      settingsMenuRef.current?.querySelectorAll<HTMLElement>(
        '[role^="menuitem"]',
      ) ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (activeIndex - 1 + items.length) % items.length
            : (activeIndex + 1) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <fieldset
      className="draft-editor__section ingredient-panel recipe-workspace__ingredients"
      disabled={disabled}
    >
      <legend className="visually-hidden">Ingredients</legend>
      <div className="section-heading section-heading--compact">
        <div>
          <h2>Ingredients</h2>
        </div>
        <span>{ingredients.length} items</span>
      </div>
      <ol className="draft-editor__rows draft-editor__rows--ingredients recipe-workspace__ingredient-list">
        {ingredients.map((ingredient, index) => {
          const selectionError =
            errors[draftIngredientFieldKey(ingredient.key, "selection")];
          const notesError =
            errors[draftIngredientFieldKey(ingredient.key, "preparationNotes")];
          const catalogValue =
            ingredient.selection?.kind === "catalog"
              ? ingredient.selection.ingredient
              : null;
          const requestValue =
            ingredient.selection?.kind === "request"
              ? ingredient.selection.request
              : null;
          const rowLabel = `Ingredient ${index + 1}`;
          const settingsOpen = openSettingsKey === ingredient.key;
          const noteVisible =
            enabledNoteKeys.has(ingredient.key) ||
            ingredient.preparationNotes.trim().length > 0;
          const settingsId = `draft-${ingredient.key}-ingredient-settings`;
          const settingsMenuId = `${settingsId}-menu`;
          const noteId = `draft-${ingredient.key}-notes`;
          return (
            <li
              key={ingredient.key}
              className="draft-editor__row-card draft-editor__row-card--ingredient recipe-workspace__ingredient-row"
            >
              <fieldset className="draft-editor__row-content">
                <legend className="visually-hidden">{rowLabel}</legend>
                <div className="recipe-workspace__ingredient-line">
                  <IngredientAmountControl
                    idPrefix={`draft-${ingredient.key}-measure`}
                    label="Amount"
                    contextLabel={rowLabel}
                    presentation="popover"
                    value={ingredient.measure}
                    units={measurementUnits}
                    disabled={disabled}
                    errors={ingredientMeasureErrors(errors, ingredient.key)}
                    onChange={(measure) =>
                      onReplace(ingredient.key, { ...ingredient, measure })
                    }
                  />
                  <div className="recipe-workspace__ingredient-name">
                    <IngredientCatalogPicker
                      idPrefix={`draft-${ingredient.key}-ingredient`}
                      inputClassName="recipe-workspace__editable-text"
                      label="Ingredient"
                      contextLabel={rowLabel}
                      value={catalogValue}
                      requestValue={requestValue}
                      disabled={disabled}
                      invalid={Boolean(selectionError)}
                      describedBy={
                        selectionError
                          ? `draft-${ingredient.key}-selection-error`
                          : undefined
                      }
                      onChange={(
                        selection: CatalogIngredientSelection | null,
                      ) =>
                        onReplace(ingredient.key, {
                          ...ingredient,
                          selection: selection
                            ? { kind: "catalog", ingredient: selection }
                            : null,
                        })
                      }
                      onRequestSubmitted={(request) =>
                        onReplace(ingredient.key, {
                          ...ingredient,
                          selection: requestSelectionFromSubmission(request),
                        })
                      }
                    />
                    <RecipeDraftFieldError
                      id={`draft-${ingredient.key}-selection-error`}
                      message={selectionError}
                    />
                  </div>
                  <div
                    className="recipe-workspace__ingredient-actions"
                    aria-label={`Arrange ${rowLabel.toLowerCase()}`}
                  >
                    <button
                      id={`draft-${ingredient.key}-ingredient-move-up`}
                      className="recipe-workspace__ingredient-icon"
                      type="button"
                      aria-label={`Move ${rowLabel.toLowerCase()} up`}
                      disabled={index === 0}
                      onClick={() => onMove(index, -1)}
                    >
                      <EditorRowIcon kind="up" />
                    </button>
                    <button
                      id={`draft-${ingredient.key}-ingredient-move-down`}
                      className="recipe-workspace__ingredient-icon"
                      type="button"
                      aria-label={`Move ${rowLabel.toLowerCase()} down`}
                      disabled={index === ingredients.length - 1}
                      onClick={() => onMove(index, 1)}
                    >
                      <EditorRowIcon kind="down" />
                    </button>
                    <div
                      className="recipe-workspace__ingredient-settings"
                    >
                      <Popover
                        closeOnFocusOutside
                        open={settingsOpen}
                        onOpenChange={(nextOpen) =>
                          setOpenSettingsKey(nextOpen ? ingredient.key : null)
                        }
                      >
                        <PopoverTrigger
                          ref={settingsOpen ? settingsTriggerRef : undefined}
                          contentId={settingsMenuId}
                          id={settingsId}
                          className="recipe-workspace__ingredient-icon"
                          aria-label={`${rowLabel} options`}
                          aria-haspopup="menu"
                        >
                          <EditorRowIcon kind="menu" />
                        </PopoverTrigger>
                        <PopoverContent
                          ref={settingsMenuRef}
                          id={settingsMenuId}
                          className="recipe-workspace__ingredient-settings-menu"
                          role="menu"
                          aria-label={`${rowLabel} options`}
                          data-placement={settingsPlacement.placement}
                          style={settingsPlacement.style}
                          initialFocus="first"
                          onKeyDown={handleSettingsMenuKeyDown}
                        >
                          <button
                            className="recipe-workspace__ingredient-settings-item"
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={noteVisible}
                            aria-label={`Show note for ${rowLabel.toLowerCase()}`}
                            onClick={() => {
                              const nextVisible = !noteVisible;
                              const trigger = settingsTriggerRef.current;
                              setEnabledNoteKeys((current) => {
                                const next = new Set(current);
                                if (nextVisible) {
                                  next.add(ingredient.key);
                                } else {
                                  next.delete(ingredient.key);
                                }
                                return next;
                              });
                              setOpenSettingsKey(null);
                              if (
                                !nextVisible &&
                                ingredient.preparationNotes.length > 0
                              ) {
                                onReplace(ingredient.key, {
                                  ...ingredient,
                                  preparationNotes: "",
                                });
                              }
                              window.setTimeout(() => {
                                if (nextVisible) {
                                  document.getElementById(noteId)?.focus();
                                } else {
                                  trigger?.focus();
                                }
                              }, 0);
                            }}
                          >
                            <span>Show note</span>
                            <span
                              className="recipe-workspace__ingredient-settings-toggle"
                              aria-hidden="true"
                            >
                              <span />
                            </span>
                          </button>
                          <button
                            className="recipe-workspace__ingredient-settings-item recipe-workspace__ingredient-settings-item--danger"
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              const trigger = settingsTriggerRef.current;
                              setOpenSettingsKey(null);
                              onRemove(index);
                              window.setTimeout(() => {
                                if (trigger && document.contains(trigger)) {
                                  trigger.focus();
                                }
                              }, 0);
                            }}
                          >
                            Delete ingredient
                          </button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>

                {noteVisible ? (
                  <div
                    id={`draft-${ingredient.key}-note-panel`}
                    className="recipe-workspace__ingredient-note"
                  >
                    <label className="visually-hidden" htmlFor={noteId}>
                      Note for {rowLabel.toLowerCase()} (optional)
                    </label>
                    <input
                      id={noteId}
                      className="recipe-workspace__editable-text"
                      value={ingredient.preparationNotes}
                      maxLength={1000}
                      aria-invalid={Boolean(notesError)}
                      aria-describedby={
                        notesError
                          ? `draft-${ingredient.key}-notes-error`
                          : undefined
                      }
                      placeholder="Note (optional)"
                      onChange={(event) => {
                        setEnabledNoteKeys((current) =>
                          current.has(ingredient.key)
                            ? current
                            : new Set(current).add(ingredient.key),
                        );
                        onReplace(ingredient.key, {
                          ...ingredient,
                          preparationNotes: event.target.value,
                        });
                      }}
                    />
                    <RecipeDraftFieldError
                      id={`draft-${ingredient.key}-notes-error`}
                      message={notesError}
                    />
                  </div>
                ) : null}
              </fieldset>
            </li>
          );
        })}
      </ol>
      <button
        id="draft-add-ingredient"
        className="draft-editor__add-row draft-editor__add-row--ingredient recipe-workspace__add-row"
        type="button"
        disabled={ingredients.length >= 200}
        onClick={onAdd}
      >
        Add ingredient
      </button>
    </fieldset>
  );
}
