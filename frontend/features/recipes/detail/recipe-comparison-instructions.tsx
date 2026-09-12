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

type RecipeComparisonActionStatus =
  | "unchanged"
  | "added"
  | "removed"
  | "changed";

interface RecipeComparisonActionRow {
  current: RecipeInstructionAction | null;
  currentIngredientById: ReadonlyMap<string, RecipeIngredient>;
  key: string;
  previous: RecipeInstructionAction | null;
  previousIngredientById: ReadonlyMap<string, RecipeIngredient>;
  status: RecipeComparisonActionStatus;
}

interface RecipeComparisonActionPair {
  currentId: string;
  previousId: string;
  status: Extract<RecipeComparisonActionStatus, "unchanged" | "changed">;
}

interface RecipeComparisonActionAnchor {
  currentIndex: number;
  previousIndex: number;
}

function orderedActions(
  actions: readonly RecipeInstructionAction[],
): RecipeInstructionAction[] {
  return [...actions].sort(
    (left, right) =>
      left.display_order - right.display_order || left.id.localeCompare(right.id),
  );
}

function monotonicActionAnchors(
  currentActions: readonly RecipeInstructionAction[],
  previousActions: readonly RecipeInstructionAction[],
  matchedCurrentByPreviousId: ReadonlyMap<string, string>,
): RecipeComparisonActionAnchor[] {
  const currentIndexById = new Map(
    currentActions.map((action, index) => [action.id, index]),
  );
  const candidates = previousActions.flatMap((action, previousIndex) => {
    const currentId = matchedCurrentByPreviousId.get(action.id);
    const currentIndex = currentId
      ? currentIndexById.get(currentId)
      : undefined;
    return currentIndex === undefined
      ? []
      : [{ currentIndex, previousIndex }];
  });
  const chains = candidates.map((candidate) => [candidate]);

  for (let index = 0; index < candidates.length; index += 1) {
    for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
      if (
        candidates[priorIndex]!.currentIndex >= candidates[index]!.currentIndex
      ) {
        continue;
      }
      const candidateChain = [...chains[priorIndex]!, candidates[index]!];
      if (candidateChain.length > chains[index]!.length) {
        chains[index] = candidateChain;
      }
    }
  }

  return chains.reduce<RecipeComparisonActionAnchor[]>(
    (longest, chain) => (chain.length > longest.length ? chain : longest),
    [],
  );
}

