import type {
  RecipeIngredient,
} from "./recipe-contracts";
import type { RecipeInstructionAction } from "./recipe-structure";

interface RecipeInstructionActionsProps {
  actions: readonly RecipeInstructionAction[];
  ingredients: readonly RecipeIngredient[];
  label: string;
}

interface RecipeInstructionFactPillsProps {
  facts: readonly string[];
  label: string;
}

export function recipeActionLabel(canonicalVerb: string): string {
  const trimmed = canonicalVerb.trim();
  const label = trimmed.toLocaleLowerCase() === "line" ? "line pan" : trimmed;
  return label.length > 0
    ? `${label.charAt(0).toLocaleUpperCase()}${label.slice(1)}`
    : label;
}

export function RecipeInstructionFactPills({
  facts,
  label,
}: RecipeInstructionFactPillsProps) {
  if (facts.length === 0) {
    return null;
  }
  return (
    <ul className="recipe-instructions__facts" aria-label={label}>
      {facts.map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}

export function RecipeInstructionActions({
  actions,
  ingredients,
  label,
}: RecipeInstructionActionsProps) {
  if (actions.length === 0) {
    return null;
  }

  const ingredientById = new Map(
    ingredients.map((ingredient) => [ingredient.id, ingredient]),
  );
  return (
    <ol className="instruction-actions" aria-label={label}>
      {[...actions]
        .sort((left, right) => left.display_order - right.display_order)
        .map((action) => {
          const inputLabels = action.ingredient_occurrence_ids.map((id) => {
            const ingredient = ingredientById.get(id);
            return ingredient
              ? ingredient.display_name
              : "ingredient no longer available";
          });
          const details = [
            inputLabels.length > 0 ? `With ${inputLabels.join(" and ")}` : null,
            action.duration ? `For ${action.duration.display}` : null,
            action.temperature ? `At ${action.temperature.display}` : null,
          ].filter((detail): detail is string => Boolean(detail));
          return (
            <li key={action.id}>
              <strong>
                {recipeActionLabel(action.action_type.canonical_verb)}
              </strong>
              {!action.action_type.active ? (
                <span>Previously used action</span>
              ) : null}
              {details.length > 0 ? (
                <small>{details.join(" \u00b7 ")}</small>
              ) : null}
            </li>
          );
        })}
    </ol>
  );
}
