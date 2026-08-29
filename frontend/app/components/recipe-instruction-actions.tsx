import type { RecipeIngredient } from "../../lib/recipe-api";
import type { RecipeInstructionAction } from "../../lib/structured-action";

interface RecipeInstructionActionsProps {
  actions: readonly RecipeInstructionAction[];
  ingredients: readonly RecipeIngredient[];
  label: string;
}

export function RecipeInstructionActions({
  actions,
  ingredients,
  label,
}: RecipeInstructionActionsProps) {
  if (actions.length === 0) {
    return null;
  }

  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  return (
    <ol className="instruction-actions" aria-label={label}>
      {[...actions]
        .sort((left, right) => left.display_order - right.display_order)
        .map((action) => {
          const inputLabels = action.ingredient_occurrence_ids.map((id) => {
            const ingredient = ingredientById.get(id);
            return ingredient ? ingredient.display_name : "ingredient no longer available";
          });
          const details = [
            inputLabels.length > 0 ? `With ${inputLabels.join(" and ")}` : null,
            action.duration ? `For ${action.duration.display}` : null,
            action.temperature ? `At ${action.temperature.display}` : null,
          ].filter((detail): detail is string => Boolean(detail));
          return (
            <li key={action.id}>
              <strong>{action.action_type.canonical_verb}</strong>
              {!action.action_type.active ? <span>Previously used action</span> : null}
              {details.length > 0 ? <small>{details.join(" \u00b7 ")}</small> : null}
            </li>
          );
        })}
    </ol>
  );
}
