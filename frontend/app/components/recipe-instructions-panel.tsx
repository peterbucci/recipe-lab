"use client";

import { useState, type KeyboardEvent } from "react";

import type { RecipeIngredient, RecipeInstruction } from "../../lib/recipe-api";
import type { RecipeInstructionAction } from "../../lib/structured-action";
import {
  RecipeInstructionFactPills,
  recipeActionLabel,
} from "./recipe-instruction-actions";

interface RecipeInstructionsPanelProps {
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
}

type InstructionView = "steps" | "breakdown";

const VIEWS: readonly InstructionView[] = ["steps", "breakdown"];

function instructionTitle(
  instruction: RecipeInstruction,
  index: number,
): string {
  return instruction.title?.trim() || `Step ${index + 1}`;
}

function listNames(names: readonly string[]): string {
  if (names.length < 2) {
    return names[0] ?? "No ingredient linked";
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function actionIngredients(
  action: RecipeInstructionAction,
  ingredientById: ReadonlyMap<string, RecipeIngredient>,
): string[] {
  return action.ingredient_occurrence_ids.map(
    (id) =>
      ingredientById.get(id)?.display_name ?? "Ingredient no longer available",
  );
}

function actionDetails(action: RecipeInstructionAction): string[] {
  return [action.duration?.display, action.temperature?.display].filter(
    (detail): detail is string => Boolean(detail),
  );
}

function stepDuration(
  actions: readonly RecipeInstructionAction[],
): string | null {
  const durations = [
    ...new Set(
      actions.flatMap((action) =>
        action.duration ? [action.duration.display] : [],
      ),
    ),
  ];
  return durations.length === 1 ? (durations[0] ?? null) : null;
}

function stepFacts(actions: readonly RecipeInstructionAction[]): string[] {
  const facts = actions.map((action) => {
    const details = actionDetails(action);
    return [
      recipeActionLabel(action.action_type.canonical_verb),
      ...details,
    ].join(" · ");
  });
  return [...new Set(facts)];
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

export function RecipeInstructionsPanel({
  ingredients,
  instructions,
}: RecipeInstructionsPanelProps) {
  const [view, setView] = useState<InstructionView>("steps");
  const orderedInstructions = [...instructions].sort(
    (left, right) => left.display_order - right.display_order,
  );
  const ingredientById = new Map(
    ingredients.map((ingredient) => [ingredient.id, ingredient]),
  );
  const helper =
    view === "steps"
      ? "Read the recipe as normal step-by-step instructions."
      : "See the actions, ingredients, timing, and heat inside each step.";

  function selectView(next: InstructionView, focus = false) {
    setView(next);
    if (focus) {
      requestAnimationFrame(() => {
        document.getElementById(`recipe-instructions-${next}-tab`)?.focus();
      });
    }
  }

  return (
    <section
      id="instructions"
      className="instruction-panel recipe-instructions"
      aria-labelledby="instructions-heading"
    >
      <header className="recipe-instructions__header">
        <div className="recipe-instructions__heading-copy">
          <h2 id="instructions-heading">Instructions</h2>
          <p aria-live="polite">{helper}</p>
        </div>
        <div
          className="recipe-instructions__view-switch"
          role="tablist"
          aria-label="Instruction view"
        >
          {VIEWS.map((candidate) => {
            const active = candidate === view;
            const label = candidate === "steps" ? "Steps" : "Cooking breakdown";
            return (
              <button
                id={`recipe-instructions-${candidate}-tab`}
                key={candidate}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`recipe-instructions-${candidate}-panel`}
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
                {label}
              </button>
            );
          })}
        </div>
      </header>

      <div
        id="recipe-instructions-steps-panel"
        role="tabpanel"
        aria-labelledby="recipe-instructions-steps-tab"
        tabIndex={0}
        hidden={view !== "steps"}
      >
        <ol className="recipe-instructions__step-list">
          {orderedInstructions.map((instruction, index) => {
            const facts = stepFacts(instruction.actions);
            const duration = stepDuration(instruction.actions);
            return (
              <li className="recipe-instructions__step" key={instruction.id}>
                <span
                  className="recipe-instructions__step-number"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div className="recipe-instructions__step-content">
                  <div className="recipe-instructions__step-header">
                    <h3>{instructionTitle(instruction, index)}</h3>
                    {duration ? <span>{duration}</span> : null}
                  </div>
                  <p>{instruction.text}</p>
                  <RecipeInstructionFactPills
                    facts={facts}
                    label={`Cooking details for step ${index + 1}`}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div
        id="recipe-instructions-breakdown-panel"
        role="tabpanel"
        aria-labelledby="recipe-instructions-breakdown-tab"
        tabIndex={0}
        hidden={view !== "breakdown"}
      >
        <ol className="recipe-instructions__breakdown-list">
          {orderedInstructions.map((instruction, index) => (
            <li
              className="recipe-instructions__breakdown-step"
              key={instruction.id}
            >
              <span
                className="recipe-instructions__breakdown-number"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <div className="recipe-instructions__breakdown-body">
                <h3>{instructionTitle(instruction, index)}</h3>
                {instruction.actions.length > 0 ? (
                  <ol
                    className="recipe-instructions__action-stack"
                    aria-label={`Cooking breakdown for step ${index + 1}`}
                  >
                    {[...instruction.actions]
                      .sort(
                        (left, right) =>
                          left.display_order - right.display_order,
                      )
                      .map((action) => {
                        const details = actionDetails(action);
                        return (
                          <li key={action.id}>
                            <strong className="recipe-instructions__action-verb">
                              {recipeActionLabel(
                                action.action_type.canonical_verb,
                              )}
                            </strong>
                            <span className="recipe-instructions__action-main">
                              <strong>
                                {listNames(
                                  actionIngredients(action, ingredientById),
                                )}
                              </strong>
                              {!action.action_type.active ? (
                                <small>Previously used action</small>
                              ) : null}
                            </span>
                            {details.length > 0 ? (
                              <span className="recipe-instructions__action-details">
                                {details.map((detail) => (
                                  <small key={detail}>{detail}</small>
                                ))}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                  </ol>
                ) : (
                  <p className="recipe-instructions__empty">
                    No cooking breakdown was recorded for this step.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="recipe-instructions__breakdown-note">
          Cooking breakdown shows the structured actions, ingredients, timing,
          and heat already represented by the recipe. It does not replace the
          written steps.
        </p>
      </div>
    </section>
  );
}
