"use client";

import { useState } from "react";

import type {
  RecipeIngredient,
  RecipeInstruction,
  RecipeInstructionChangedField,
} from "../shared/recipe-contracts";
import { recipeActionLabel } from "../shared/recipe-instruction-actions";
import {
  RecipeInstructionViewTabs,
  recipeInstructionViewPanelId,
  recipeInstructionViewTabId,
  type RecipeInstructionView,
} from "../shared/recipe-instruction-view-tabs";
import type { RecipeInstructionAction } from "../shared/recipe-structure";
import type {
  RecipeComparisonModel,
  RecipeComparisonRowStatus,
  RecipeInstructionComparisonRow,
} from "./recipe-comparison-model";

interface RecipeComparisonInstructionsProps {
  comparison: RecipeComparisonModel;
}

const INSTRUCTION_VIEW_ID_PREFIX = "recipe-comparison-instructions";

const statusPresentation = {
  added: { marker: "+", label: "Added" },
  removed: { marker: "−", label: "Removed" },
  changed: { marker: "±", label: "Changed" },
} as const;

const changedFieldLabels: Record<RecipeInstructionChangedField, string> = {
  title: "Step title changed",
  text: "Wording changed",
  actions: "Cooking actions changed",
  inputs: "Ingredients used in the step changed",
  action_order: "Order within the step changed",
  duration: "Timing changed",
  temperature: "Temperature changed",
};

const changedFieldsByView: Record<
  RecipeInstructionView,
  ReadonlySet<RecipeInstructionChangedField>
> = {
  steps: new Set(["title", "text"]),
  breakdown: new Set([
    "actions",
    "inputs",
    "action_order",
    "duration",
    "temperature",
  ]),
};