function comparisonActionRows(
  row: RecipeInstructionComparisonRow,
  currentIngredientById: ReadonlyMap<string, RecipeIngredient>,
  baseIngredientById: ReadonlyMap<string, RecipeIngredient>,
): RecipeComparisonActionRow[] {
  const currentActions = orderedActions(row.current?.actions ?? []);
  const previousActions = orderedActions(row.previous?.actions ?? []);

  if (row.status === "unchanged") {
    return currentActions.map((action) => ({
      current: action,
      currentIngredientById,
      key: `current:${action.id}`,
      previous: null,
      previousIngredientById: baseIngredientById,
      status: "unchanged",
    }));
  }
  if (row.status === "added") {
    return currentActions.map((action) => ({
      current: action,
      currentIngredientById,
      key: `current:${action.id}`,
      previous: null,
      previousIngredientById: baseIngredientById,
      status: "added",
    }));
  }
  if (row.status === "removed") {
    return previousActions.map((action) => ({
      current: null,
      currentIngredientById,
      key: `previous:${action.id}`,
      previous: action,
      previousIngredientById: baseIngredientById,
      status: "removed",
    }));
  }

  const currentIds = new Set(currentActions.map((action) => action.id));
  const previousIds = new Set(previousActions.map((action) => action.id));
  const previousById = new Map(previousActions.map((action) => [action.id, action]));
  const matchedPreviousByCurrentId = new Map<
    string,
    RecipeComparisonActionPair
  >();
  const matchedCurrentByPreviousId = new Map<string, string>();
  const pairs: RecipeComparisonActionPair[] = [
    ...row.unchangedActionPairs.map((pair) => ({
      currentId: pair.after_id,
      previousId: pair.before_id,
      status: "unchanged" as const,
    })),
    ...row.modifiedActionPairs.map((pair) => ({
      currentId: pair.after_id,
      previousId: pair.before_id,
      status: "changed" as const,
    })),
  ];
  for (const pair of pairs) {
    if (
      !currentIds.has(pair.currentId) ||
      !previousIds.has(pair.previousId) ||
      matchedPreviousByCurrentId.has(pair.currentId) ||
      matchedCurrentByPreviousId.has(pair.previousId)
    ) {
      continue;
    }
    matchedPreviousByCurrentId.set(pair.currentId, pair);
    matchedCurrentByPreviousId.set(pair.previousId, pair.currentId);
  }

  const actionRows: RecipeComparisonActionRow[] = [];
  const anchors = monotonicActionAnchors(
    currentActions,
    previousActions,
    matchedCurrentByPreviousId,
  );
  let currentCursor = 0;
  let previousCursor = 0;

  const appendGap = (currentEnd: number, previousEnd: number) => {
    for (const action of previousActions.slice(previousCursor, previousEnd)) {
      if (matchedCurrentByPreviousId.has(action.id)) continue;
      actionRows.push({
        current: null,
        currentIngredientById,
        key: `previous:${action.id}`,
        previous: action,
        previousIngredientById: baseIngredientById,
        status: "removed",
      });
    }
    for (const action of currentActions.slice(currentCursor, currentEnd)) {
      const pair = matchedPreviousByCurrentId.get(action.id);
      actionRows.push({
        current: action,
        currentIngredientById,
        key: `current:${action.id}`,
        previous: pair ? (previousById.get(pair.previousId) ?? null) : null,
        previousIngredientById: baseIngredientById,
        status: pair?.status ?? "added",
      });
    }
  };

  for (const anchor of anchors) {
    appendGap(anchor.currentIndex, anchor.previousIndex);
    const action = currentActions[anchor.currentIndex]!;
    const pair = matchedPreviousByCurrentId.get(action.id)!;
    actionRows.push({
      current: action,
      currentIngredientById,
      key: `current:${action.id}`,
      previous: previousById.get(pair.previousId) ?? null,
      previousIngredientById: baseIngredientById,
      status: pair.status,
    });
    currentCursor = anchor.currentIndex + 1;
    previousCursor = anchor.previousIndex + 1;
  }
  appendGap(currentActions.length, previousActions.length);
  return actionRows;
}

type RecipeComparisonTextStatus = "unchanged" | "added" | "removed";

interface RecipeComparisonTextFragment {
  status: RecipeComparisonTextStatus;
  value: string;
}

function comparisonTextFragments(
  previousValues: readonly string[],
  currentValues: readonly string[],
): RecipeComparisonTextFragment[] {
  const previous =
    previousValues.length > 0 ? previousValues : ["No ingredient linked"];
  const current =
    currentValues.length > 0 ? currentValues : ["No ingredient linked"];
  const lengths = Array.from({ length: previous.length + 1 }, () =>
    Array<number>(current.length + 1).fill(0),
  );

  for (let previousIndex = previous.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let currentIndex = current.length - 1; currentIndex >= 0; currentIndex -= 1) {
      lengths[previousIndex]![currentIndex] =
        previous[previousIndex] === current[currentIndex]
          ? lengths[previousIndex + 1]![currentIndex + 1]! + 1
          : Math.max(
              lengths[previousIndex + 1]![currentIndex]!,
              lengths[previousIndex]![currentIndex + 1]!,
            );
    }
  }

  const fragments: RecipeComparisonTextFragment[] = [];
  let previousIndex = 0;
  let currentIndex = 0;
  while (previousIndex < previous.length && currentIndex < current.length) {
    if (previous[previousIndex] === current[currentIndex]) {
      fragments.push({
        status: "unchanged",
        value: current[currentIndex]!,
      });
      previousIndex += 1;
      currentIndex += 1;
    } else if (
      lengths[previousIndex + 1]![currentIndex]! >=
      lengths[previousIndex]![currentIndex + 1]!
    ) {
      fragments.push({
        status: "removed",
        value: previous[previousIndex]!,
      });
      previousIndex += 1;
    } else {
      fragments.push({ status: "added", value: current[currentIndex]! });
      currentIndex += 1;
    }
  }
  for (; previousIndex < previous.length; previousIndex += 1) {
    fragments.push({
      status: "removed",
      value: previous[previousIndex]!,
    });
  }
  for (; currentIndex < current.length; currentIndex += 1) {
    fragments.push({ status: "added", value: current[currentIndex]! });
  }
  return fragments;
}

function listSeparator(index: number, length: number): string {
  if (index === 0) return "";
  if (length === 2) return " and ";
  if (index === length - 1) return ", and ";
  return ", ";
}

