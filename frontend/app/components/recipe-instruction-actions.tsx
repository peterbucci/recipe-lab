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
    return <p className="instruction-actions__unmapped">Structured actions not mapped.</p>;
  }

  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  return (
    <ol className="instruction-actions" aria-label={label}>
      {[...actions]
        .sort((left, right) => left.display_order - right.display_order)
        .map((action) => {
          const inputLabels = action.ingredient_occurrence_ids.map((id) => {
            const ingredient = ingredientById.get(id);
            return ingredient
              ? `Ingredient ${ingredient.display_order + 1}: ${ingredient.display_name}`
              : `Ingredient occurrence ${id}`;
          });
          return (
            <li key={action.id}>
              <strong>{action.action_type.canonical_verb}</strong>
              {!action.action_type.active ? <span>Historical action</span> : null}
              {inputLabels.length > 0 ? <small>Inputs: {inputLabels.join(", ")}</small> : null}
              {action.duration ? <small>Duration: {action.duration.display}</small> : null}
              {action.temperature ? (
                <small>Temperature: {action.temperature.display}</small>
              ) : null}
            </li>
          );
        })}
    </ol>
  );
}
