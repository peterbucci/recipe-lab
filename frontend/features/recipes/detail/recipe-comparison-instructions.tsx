import { recipeActionLabel } from "../shared/recipe-instruction-actions";
import type {
  RecipeIngredient,
  RecipeInstruction,
  RecipeInstructionChangedField,
} from "../shared/recipe-contracts";
import type { RecipeInstructionAction } from "../shared/recipe-structure";
import type {
  RecipeComparisonModel,
  RecipeInstructionComparisonRow,
} from "./recipe-comparison-model";

interface RecipeComparisonInstructionsProps {
  comparison: RecipeComparisonModel;
}

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
}: {
  actions: readonly RecipeInstructionAction[];
  ingredientById: ReadonlyMap<string, RecipeIngredient>;
  label: string;
}) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <ol className="recipe-comparison-actions" aria-label={label}>
      {[...actions]
        .sort(
          (left, right) => left.display_order - right.display_order,
        )
        .map((action) => {
          const verb = recipeActionLabel(action.action_type.canonical_verb);
          const ingredients = actionIngredientNames(action, ingredientById);
          return (
            <li className="recipe-comparison-action" key={action.id}>
              <strong className="recipe-comparison-action__verb">
                {verb}
              </strong>
              <span className="recipe-comparison-action__main">
                {ingredients.length > 0
                  ? `With ${listNames(ingredients)}`
                  : listNames(ingredients)}
              </span>
              {!action.action_type.active ? (
                <small className="recipe-comparison-action__inactive">
                  Previously used action
                </small>
              ) : null}
              {action.duration || action.temperature ? (
                <ul
                  className="recipe-comparison-action__details"
                  aria-label={`${verb} timing and temperature`}
                >
                  {action.duration ? (
                    <li>For {action.duration.display}</li>
                  ) : null}
                  {action.temperature ? (
                    <li>At {action.temperature.display}</li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          );
        })}
    </ol>
  );
}

function InstructionValue({
  actionLabel,
  ingredientById,
  instruction,
}: {
  actionLabel: string;
  ingredientById: ReadonlyMap<string, RecipeIngredient>;
  instruction: RecipeInstruction;
}) {
  const step = instruction.display_order + 1;
  const title = instruction.title?.trim();

  return (
    <div className="recipe-comparison-instruction-value">
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
        <ComparisonInstructionActions
          actions={instruction.actions}
          ingredientById={ingredientById}
          label={actionLabel}
        />
      </div>
    </div>
  );
}

function InstructionStatus({
  status,
}: {
  status: Exclude<RecipeInstructionComparisonRow["status"], "unchanged">;
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

function instructionChangeLabels(
  row: RecipeInstructionComparisonRow,
): string[] {
  return [
    ...new Set(row.changedFields.map((field) => changedFieldLabels[field])),
  ];
}

function CurrentInstruction({
  ingredientById,
  row,
}: {
  ingredientById: ReadonlyMap<string, RecipeIngredient>;
  row: RecipeInstructionComparisonRow;
}) {
  if (row.current === null) {
    return null;
  }

  const step = row.current.display_order + 1;
  const value = (
    <InstructionValue
      actionLabel={`Cooking actions in this recipe for step ${step}`}
      ingredientById={ingredientById}
      instruction={row.current}
    />
  );
  const labels = row.status === "changed" ? instructionChangeLabels(row) : [];

  return (
    <div
      className="recipe-comparison-instruction-row__current"
      data-comparison-value="current"
    >
      {row.status === "added" || row.status === "changed" ? (
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
  ingredientById,
  instruction,
  removed = false,
}: {
  ingredientById: ReadonlyMap<string, RecipeIngredient>;
  instruction: RecipeInstruction;
  removed?: boolean;
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
      {!removed ? (
        <span className="recipe-comparison-instruction-row__previous-label">
          Previous
        </span>
      ) : null}
      <del>
        <InstructionValue
          actionLabel={`Cooking actions in the starting recipe for step ${step}`}
          ingredientById={ingredientById}
          instruction={instruction}
        />
      </del>
    </div>
  );
}

function InstructionRow({
  baseIngredientById,
  currentIngredientById,
  row,
}: {
  baseIngredientById: ReadonlyMap<string, RecipeIngredient>;
  currentIngredientById: ReadonlyMap<string, RecipeIngredient>;
  row: RecipeInstructionComparisonRow;
}) {
  return (
    <li
      className={`recipe-comparison-instruction-row recipe-comparison-instruction-row--${row.status}`}
    >
      {row.status !== "unchanged" ? (
        <InstructionStatus status={row.status} />
      ) : null}
      <CurrentInstruction ingredientById={currentIngredientById} row={row} />
      {row.status === "changed" && row.previous !== null ? (
        <PreviousInstruction
          ingredientById={baseIngredientById}
          instruction={row.previous}
        />
      ) : null}
      {row.status === "removed" && row.previous !== null ? (
        <PreviousInstruction
          ingredientById={baseIngredientById}
          instruction={row.previous}
          removed
        />
      ) : null}
    </li>
  );
}

export function RecipeComparisonInstructions({
  comparison,
}: RecipeComparisonInstructionsProps) {
  const count = comparison.instructionChangeCount;
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

  return (
    <section
      className="recipe-comparison-instructions"
      aria-labelledby="recipe-comparison-instructions-heading"
    >
      <div className="recipe-comparison-section-heading">
        <h2 id="recipe-comparison-instructions-heading">Instructions</h2>
        <small>
          {count} {count === 1 ? "cooking change" : "cooking changes"}
        </small>
      </div>
      <ol className="recipe-comparison-instruction-list">
        {comparison.instructionRows.map((row) => (
          <InstructionRow
            baseIngredientById={baseIngredientById}
            currentIngredientById={currentIngredientById}
            key={row.key}
            row={row}
          />
        ))}
      </ol>
    </section>
  );
}