function ComparisonActionIngredients({
  row,
}: {
  row: RecipeComparisonActionRow;
}) {
  const action = row.current ?? row.previous;
  if (action === null) return null;

  if (row.status !== "changed" || row.current === null || row.previous === null) {
    const ingredientById = row.current
      ? row.currentIngredientById
      : row.previousIngredientById;
    return <strong>{listNames(actionIngredientNames(action, ingredientById))}</strong>;
  }

  const fragments = comparisonTextFragments(
    actionIngredientNames(row.previous, row.previousIngredientById),
    actionIngredientNames(row.current, row.currentIngredientById),
  );
  return (
    <strong>
      {fragments.map((fragment, index) => (
        <span key={`${fragment.status}:${index}:${fragment.value}`}>
          {listSeparator(index, fragments.length)}
          {fragment.status === "removed" ? (
            <del className="recipe-comparison-action__fragment recipe-comparison-action__fragment--removed">
              <span className="visually-hidden">Removed ingredient: </span>
              {fragment.value}
            </del>
          ) : fragment.status === "added" ? (
            <ins className="recipe-comparison-action__fragment recipe-comparison-action__fragment--added">
              <span className="visually-hidden">Added ingredient: </span>
              {fragment.value}
            </ins>
          ) : (
            fragment.value
          )}
        </span>
      ))}
    </strong>
  );
}

function ComparisonActionDetail({
  current,
  label,
  previous,
}: {
  current: string | null;
  label: "duration" | "temperature";
  previous: string | null;
}) {
  if (current === null && previous === null) return null;
  if (current === previous) return <li>{current}</li>;

  return (
    <li className="recipe-comparison-action__detail-change">
      {previous ? (
        <del className="recipe-comparison-action__fragment recipe-comparison-action__fragment--removed">
          <span className="visually-hidden">Previous {label}: </span>
          {previous}
        </del>
      ) : null}
      {current ? (
        <ins className="recipe-comparison-action__fragment recipe-comparison-action__fragment--added">
          <span className="visually-hidden">New {label}: </span>
          {current}
        </ins>
      ) : null}
    </li>
  );
}

