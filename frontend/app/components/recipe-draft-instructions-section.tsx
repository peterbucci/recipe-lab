"use client";

import type { CatalogActionType } from "../../lib/cooking-action-api";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import {
  draftInstructionActionFieldKey,
  draftInstructionFieldKey,
  type RecipeDraftInstructionState,
} from "../../lib/recipe-draft";
import type { IngredientOccurrenceOption } from "../../lib/structured-action";
import { RecipeDraftFieldError } from "./recipe-draft-field-error";
import { StructuredActionEditor } from "./structured-action-editor";

interface RecipeDraftInstructionsSectionProps {
  actionTypes: readonly CatalogActionType[];
  disabled: boolean;
  errors: Readonly<Record<string, string>>;
  ingredientOptions: readonly IngredientOccurrenceOption[];
  instructions: readonly RecipeDraftInstructionState[];
  measurementUnits: readonly CatalogUnit[];
  onAdd: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onReplace: (key: string, instruction: RecipeDraftInstructionState) => void;
}

function instructionActionErrors(
  errors: Readonly<Record<string, string>>,
  key: string,
): Record<string, string> {
  const prefix = draftInstructionActionFieldKey(key, "");
  return Object.fromEntries(
    Object.entries(errors).flatMap(([field, message]) =>
      field.startsWith(prefix) ? [[field.slice(prefix.length), message]] : [],
    ),
  );
}

export function RecipeDraftInstructionsSection({
  actionTypes,
  disabled,
  errors,
  ingredientOptions,
  instructions,
  measurementUnits,
  onAdd,
  onMove,
  onRemove,
  onReplace,
}: RecipeDraftInstructionsSectionProps) {
  return (
    <fieldset className="draft-editor__section" disabled={disabled}>
      <legend>Instructions</legend>
      <p className="draft-editor__help">
        Write each step as you would explain it to another cook. You can privately save your draft
        before adding cooking details.
      </p>
      <ol className="draft-editor__rows">
        {instructions.map((instruction, index) => {
          const textError = errors[draftInstructionFieldKey(instruction.key)];
          const rowLabel = `Step ${index + 1}`;
          return (
            <li key={instruction.key} className="draft-editor__row-card">
              <fieldset>
                <legend>{rowLabel}</legend>
                <div
                  className="draft-editor__row-toolbar"
                  aria-label={`Reorder ${rowLabel.toLowerCase()}`}
                >
                  <button
                    id={`draft-${instruction.key}-instruction-move-up`}
                    className="button button--quiet"
                    type="button"
                    disabled={index === 0}
                    onClick={() => onMove(index, -1)}
                  >
                    Move up
                    <span className="visually-hidden"> {rowLabel.toLowerCase()}</span>
                  </button>
                  <button
                    id={`draft-${instruction.key}-instruction-move-down`}
                    className="button button--quiet"
                    type="button"
                    disabled={index === instructions.length - 1}
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
                <div className="recipe-form-field">
                  <label htmlFor={`draft-${instruction.key}-instruction-text`}>
                    Instruction
                  </label>
                  <textarea
                    id={`draft-${instruction.key}-instruction-text`}
                    value={instruction.text}
                    maxLength={5000}
                    rows={4}
                    aria-invalid={Boolean(textError)}
                    aria-describedby={
                      textError ? `draft-${instruction.key}-instruction-text-error` : undefined
                    }
                    onChange={(event) =>
                      onReplace(instruction.key, { ...instruction, text: event.target.value })
                    }
                  />
                  <RecipeDraftFieldError
                    id={`draft-${instruction.key}-instruction-text-error`}
                    message={textError}
                  />
                </div>
                <StructuredActionEditor
                  idPrefix={`draft-${instruction.key}-actions`}
                  stepLabel={rowLabel}
                  value={instruction.actions}
                  actionTypes={actionTypes}
                  ingredientOccurrences={ingredientOptions}
                  measurementUnits={measurementUnits}
                  errors={instructionActionErrors(errors, instruction.key)}
                  onChange={(actions) =>
                    onReplace(instruction.key, { ...instruction, actions })
                  }
                />
              </fieldset>
            </li>
          );
        })}
      </ol>
      <button
        id="draft-add-instruction"
        className="button button--secondary"
        type="button"
        disabled={instructions.length >= 100}
        onClick={onAdd}
      >
        Add instruction
      </button>
    </fieldset>
  );
}
