"use client";

import type { CatalogIngredientSelection } from "../../lib/ingredient-catalog-api";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import {
  draftIngredientFieldKey,
  draftIngredientMeasureFieldKey,
  requestSelectionFromSubmission,
  type RecipeDraftIngredientState,
} from "../../lib/recipe-draft";
import type { StructuredMeasureField } from "../../lib/structured-measure";
import { IngredientAmountControl } from "./ingredient-amount-control";
import { IngredientCatalogPicker } from "./ingredient-catalog-picker";
import { RecipeDraftFieldError } from "./recipe-draft-field-error";

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
  const fields: StructuredMeasureField[] = ["mode", "amount", "minimum", "maximum", "unit"];
  return Object.fromEntries(
    fields.flatMap((field) => {
      const message = errors[draftIngredientMeasureFieldKey(key, field)];
      return message ? [[field, message]] : [];
    }),
  );
}

function requestStatusLabel(status: string): string {
  if (status === "approved") return "Approved";
  if (status === "duplicate") return "Matched to catalog";
  if (status === "rejected") return "Not approved";
  return "Awaiting curator review";
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
  return (
    <fieldset className="draft-editor__section" disabled={disabled}>
      <legend>Ingredients</legend>
      <p className="draft-editor__help">
        Use trusted catalog identities. A submitted request stays unresolved until you explicitly
        choose its approved catalog result.
      </p>
      <ol className="draft-editor__rows">
        {ingredients.map((ingredient, index) => {
          const selectionError = errors[draftIngredientFieldKey(ingredient.key, "selection")];
          const notesError = errors[
            draftIngredientFieldKey(ingredient.key, "preparationNotes")
          ];
          const resolved =
            ingredient.selection?.kind === "request"
              ? ingredient.selection.request.resolved_ingredient
              : null;
          const catalogValue =
            ingredient.selection?.kind === "catalog" ? ingredient.selection.ingredient : null;
          const rowLabel = `Ingredient ${index + 1}`;
          return (
            <li key={ingredient.key} className="draft-editor__row-card">
              <fieldset>
                <legend>{rowLabel}</legend>
                <div
                  className="draft-editor__row-toolbar"
                  aria-label={`Reorder ${rowLabel.toLowerCase()}`}
                >
                  <button
                    id={`draft-${ingredient.key}-ingredient-move-up`}
                    className="button button--quiet"
                    type="button"
                    disabled={index === 0}
                    onClick={() => onMove(index, -1)}
                  >
                    Move up
                    <span className="visually-hidden"> {rowLabel.toLowerCase()}</span>
                  </button>
                  <button
                    id={`draft-${ingredient.key}-ingredient-move-down`}
                    className="button button--quiet"
                    type="button"
                    disabled={index === ingredients.length - 1}
                    onClick={() => onMove(index, 1)}
                  >
                    Move down
                    <span className="visually-hidden"> {rowLabel.toLowerCase()}</span>
                  </button>
                  <button
                    className="button button--quiet"
                    type="button"
                    aria-label={`Remove ${rowLabel.toLowerCase()}`}
                    onClick={() => onRemove(index)}
                  >
                    Remove
                    <span className="visually-hidden"> {rowLabel.toLowerCase()}</span>
                  </button>
                </div>
                {ingredient.selection?.kind === "request" ? (
                  <aside
                    className="draft-request-selection"
                    aria-label={`Unresolved selection for ${rowLabel}`}
                  >
                    <span>{requestStatusLabel(ingredient.selection.request.status)}</span>
                    <strong>{ingredient.selection.request.proposed_name}</strong>
                    <p>
                      {resolved
                        ? `Curators resolved this request to ${resolved.canonical_name}. Choose it to make this a trusted ingredient.`
                        : "This request text is not a trusted catalog ingredient and cannot be used as a structured action input."}
                    </p>
                    <div className="button-row">
                      {resolved ? (
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() =>
                            onReplace(ingredient.key, {
                              ...ingredient,
                              selection: {
                                kind: "catalog",
                                ingredient: {
                                  ingredientId: resolved.id,
                                  canonicalName: resolved.canonical_name,
                                  displayName: resolved.canonical_name,
                                },
                              },
                            })
                          }
                        >
                          Use {resolved.canonical_name}
                        </button>
                      ) : null}
                      <button
                        className="button button--quiet"
                        type="button"
                        onClick={() =>
                          onReplace(ingredient.key, { ...ingredient, selection: null })
                        }
                      >
                        Choose a different ingredient
                      </button>
                    </div>
                  </aside>
                ) : null}
                <div className="draft-editor__ingredient-fields">
                  <IngredientAmountControl
                    idPrefix={`draft-${ingredient.key}-measure`}
                    label="Amount"
                    contextLabel={rowLabel}
                    value={ingredient.measure}
                    units={measurementUnits}
                    disabled={disabled}
                    errors={ingredientMeasureErrors(errors, ingredient.key)}
                    onChange={(measure) =>
                      onReplace(ingredient.key, { ...ingredient, measure })
                    }
                  />
                  <div>
                    <IngredientCatalogPicker
                      idPrefix={`draft-${ingredient.key}-ingredient`}
                      label="Ingredient"
                      contextLabel={rowLabel}
                      value={catalogValue}
                      disabled={disabled}
                      invalid={Boolean(selectionError)}
                      describedBy={
                        selectionError ? `draft-${ingredient.key}-selection-error` : undefined
                      }
                      onChange={(selection: CatalogIngredientSelection | null) =>
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
                  <div className="recipe-form-field">
                    <label htmlFor={`draft-${ingredient.key}-notes`}>
                      Note <span>(optional)</span>
                    </label>
                    <input
                      id={`draft-${ingredient.key}-notes`}
                      value={ingredient.preparationNotes}
                      maxLength={1000}
                      aria-invalid={Boolean(notesError)}
                      aria-describedby={
                        notesError ? `draft-${ingredient.key}-notes-error` : undefined
                      }
                      placeholder="finely chopped"
                      onChange={(event) =>
                        onReplace(ingredient.key, {
                          ...ingredient,
                          preparationNotes: event.target.value,
                        })
                      }
                    />
                    <RecipeDraftFieldError
                      id={`draft-${ingredient.key}-notes-error`}
                      message={notesError}
                    />
                  </div>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      <button
        id="draft-add-ingredient"
        className="button button--secondary"
        type="button"
        disabled={ingredients.length >= 200}
        onClick={onAdd}
      >
        Add ingredient
      </button>
    </fieldset>
  );
}