function ComparisonInstructionActions({
  label,
  rows,
}: {
  label: string;
  rows: readonly RecipeComparisonActionRow[];
}) {
  if (rows.length === 0) {
    return (
      <p className="recipe-comparison-instruction-value__empty">
        No cooking breakdown was recorded for this step.
      </p>
    );
  }

  return (
    <ol className="recipe-comparison-actions" aria-label={label}>
      {rows.map((row) => {
        const action = row.current ?? row.previous;
        if (action === null) return null;
        const verb = recipeActionLabel(action.action_type.canonical_verb);
        const currentDuration = row.current?.duration?.display ?? null;
        const previousDuration = row.previous?.duration?.display ?? null;
        const currentTemperature = row.current?.temperature?.display ?? null;
        const previousTemperature = row.previous?.temperature?.display ?? null;
        const hasDetails = Boolean(
          currentDuration ||
          previousDuration ||
          currentTemperature ||
          previousTemperature,
        );
        return (
          <li
            className={`recipe-comparison-action recipe-comparison-action--${row.status}`}
            data-action-status={row.status}
            key={row.key}
          >
            {row.status === "added" ? (
              <ins className="visually-hidden">Added action: </ins>
            ) : row.status === "removed" ? (
              <del className="visually-hidden">Removed action: </del>
            ) : row.status === "changed" ? (
              <span className="visually-hidden">Changed action: </span>
            ) : null}
            <strong className="recipe-comparison-action__verb">{verb}</strong>
            <span className="recipe-comparison-action__main">
              <ComparisonActionIngredients row={row} />
              {!action.action_type.active ? (
                <small className="recipe-comparison-action__inactive">
                  Previously used action
                </small>
              ) : null}
            </span>
            {hasDetails ? (
              <ul
                className="recipe-comparison-action__details"
                aria-label={`${verb} timing and temperature`}
              >
                {row.status === "changed" ? (
                  <>
                    <ComparisonActionDetail
                      current={currentDuration}
                      label="duration"
                      previous={previousDuration}
                    />
                    <ComparisonActionDetail
                      current={currentTemperature}
                      label="temperature"
                      previous={previousTemperature}
                    />
                  </>
                ) : (
                  <>
                    {action.duration ? <li>{action.duration.display}</li> : null}
                    {action.temperature ? (
                      <li>{action.temperature.display}</li>
                    ) : null}
                  </>
                )}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function InstructionValue({ instruction }: { instruction: RecipeInstruction }) {
  const step = instruction.display_order + 1;
  const title = instruction.title?.trim();

  return (
    <div className="recipe-comparison-instruction-value recipe-comparison-instruction-value--steps">
      <span
        className="recipe-comparison-instruction-value__step-number"
        aria-hidden="true"
      >
        {step}
      </span>
      <div className="recipe-comparison-instruction-value__body">
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
        <p className="recipe-comparison-instruction-value__text">
          {instruction.text}
        </p>
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
  row,
  status,
}: {
  row: RecipeInstructionComparisonRow;
  status: RecipeComparisonRowStatus;
}) {
  if (row.current === null) {
    return null;
  }

  const step = row.current.display_order + 1;
  const value = <InstructionValue instruction={row.current} />;
  const labels =
    status === "changed" ? instructionChangeLabels(row, "steps") : [];

  return (
    <div
      className="recipe-comparison-instruction-row__current"
      data-comparison-value="current"
    >
      {status === "added" || status === "changed" ? (
        <ins>{value}</ins>
      ) : (
        value
      )}
      {labels.length > 0 ? (
        <ul
          className="recipe-comparison-instruction-labels"
          aria-label={`Changes to step ${step}`}
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
  instruction,
  removed = false,
}: {
  instruction: RecipeInstruction;
  removed?: boolean;
}) {
  return (
    <div
      className={
        removed
          ? "recipe-comparison-instruction-row__previous recipe-comparison-instruction-row__previous--removed"
          : "recipe-comparison-instruction-row__previous"
      }
      data-comparison-value="previous"
    >
      {!removed ? (
        <span className="recipe-comparison-instruction-row__previous-label">
          Previous
        </span>
      ) : null}
      <del>
        <InstructionValue instruction={instruction} />
      </del>
    </div>
  );
}

function BreakdownInstruction({
  baseIngredientById,
  currentIngredientById,
  row,
  status,
}: {
  baseIngredientById: ReadonlyMap<string, RecipeIngredient>;
  currentIngredientById: ReadonlyMap<string, RecipeIngredient>;
  row: RecipeInstructionComparisonRow;
  status: RecipeComparisonRowStatus;
}) {
  const instruction = row.current ?? row.previous;
  if (instruction === null) return null;

  const step = instruction.display_order + 1;
  const title = instruction.title?.trim();
  const labels =
    status === "changed" ? instructionChangeLabels(row, "breakdown") : [];
  const actionRows = comparisonActionRows(
    row,
    currentIngredientById,
    baseIngredientById,
  );

  return (
    <>
      <span
        className="recipe-comparison-instruction-row__step-number"
        aria-hidden="true"
      >
        {step}
      </span>
      <div className="recipe-comparison-instruction-row__body">
        <div className="recipe-comparison-instruction-row__heading">
          <h3 aria-label={title ? `Step ${step}: ${title}` : undefined}>
            {title || `Step ${step}`}
          </h3>
          {status !== "unchanged" ? (
            <InstructionStatus status={status} />
          ) : null}
        </div>
        <ComparisonInstructionActions
          label={`Cooking action comparison for step ${step}`}
          rows={actionRows}
        />
        {labels.length > 0 ? (
          <ul
            className="recipe-comparison-instruction-labels"
            aria-label={`Cooking breakdown changes to step ${step}`}
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
    </>
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
  if (view === "breakdown") {
    return (
      <li
        className={`recipe-comparison-instruction-row recipe-comparison-instruction-row--${status}`}
        data-instruction-view={view}
      >
        <BreakdownInstruction
          baseIngredientById={baseIngredientById}
          currentIngredientById={currentIngredientById}
          row={row}
          status={status}
        />
      </li>
    );
  }

  return (
    <li
      className={`recipe-comparison-instruction-row recipe-comparison-instruction-row--${status}`}
      data-instruction-view={view}
    >
      {status !== "unchanged" ? <InstructionStatus status={status} /> : null}
      <CurrentInstruction row={row} status={status} />
      {status === "changed" && row.previous !== null ? (
        <PreviousInstruction instruction={row.previous} />
      ) : null}
      {status === "removed" && row.previous !== null ? (
        <PreviousInstruction instruction={row.previous} removed />
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
