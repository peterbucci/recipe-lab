import { formatIngredientMeasure } from "../shared/recipe-format";
import type { RecipeIngredient } from "../shared/recipe-contracts";
import { RecipeIngredientGatherCheckbox } from "../shared/recipe-ingredient-gather-checkbox";
import type {
  RecipeComparisonModel,
  RecipeIngredientComparisonRow,
} from "./recipe-comparison-model";

interface RecipeComparisonIngredientsProps {
  comparison: RecipeComparisonModel;
}

const statusPresentation = {
  added: { marker: "+", label: "Added" },
  removed: { marker: "−", label: "Removed" },
  changed: { marker: "±", label: "Changed" },
} as const;

function IngredientValue({ ingredient }: { ingredient: RecipeIngredient }) {
  return (
    <span className="recipe-comparison-ingredient-value">
      <span className="recipe-comparison-ingredient-value__amount">
        {formatIngredientMeasure(ingredient.measure)}
      </span>{" "}
      <span className="recipe-comparison-ingredient-value__details">
        <strong className="recipe-comparison-ingredient-value__name">
          {ingredient.display_name}
        </strong>
        {ingredient.preparation_notes ? (
          <>
            {" "}
            <small className="recipe-comparison-ingredient-value__preparation">
              Preparation: {ingredient.preparation_notes}
            </small>
          </>
        ) : null}
      </span>
    </span>
  );
}

function ingredientChangeLabels(
  row: RecipeIngredientComparisonRow,
): string[] {
  const fields = new Set(row.changedFields);
  const labels: string[] = [];

  if (row.changeKind === "substitution") {
    labels.push("Substitution");
  }
  if (fields.has("measure")) {
    labels.push("Amount changed");
  }
  if (fields.has("display_name") && row.changeKind !== "substitution") {
    labels.push("Name changed");
  }
  if (fields.has("preparation_notes")) {
    labels.push("Preparation changed");
  }

  return labels;
}

function IngredientStatus({
  status,
}: {
  status: Exclude<RecipeIngredientComparisonRow["status"], "unchanged">;
}) {
  const presentation = statusPresentation[status];
  return (
    <span className="recipe-comparison-ingredient-row__status">
      <span
        className="recipe-comparison-ingredient-row__marker"
        aria-hidden="true"
      >
        {presentation.marker}
      </span>
      <span>{presentation.label}</span>
    </span>
  );
}

function CurrentIngredient({ row }: { row: RecipeIngredientComparisonRow }) {
  if (row.current === null) {
    return null;
  }

  const value = <IngredientValue ingredient={row.current} />;
  const labels = row.status === "changed" ? ingredientChangeLabels(row) : [];

  return (
    <label
      className="recipe-comparison-ingredient-row__current"
      data-comparison-value="current"
    >
      <RecipeIngredientGatherCheckbox displayName={row.current.display_name} />
      <span className="recipe-comparison-ingredient-row__current-value">
        {row.status === "added" || row.status === "changed" ? (
          <ins>{value}</ins>
        ) : (
          value
        )}
        {labels.length > 0 ? (
          <ul
            className="recipe-comparison-ingredient-labels"
            aria-label="Ingredient changes"
          >
            {labels.map((label) => (
              <li
                key={label}
                className="recipe-comparison-ingredient-labels__label"
              >
                {label}
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    </label>
  );
}

function PreviousIngredient({
  ingredient,
  removed = false,
}: {
  ingredient: RecipeIngredient;
  removed?: boolean;
}) {
  return (
    <div
      className={
        removed
          ? "recipe-comparison-ingredient-row__previous recipe-comparison-ingredient-row__previous--removed"
          : "recipe-comparison-ingredient-row__previous"
      }
      data-comparison-value="previous"
    >
      {!removed ? (
        <span className="recipe-comparison-ingredient-row__previous-label">
          Previous
        </span>
      ) : null}
      {removed ? (
        <RecipeIngredientGatherCheckbox
          disabled
          displayName={ingredient.display_name}
        />
      ) : null}
      <del>
        <IngredientValue ingredient={ingredient} />
      </del>
    </div>
  );
}

function IngredientRow({ row }: { row: RecipeIngredientComparisonRow }) {
  const classes = [
    "recipe-comparison-ingredient-row",
    `recipe-comparison-ingredient-row--${row.status}`,
  ];
  if (row.changeKind === "substitution") {
    classes.push("recipe-comparison-ingredient-row--substitution");
  }

  return (
    <li className={classes.join(" ")}>
      {row.status !== "unchanged" ? (
        <IngredientStatus status={row.status} />
      ) : null}
      <CurrentIngredient row={row} />
      {row.status === "changed" && row.previous !== null ? (
        <PreviousIngredient ingredient={row.previous} />
      ) : null}
      {row.status === "removed" && row.previous !== null ? (
        <PreviousIngredient ingredient={row.previous} removed />
      ) : null}
    </li>
  );
}

export function RecipeComparisonIngredients({
  comparison,
}: RecipeComparisonIngredientsProps) {
  const count = comparison.ingredientChangeCount;

  return (
    <section
      id="ingredients"
      className="recipe-comparison-ingredients"
      aria-labelledby="recipe-comparison-ingredients-heading"
    >
      <div className="recipe-comparison-section-heading">
        <h2 id="recipe-comparison-ingredients-heading">Ingredients</h2>
        <small>
          {count} {count === 1 ? "ingredient change" : "ingredient changes"}
        </small>
      </div>
      <ul className="recipe-comparison-ingredient-list">
        {comparison.ingredientRows.map((row) => (
          <IngredientRow key={row.key} row={row} />
        ))}
      </ul>
    </section>
  );
}