function listNames(names: readonly string[]): string {
  if (names.length === 0) {
    return "No ingredient linked";
  }
  if (names.length === 1) {
    return names[0]!;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function actionIngredientNames(
  action: RecipeInstructionAction,
  ingredientById: ReadonlyMap<string, RecipeIngredient>,
): string[] {
  return action.ingredient_occurrence_ids.map(
    (id) =>
      ingredientById.get(id)?.display_name ??
      "Ingredient no longer available",
  );
}

function ComparisonInstructionActions({
  actions,
  ingredientById,
  label,
  tone,
}: {
  actions: readonly RecipeInstructionAction[];
  ingredientById: ReadonlyMap<string, RecipeIngredient>;
  label: string;
  tone?: "added" | "removed";
}) {
  if (actions.length === 0) {
    if (tone) {
      return null;
    }
    return (
      <p className="recipe-comparison-instruction-value__empty">
        No cooking breakdown was recorded for this step.
      </p>
    );
  }

  const actionList = (
    <ol
      className={
        tone
          ? `recipe-comparison-actions recipe-comparison-actions--${tone}`
          : "recipe-comparison-actions"
      }
      aria-label={label}
    >
      {[...actions]
        .sort((left, right) => left.display_order - right.display_order)
        .map((action) => {
          const verb = recipeActionLabel(action.action_type.canonical_verb);
          const ingredients = actionIngredientNames(action, ingredientById);
          return (
            <li className="recipe-comparison-action" key={action.id}>
              <strong className="recipe-comparison-action__verb">{verb}</strong>
              <span className="recipe-comparison-action__main">
                <strong>{listNames(ingredients)}</strong>
                {!action.action_type.active ? (
                  <small className="recipe-comparison-action__inactive">
                    Previously used action
                  </small>
                ) : null}
              </span>
              {action.duration || action.temperature ? (
                <ul
                  className="recipe-comparison-action__details"
                  aria-label={`${verb} timing and temperature`}
                >
                  {action.duration ? (
                    <li>{action.duration.display}</li>
                  ) : null}
                  {action.temperature ? (
                    <li>{action.temperature.display}</li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          );
        })}
    </ol>
  );

  if (!tone) {
    return <div className="recipe-comparison-action-group">{actionList}</div>;
  }

  const changeLabel =
    tone === "added"
      ? { marker: "+", text: "Current cooking breakdown" }
      : { marker: "−", text: "Previous cooking breakdown" };
  const Group = tone === "added" ? "ins" : "del";

  return (
    <Group
      className={`recipe-comparison-action-group recipe-comparison-action-group--${tone}`}
    >
      <span className="recipe-comparison-action-group__change-label">
        <span aria-hidden="true">{changeLabel.marker}</span>
        {changeLabel.text}
      </span>
      {actionList}
    </Group>
  );
}

function InstructionValue({
  actionLabel,
  breakdownChange,
  ingredientById,
  instruction,
  omitHeading = false,
  view,
}: {
  actionLabel: string;
  breakdownChange?: "added" | "removed";
  ingredientById: ReadonlyMap<string, RecipeIngredient>;
  instruction: RecipeInstruction;
  omitHeading?: boolean;
  view: RecipeInstructionView;
}) {
  const step = instruction.display_order + 1;
  const title = instruction.title?.trim();
  const breakdown = (
    <ComparisonInstructionActions
      actions={instruction.actions}
      ingredientById={ingredientById}
      label={actionLabel}
      tone={breakdownChange}
    />
  );

  return (
    <div
      className={`recipe-comparison-instruction-value recipe-comparison-instruction-value--${view}`}
    >
      <span
        className="recipe-comparison-instruction-value__step-number"
        aria-hidden="true"
      >
        {step}
      </span>
      <div className="recipe-comparison-instruction-value__body">
        {!omitHeading ? (
          <h3
            className="recipe-comparison-instruction-value__heading"
            aria-label={title ? `Step ${step}: ${title}` : undefined}
          >
            {title ? (
              <span className="recipe-comparison-instruction-value__title">
                {title}
              </span>
            ) : (
              `Step ${step}`
            )}
          </h3>
        ) : null}
        {view === "steps" ? (
          <p className="recipe-comparison-instruction-value__text">
            {instruction.text}
          </p>
        ) : (
          breakdown
        )}
      </div>
    </div>
  );
}

function InstructionStatus({
  status,
}: {
  status: Exclude<RecipeComparisonRowStatus, "unchanged">;
}) {
  const presentation = statusPresentation[status];
  return (
    <span className="recipe-comparison-instruction-row__status">
      <span
        className="recipe-comparison-instruction-row__marker"
        aria-hidden="true"
      >
        {presentation.marker}
      </span>
      <span>{presentation.label}</span>
    </span>
  );
}

function relevantChangedFields(
  row: RecipeInstructionComparisonRow,
  view: RecipeInstructionView,
): RecipeInstructionChangedField[] {
  return row.changedFields.filter((field) => changedFieldsByView[view].has(field));
}

function instructionStatusForView(
  row: RecipeInstructionComparisonRow,
  view: RecipeInstructionView,
): RecipeComparisonRowStatus {
  if (row.status === "unchanged") {
    return "unchanged";
  }
  if (row.status === "changed") {
    return relevantChangedFields(row, view).length > 0 ? "changed" : "unchanged";
  }
  if (view === "steps") {
    return row.status;
  }

  const instruction = row.status === "added" ? row.current : row.previous;
  return instruction && instruction.actions.length > 0
    ? row.status
    : "unchanged";
}

function instructionChangeLabels(
  row: RecipeInstructionComparisonRow,
  view: RecipeInstructionView,
): string[] {
  return [
    ...new Set(
      relevantChangedFields(row, view).map(
        (field) => changedFieldLabels[field],
      ),
    ),
  ];
}

function CurrentInstruction({
  ingredientById,
  row,
  status,
  view,
}: {
  ingredientById: ReadonlyMap<string, RecipeIngredient>;
  row: RecipeInstructionComparisonRow;
  status: RecipeComparisonRowStatus;
  view: RecipeInstructionView;
}) {
  if (row.current === null) {
    return null;
  }

  const step = row.current.display_order + 1;
  const value = (
    <InstructionValue
      actionLabel={`Cooking actions in this recipe for step ${step}`}
      breakdownChange={
        view === "breakdown" && (status === "added" || status === "changed")
          ? "added"
          : undefined
      }
      ingredientById={ingredientById}
      instruction={row.current}
      view={view}
    />
  );
  const labels = status === "changed" ? instructionChangeLabels(row, view) : [];

  return (
    <div
      className="recipe-comparison-instruction-row__current"
      data-comparison-value="current"
    >
      {view === "steps" && (status === "added" || status === "changed") ? (
        <ins>{value}</ins>
      ) : (
        value
      )}
      {labels.length > 0 ? (
        <ul
          className="recipe-comparison-instruction-labels"
          aria-label={
            view === "steps"
              ? `Changes to step ${step}`
              : `Cooking breakdown changes to step ${step}`
          }
        >
          {labels.map((label) => (
            <li
              className="recipe-comparison-instruction-labels__label"
              key={label}
            >
              {label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PreviousInstruction({
  ingredientById,
  instruction,
  removed = false,
  view,
}: {
  ingredientById: ReadonlyMap<string, RecipeIngredient>;
  instruction: RecipeInstruction;
  removed?: boolean;
  view: RecipeInstructionView;
}) {
  const step = instruction.display_order + 1;
  return (
    <div
      className={
        removed
          ? "recipe-comparison-instruction-row__previous recipe-comparison-instruction-row__previous--removed"
          : "recipe-comparison-instruction-row__previous"
      }
      data-comparison-value="previous"
    >
      {!removed && view === "steps" ? (
        <span className="recipe-comparison-instruction-row__previous-label">
          Previous
        </span>
      ) : null}
      {view === "breakdown" ? (
        <InstructionValue
          actionLabel={`Cooking actions in the starting recipe for step ${step}`}
          breakdownChange="removed"
          ingredientById={ingredientById}
          instruction={instruction}
          omitHeading={!removed}
          view={view}
        />
      ) : (
        <del>
          <InstructionValue
            actionLabel={`Cooking actions in the starting recipe for step ${step}`}
            ingredientById={ingredientById}
            instruction={instruction}
            view={view}
          />
        </del>
      )}
    </div>
  );
}

function InstructionRow({
  baseIngredientById,
  currentIngredientById,
  row,
  view,
}: {
  baseIngredientById: ReadonlyMap<string, RecipeIngredient>;
  currentIngredientById: ReadonlyMap<string, RecipeIngredient>;
  row: RecipeInstructionComparisonRow;
  view: RecipeInstructionView;
}) {
  const status = instructionStatusForView(row, view);
  return (
    <li
      className={`recipe-comparison-instruction-row recipe-comparison-instruction-row--${status}`}
      data-instruction-view={view}
    >
      {status !== "unchanged" ? <InstructionStatus status={status} /> : null}
      <CurrentInstruction
        ingredientById={currentIngredientById}
        row={row}
        status={status}
        view={view}
      />
      {status === "changed" &&
      row.previous !== null &&
      (view === "steps" || row.previous.actions.length > 0) ? (
        <PreviousInstruction
          ingredientById={baseIngredientById}
          instruction={row.previous}
          view={view}
        />
      ) : null}
      {status === "removed" && row.previous !== null ? (
        <PreviousInstruction
          ingredientById={baseIngredientById}
          instruction={row.previous}
          removed
          view={view}
        />
      ) : null}
    </li>
  );
}

function rowsForView(
  rows: readonly RecipeInstructionComparisonRow[],
  view: RecipeInstructionView,
): readonly RecipeInstructionComparisonRow[] {
  if (view === "steps") {
    return rows;
  }
  return rows.filter(
    (row) => row.current !== null || (row.previous?.actions.length ?? 0) > 0,
  );
}

function viewChangeCount(
  rows: readonly RecipeInstructionComparisonRow[],
  view: RecipeInstructionView,
): number {
  return rows.filter(
    (row) => instructionStatusForView(row, view) !== "unchanged",
  ).length;
}

function viewCountLabel(count: number, view: RecipeInstructionView): string {
  const subject = view === "steps" ? "step" : "cooking breakdown";
  return `${count} ${subject} ${count === 1 ? "change" : "changes"}`;
}

export function RecipeComparisonInstructions({
  comparison,
}: RecipeComparisonInstructionsProps) {
  const [view, setView] = useState<RecipeInstructionView>("steps");
  const currentIngredientById = new Map(
    comparison.recipe.ingredients.map((ingredient) => [
      ingredient.id,
      ingredient,
    ]),
  );
  const baseIngredientById = new Map(
    comparison.diff.ingredient_context.base.map((ingredient) => [
      ingredient.id,
      ingredient,
    ]),
  );
  const helper =
    view === "steps"
      ? "Compare the written recipe step by step."
      : "Compare the actions, ingredients, timing, and heat inside each step.";
  const count = viewChangeCount(comparison.instructionRows, view);

  return (
    <section
      id="instructions"
      className="recipe-comparison-instructions"
      aria-labelledby="recipe-comparison-instructions-heading"
    >
      <header className="recipe-comparison-instructions__header">
        <div className="recipe-comparison-instructions__heading-copy">
          <h2 id="recipe-comparison-instructions-heading">Instructions</h2>
          <div
            className="recipe-comparison-instructions__view-summary"
            aria-live="polite"
          >
            <p>{helper}</p>
            <small>{viewCountLabel(count, view)}</small>
          </div>
        </div>
        <RecipeInstructionViewTabs
          ariaLabel="Instruction comparison view"
          hideOnPrint
          idPrefix={INSTRUCTION_VIEW_ID_PREFIX}
          value={view}
          onChange={setView}
        />
      </header>

      {(["steps", "breakdown"] as const).map((candidate) => (
        <div
          className={`recipe-comparison-instructions__panel recipe-comparison-instructions__panel--${candidate}`}
          id={recipeInstructionViewPanelId(
            INSTRUCTION_VIEW_ID_PREFIX,
            candidate,
          )}
          key={candidate}
          role="tabpanel"
          aria-labelledby={recipeInstructionViewTabId(
            INSTRUCTION_VIEW_ID_PREFIX,
            candidate,
          )}
          tabIndex={0}
          hidden={view !== candidate}
        >
          <h3 className="recipe-comparison-instructions__print-heading">
            {candidate === "steps" ? "Written steps" : "Cooking breakdown"}
            {` — ${viewCountLabel(
              viewChangeCount(comparison.instructionRows, candidate),
              candidate,
            )}`}
          </h3>
          <ol className="recipe-comparison-instruction-list">
            {rowsForView(comparison.instructionRows, candidate).map((row) => (
              <InstructionRow
                baseIngredientById={baseIngredientById}
                currentIngredientById={currentIngredientById}
                key={row.key}
                row={row}
                view={candidate}
              />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
