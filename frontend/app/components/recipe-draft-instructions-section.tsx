"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { CatalogActionType } from "../../lib/cooking-action-api";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import {
  draftInstructionActionFieldKey,
  draftInstructionFieldKey,
  draftInstructionTitleFieldKey,
  type RecipeDraftInstructionState,
} from "../../lib/recipe-draft";
import type { IngredientOccurrenceOption } from "../../lib/structured-action";
import { EditorRowIcon } from "./editor-row-icon";
import { RecipeDraftFieldError } from "./recipe-draft-field-error";
import {
  RecipeInstructionFactPills,
  recipeDraftStepFacts,
} from "./recipe-instruction-actions";
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

type InstructionView = "steps" | "breakdown";

const VIEWS: readonly InstructionView[] = ["steps", "breakdown"];

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

function nextViewForKey(
  current: InstructionView,
  event: KeyboardEvent<HTMLButtonElement>,
): InstructionView | null {
  const index = VIEWS.indexOf(current);
  if (event.key === "ArrowRight") {
    return VIEWS[(index + 1) % VIEWS.length] ?? null;
  }
  if (event.key === "ArrowLeft") {
    return VIEWS[(index - 1 + VIEWS.length) % VIEWS.length] ?? null;
  }
  if (event.key === "Home") {
    return VIEWS[0] ?? null;
  }
  if (event.key === "End") {
    return VIEWS.at(-1) ?? null;
  }
  return null;
}

function AutoSizeInstructionTextarea({
  describedBy,
  id,
  invalid,
  onChange,
  value,
}: {
  describedBy?: string;
  id: string;
  invalid: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const resize = () => {
      textarea.style.height = "0px";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      id={id}
      className="recipe-workspace__editable-text"
      value={value}
      maxLength={5000}
      rows={1}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={onChange}
    />
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
  const [view, setView] = useState<InstructionView>("steps");
  const hasActionErrors = instructions.some(
    (instruction) =>
      Object.keys(instructionActionErrors(errors, instruction.key)).length > 0,
  );
  const visibleView = hasActionErrors ? "breakdown" : view;

  function selectView(next: InstructionView, focus = false) {
    setView(next);
    if (focus) {
      requestAnimationFrame(() => {
        document.getElementById(`draft-instructions-${next}-tab`)?.focus();
      });
    }
  }

  return (
    <fieldset
      className="draft-editor__section instruction-panel recipe-instructions recipe-workspace__instructions"
      disabled={disabled}
    >
      <legend className="visually-hidden">Instructions</legend>
      <header className="recipe-instructions__header recipe-workspace__instructions-header">
        <div className="recipe-instructions__heading-copy">
          <div className="section-heading section-heading--compact">
            <h2>Instructions</h2>
          </div>
          <p aria-live="polite">
            {visibleView === "steps"
              ? "Write the recipe as clear, human-readable steps."
              : "Add structured cooking details using Recipe Lab’s curated breakdown."}
          </p>
        </div>
        <div
          className="recipe-instructions__view-switch"
          role="tablist"
          aria-label="Instruction editing view"
        >
          {VIEWS.map((candidate) => {
            const active = candidate === visibleView;
            return (
              <button
                id={`draft-instructions-${candidate}-tab`}
                key={candidate}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`draft-instructions-${candidate}-panel`}
                tabIndex={active ? 0 : -1}
                onClick={() => selectView(candidate)}
                onKeyDown={(event) => {
                  const next = nextViewForKey(candidate, event);
                  if (next) {
                    event.preventDefault();
                    selectView(next, true);
                  }
                }}
              >
                {candidate === "steps" ? "Steps" : "Cooking breakdown"}
              </button>
            );
          })}
        </div>
      </header>

      <div
        id="draft-instructions-steps-panel"
        role="tabpanel"
        aria-labelledby="draft-instructions-steps-tab"
        hidden={visibleView !== "steps"}
      >
        <ol className="draft-editor__rows draft-editor__rows--instructions recipe-instructions__step-list recipe-workspace__instruction-list">
          {instructions.map((instruction, index) => {
            const titleError =
              errors[draftInstructionTitleFieldKey(instruction.key)];
            const textError = errors[draftInstructionFieldKey(instruction.key)];
            const rowLabel = `Step ${index + 1}`;
            const facts = recipeDraftStepFacts(instruction.actions);
            return (
              <li
                key={instruction.key}
                className="draft-editor__row-card draft-editor__row-card--instruction recipe-instructions__step recipe-workspace__instruction-row"
              >
                <span
                  className="recipe-instructions__step-number"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <fieldset className="draft-editor__row-content recipe-instructions__step-content recipe-workspace__instruction-content">
                  <legend className="visually-hidden">{rowLabel}</legend>
                  <div className="recipe-workspace__instruction-heading">
                    <div className="recipe-form-field draft-editor__instruction-title-field">
                      <label
                        htmlFor={`draft-${instruction.key}-instruction-title`}
                      >
                        Step title
                      </label>
                      <input
                        id={`draft-${instruction.key}-instruction-title`}
                        className="recipe-workspace__editable-text"
                        type="text"
                        value={instruction.title}
                        maxLength={200}
                        placeholder="Add a step title"
                        aria-invalid={Boolean(titleError)}
                        aria-describedby={
                          titleError
                            ? `draft-${instruction.key}-instruction-title-error`
                            : undefined
                        }
                        onChange={(event) =>
                          onReplace(instruction.key, {
                            ...instruction,
                            title: event.target.value,
                          })
                        }
                      />
                      <RecipeDraftFieldError
                        id={`draft-${instruction.key}-instruction-title-error`}
                        message={titleError}
                      />
                    </div>
                    <div
                      className="recipe-workspace__instruction-actions"
                      aria-label={`Arrange ${rowLabel.toLowerCase()}`}
                    >
                      <button
                        id={`draft-${instruction.key}-instruction-move-up`}
                        className="recipe-workspace__ingredient-icon"
                        type="button"
                        aria-label={`Move ${rowLabel.toLowerCase()} up`}
                        disabled={index === 0}
                        onClick={() => onMove(index, -1)}
                      >
                        <EditorRowIcon kind="up" />
                      </button>
                      <button
                        id={`draft-${instruction.key}-instruction-move-down`}
                        className="recipe-workspace__ingredient-icon"
                        type="button"
                        aria-label={`Move ${rowLabel.toLowerCase()} down`}
                        disabled={index === instructions.length - 1}
                        onClick={() => onMove(index, 1)}
                      >
                        <EditorRowIcon kind="down" />
                      </button>
                      <button
                        className="recipe-workspace__ingredient-icon"
                        type="button"
                        aria-label={`Remove ${rowLabel.toLowerCase()}`}
                        onClick={() => onRemove(index)}
                      >
                        <EditorRowIcon kind="remove" />
                      </button>
                    </div>
                  </div>
                  <div className="recipe-form-field draft-editor__instruction-field">
                    <label
                      htmlFor={`draft-${instruction.key}-instruction-text`}
                    >
                      Instruction
                    </label>
                    <AutoSizeInstructionTextarea
                      id={`draft-${instruction.key}-instruction-text`}
                      value={instruction.text}
                      invalid={Boolean(textError)}
                      describedBy={
                        textError
                          ? `draft-${instruction.key}-instruction-text-error`
                          : undefined
                      }
                      onChange={(event) =>
                        onReplace(instruction.key, {
                          ...instruction,
                          text: event.target.value,
                        })
                      }
                    />
                    <RecipeDraftFieldError
                      id={`draft-${instruction.key}-instruction-text-error`}
                      message={textError}
                    />
                  </div>
                  <RecipeInstructionFactPills
                    facts={facts}
                    label={`Cooking details for step ${index + 1}`}
                  />
                </fieldset>
              </li>
            );
          })}
        </ol>
        <button
          id="draft-add-instruction"
          className="draft-editor__add-row draft-editor__add-row--instruction recipe-workspace__add-row"
          type="button"
          disabled={instructions.length >= 100}
          onClick={onAdd}
        >
          Add instruction
        </button>
      </div>

      <div
        id="draft-instructions-breakdown-panel"
        role="tabpanel"
        aria-labelledby="draft-instructions-breakdown-tab"
        hidden={visibleView !== "breakdown"}
      >
        <ol className="recipe-instructions__breakdown-list recipe-workspace__breakdown-list">
          {instructions.map((instruction, index) => {
            const rowLabel = `Step ${index + 1}`;
            return (
              <li
                key={instruction.key}
                className="recipe-instructions__breakdown-step recipe-workspace__breakdown-step"
              >
                <span
                  className="recipe-instructions__breakdown-number"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div className="recipe-instructions__breakdown-body">
                  <h3>{instruction.title.trim() || rowLabel}</h3>
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
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </fieldset>
  );
}
